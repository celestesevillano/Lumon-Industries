import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { listRefiners, type RefinerPage, type RefinerQuery } from '../lib/refiners'

const SIZES = [10, 20, 50]

function parse(sp: URLSearchParams): RefinerQuery {
  const size = parseInt(sp.get('size') ?? '', 10)
  return {
    page: Math.max(1, Math.min(10000, parseInt(sp.get('page') ?? '', 10) || 1)),
    size: SIZES.includes(size) ? size : 10,
    q: (sp.get('q') ?? '').slice(0, 80),
    departmentId: /^\d{1,6}$/.test(sp.get('departmentId') ?? '') ? (sp.get('departmentId') as string) : '',
  }
}

export default function RefinersPage() {
  const [sp, setSp] = useSearchParams()
  const spKey = sp.toString()
  const query = useMemo(() => parse(new URLSearchParams(spKey)), [spKey])
  const [text, setText] = useState(query.q)
  const [data, setData] = useState<RefinerPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const update = (changes: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(spKey)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in changes)) next.delete('page')
    setSp(next, { replace })
  }

  useEffect(() => {
    if (text === query.q) return
    const t = setTimeout(() => update({ q: text.trim() }, true), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  useEffect(() => { setText(query.q) }, [query.q])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    listRefiners(query, controller.signal)
      .then((d) => { setData(d); setLoading(false) })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(
          e instanceof ApiError && e.code === 'CLEARANCE_REQUIRED'
            ? 'El Piso de Pruebas aún no está abierto para tu equipo.'
            : e instanceof ApiError ? e.body.message : 'No se pudo cargar el directorio.',
        )
        setLoading(false)
      })
    return () => controller.abort()
  }, [query])

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Directorio del personal</h1>
      <label className="mb-4 flex max-w-sm flex-col text-sm">
        Buscar
        <input className="rounded border px-2 py-1" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nombre" />
      </label>

      {error && <p role="alert" className="mb-3 rounded bg-red-100 p-3 text-red-800">{error}</p>}
      <p className="mb-2 text-sm text-gray-600" aria-live="polite">{loading ? 'Cargando…' : `${data?.totalElements ?? 0} personas`}</p>

      <ul className="divide-y rounded border">
        {data?.content.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-3">
            {r.badge && <img src={r.badge.url} alt="" width={48} height={48} className="h-12 w-12 rounded object-cover" loading="lazy" />}
            <div>
              {/* Todo texto de la API se renderiza como texto, nunca como HTML. */}
              <Link className="font-semibold underline" to={`/refiners/${r.id}`}>{r.fullName}</Link>
              <p className="text-sm text-gray-600">{r.title} · {r.department.name} · ext. {r.extension}</p>
            </div>
          </li>
        ))}
        {!loading && data?.content.length === 0 && <li className="p-3 text-gray-600">Sin resultados.</li>}
      </ul>

      <nav className="mt-4 flex items-center gap-3" aria-label="Paginación">
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={query.page <= 1} onClick={() => update({ page: query.page > 2 ? String(query.page - 1) : '' })}>Anterior</button>
        <span className="text-sm">Página {query.page} de {data?.totalPages ?? 1}</span>
        <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={!data || query.page >= data.totalPages} onClick={() => update({ page: String(query.page + 1) })}>Siguiente</button>
      </nav>
    </main>
  )
}
