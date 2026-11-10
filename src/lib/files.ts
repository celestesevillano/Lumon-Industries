// Tipos y llamadas del CP2. Los campos opcionales son los que el README no fija con precisión:
// verificar contra Swagger (/docs) antes de entregar.
import { api, ApiError } from './api'

export type BinCode = 'WO' | 'FC' | 'DR' | 'MA'
export const BINS: BinCode[] = ['WO', 'FC', 'DR', 'MA']
// Carácter con el que el servidor marca una celda refinada en `bins`.
export const BIN_CHAR: Record<BinCode, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' }

export interface Rules {
  tremorThreshold: number
  connectivity: 4 | 8
  minGroupSize: number
  maxGroupSize: number
  binning: { strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD'; order: string[] }
}

export interface FileSummary {
  id: string | number
  name?: string
  status?: string
  rows?: number
  cols?: number
  progress?: unknown
}

export interface FileDetail extends FileSummary {
  rows: number
  cols: number
  tileSize: number
}

export interface FileList {
  items: FileSummary[]
  total: number
  totalPages: number
}

export interface FileQuery {
  page: number
  pageSize: number
  status: string
  q: string
  sort: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// Acepta las formas habituales de paginación (items/data/content) sin romper si cambian.
export function normalizeList(raw: unknown, pageSize: number): FileList {
  if (Array.isArray(raw)) return { items: raw as FileSummary[], total: raw.length, totalPages: 1 }
  if (!isObj(raw)) return { items: [], total: 0, totalPages: 1 }
  const arr = [raw.items, raw.data, raw.content, raw.results].find(Array.isArray) as FileSummary[] | undefined
  const meta = isObj(raw.meta) ? raw.meta : isObj(raw.pagination) ? raw.pagination : raw
  const total = num(meta.total) ?? num(meta.totalItems) ?? num(meta.totalElements) ?? arr?.length ?? 0
  const totalPages = num(meta.totalPages) ?? Math.max(1, Math.ceil(total / pageSize))
  return { items: arr ?? [], total, totalPages }
}

export async function listFiles(query: FileQuery, signal: AbortSignal): Promise<FileList> {
  const p = new URLSearchParams()
  p.set('page', String(query.page))
  p.set('pageSize', String(query.pageSize))
  if (query.status) p.set('status', query.status)
  if (query.q) p.set('q', query.q)
  if (query.sort) p.set('sort', query.sort)
  return normalizeList(await api<unknown>(`/files?${p}`, { signal }), query.pageSize)
}

export const getFile = (id: string, signal?: AbortSignal) => api<FileDetail>(`/files/${id}`, { signal })
export const getRules = (id: string, signal?: AbortSignal) => api<Rules>(`/files/${id}/rules`, { signal })

// Progreso de las cuatro cajas y total, leído de forma tolerante (formato por confirmar en Swagger).
export interface Progress { percent: number; perBin: Partial<Record<BinCode, number>> }
export function readProgress(file: unknown): Progress {
  const root = isObj(file) && isObj(file.progress) ? file.progress : isObj(file) ? file : {}
  const perBinRaw = isObj(root.bins) ? root.bins : isObj(root.perBin) ? root.perBin : {}
  const perBin: Partial<Record<BinCode, number>> = {}
  for (const b of BINS) {
    const v = num(perBinRaw[b])
    if (v !== undefined) perBin[b] = v
  }
  let percent = num(root.percent) ?? num(root.percentage) ?? 0
  if (percent <= 1 && percent > 0 && root.percent !== undefined) percent *= 100
  const refined = num(root.refinedCells) ?? num(root.refined)
  const total = num(root.totalCells) ?? num(root.total)
  if (percent === 0 && refined !== undefined && total) percent = (refined / total) * 100
  return { percent: Math.min(100, Math.round(percent * 10) / 10), perBin }
}

export interface RefineResult { raw: unknown }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// La Idempotency-Key la crea quien llama UNA vez por intención y se REUTILIZA en cada reintento
// (si cambiara, un reintento tras timeout podría refinar dos veces).
export async function refine(
  fileId: string,
  bin: BinCode,
  cells: { r: number; c: number }[],
  idempotencyKey: string,
): Promise<RefineResult> {
  let delay = 400
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await api<unknown>(`/files/${fileId}/refinements`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: { bin, cells },
      })
      return { raw }
    } catch (e) {
      const retryable = e instanceof TypeError || (e instanceof ApiError && (e.status === 503 || e.status === 504))
      if (!retryable || attempt >= 3) throw e
      await sleep(delay)
      delay *= 2
    }
  }
}
