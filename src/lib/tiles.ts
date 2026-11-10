// Caché de bloques (tiles) de una grilla. Reglas del CP2:
// - índices desde 0, solo se piden cuando hacen falta;
// - nunca dos requests en vuelo para el mismo bloque (se guarda la PROMESA);
// - se cancelan los bloques que salieron de la vista;
// - 429: no se pide nada hasta que pase Retry-After; 503: backoff exponencial.
import { api, ApiError } from './api'

interface TileDto {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  values: string
  tremor: string // base64, un byte por celda
  bins: string
  version: number
}

export interface Tile {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  values: string
  tremor: Uint8Array
  bins: string[] // '.' sin refinar o W/F/D/M
  version: number
}

export function decodeTile(dto: TileDto): Tile {
  const bin = atob(dto.tremor)
  const tremor = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) tremor[i] = bin.charCodeAt(i)
  return { ...dto, tremor, bins: dto.bins.split('') }
}

const key = (tr: number, tc: number) => `${tr},${tc}`

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })

interface Inflight { promise: Promise<Tile>; controller: AbortController; pinned: boolean }

export class TileStore {
  private cache = new Map<string, Tile>()
  private inflight = new Map<string, Inflight>()
  private blockedUntil = 0
  private listeners = new Set<() => void>()

  constructor(private fileId: string, readonly tileSize: number) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  private notify() { this.listeners.forEach((f) => f()) }

  tileOf(r: number, c: number) {
    return { tr: Math.floor(r / this.tileSize), tc: Math.floor(c / this.tileSize) }
  }
  get(tr: number, tc: number) { return this.cache.get(key(tr, tc)) }

  // pinned = bloque que necesita un cálculo en curso (grupo): no se cancela al hacer scroll.
  load(tr: number, tc: number, pinned = false): Promise<Tile> {
    const k = key(tr, tc)
    const cached = this.cache.get(k)
    if (cached) return Promise.resolve(cached)
    const current = this.inflight.get(k)
    if (current) {
      if (pinned) current.pinned = true
      return current.promise
    }
    const controller = new AbortController()
    const entry: Inflight = { promise: Promise.resolve(null as unknown as Tile), controller, pinned }
    entry.promise = this.fetchTile(tr, tc, controller.signal)
      .then((tile) => {
        this.cache.set(k, tile)
        this.notify()
        return tile
      })
      .finally(() => { this.inflight.delete(k) })
    this.inflight.set(k, entry)
    return entry.promise
  }

  // Cancela lo que está en vuelo y ya no está en pantalla.
  cancelExcept(visible: Set<string>) {
    for (const [k, e] of this.inflight) {
      if (!visible.has(k) && !e.pinned) e.controller.abort()
    }
  }
  static key = key

  invalidate(tr: number, tc: number) { this.cache.delete(key(tr, tc)); this.notify() }

  markRefined(cells: { r: number; c: number }[], binChar: string) {
    for (const { r, c } of cells) {
      const { tr, tc } = this.tileOf(r, c)
      const t = this.cache.get(key(tr, tc))
      if (t) t.bins[(r - t.originRow) * t.cols + (c - t.originCol)] = binChar
    }
    this.notify()
  }

  private async fetchTile(tr: number, tc: number, signal: AbortSignal): Promise<Tile> {
    let backoff = 500
    for (let attempt = 0; ; attempt++) {
      const wait = this.blockedUntil - Date.now()
      if (wait > 0) await sleep(wait, signal)
      try {
        return decodeTile(await api<TileDto>(`/files/${this.fileId}/tiles/${tr}/${tc}`, { signal }))
      } catch (e) {
        if (signal.aborted) throw e
        if (e instanceof ApiError && e.status === 429) {
          const secs = Number(e.headers.get('Retry-After'))
          this.blockedUntil = Date.now() + (Number.isFinite(secs) && secs > 0 ? secs : 1) * 1000
          continue
        }
        if (e instanceof ApiError && e.status === 503 && attempt < 5) {
          await sleep(backoff, signal)
          backoff *= 2
          continue
        }
        throw e
      }
    }
  }
}
