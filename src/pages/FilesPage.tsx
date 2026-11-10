import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { listFiles, readProgress, type FileList, type FileQuery } from '../lib/files'

const PAGE_SIZES = [10, 20, 50]
// Valores de estado por confirmar en Swagger; la UI no depende de que coincidan con los del servidor.
const STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED']
const SORTS: { value: string; label: string }[] = [
  { value: '', label: 'Predeterminado' },
  { value: 'name', label: 'Nombre (A-Z)' },
  { value: '-name', label: 'Nombre (Z-A)' },
]

// Una URL inválida nunca rompe la vista: cada parámetro cae a su valor por defecto.
function parseQuery(sp: URLSearchParams): FileQuery {
  const page = Math.max(1, Math.min(10000, parseInt(sp.get('page') ?? '', 10) || 1))
  const ps = parseInt(sp.get('pageSize') ?? '', 10)
  const status = /^[A-Z_]{1,30}$/.test(sp.get('status') ?? '') ? (sp.get('status') as string) : ''
  const q = (sp.get('q') ?? '').slice(0, 80)
  const sort = /^-?[a-zA-Z]{1,20}$/.test(sp.get('sort') ?? '') ? (sp.get('sort') as string) : ''
  return { page, pageSize: PAGE_SIZES.includes(ps) ? ps : 20, status, q, sort }
}

export default function FilesPage() {
  const [sp, setSp] = useSearchParams()
  const spKey = sp.toString()
  const query = useMemo(() => parseQuery(new URLSearchParams(spKey)), [spKey])
  const [text, setText] = useState(query.q)
  const [data, setData] = useState<FileList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Cambia un parámetro; los filtros reinician la página. `replace` evita llenar el historial al teclear.
  const update = (changes: Partial<Record<keyof FileQuery, string>>, replace = false) => {
    const next = new URLSearchParams(spKey)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in changes)) next.delete('page')
    setSp(next, { replace })
  }

  // Búsqueda con debounce: no hay una request por tecla.
  useEffect(() => {
    if (text === query.q) return
    const t = setTimeout(() => update({ q: text.trim() }, true), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  // Si la URL cambia desde fuera (atrás/adelante), el input la sigue.
  useEffect(() => { setText(query.q) }, [query.q])

  // Una respuesta vieja nunca pisa a una nueva: el cleanup cancela la petición anterior.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    listFiles(query, controller.signal)
      .then((d) => { setData(d); setLoading(false) })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(e instanceof ApiError ? e.body.message : 'No se pudo cargar la lista. Revisa tu conexión.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [query])

  const goPage = (p: number) => update({ page: p > 1 ? String(p) : '' })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Archivos</h1>

      <div className="mb-4 flex flex-wrap gap-3">
        <label className="flex flex-col text-sm">
          Buscar
          <input
            className="rounded border px-2 py-1"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nombre del archivo"
          />
        </label>
        <label className="flex flex-col text-sm">
          Estado
          <select className="rounded border px-2 py-1" value={query.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Todos</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Orden
          <select className="rounded border px-2 py-1" value={query.sort} onChange={(e) => update({ sort: e.target.value })}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Por página
          <select
            className="rounded border px-2 py-1"
            value={query.pageSize}
            onChange={(e) => update({ pageSize: e.target.value === '20' ? '' : e.target.value })}
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-red-800">{error}</p>}
      <p className="mb-2 text-sm text-gray-600" aria-live="polite">
        {loading ? 'Cargando…' : `${data?.total ?? 0} archivos`}
      </p>

      <ul className="divide-y rounded border">
        {data?.items.map((f) => {
          const p = readProgress(f)
          return (
            <li key={String(f.id)} className="flex items-center justify-between gap-4 p-3">
              <div>
                <Link className="font-semibold underline" to={`/files/${f.id}/refine`}>{f.name ?? `Archivo ${f.id}`}</Link>
                <p className="text-sm text-gray-600">
                  {f.status ?? '—'}{f.rows && f.cols ? ` · ${f.rows}×${f.cols}` : ''}
                </p>
              </div>
              <div className="w-32" aria-label={`Progreso ${p.percent}%`}>
                <div className="h-2 rounded bg-gray-200"><div className="h-2 rounded bg-emerald-600" style={{ width: `${p.percent}%` }} /></div>
                <span className="text-xs">{p.percent}%</span>
              </div>
            </li>
          )
        })}
        {!loading && data?.items.length === 0 && <li className="p-3 text-gray-600">No hay archivos con esos filtros.</li>}
      </ul>

      <nav className="mt-4 flex items-center gap-3" aria-label="Paginación">
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={query.page <= 1} onClick={() => goPage(query.page - 1)}>
          Anterior
        </button>
        <span className="text-sm">Página {query.page} de {data?.totalPages ?? 1}</span>
        <button
          className="rounded border px-3 py-1 disabled:opacity-40"
          disabled={!data || query.page >= data.totalPages}
          onClick={() => goPage(query.page + 1)}
        >
          Siguiente
        </button>
      </nav>
    </main>
  )
}
