import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getRefiner, patchRefiner, type Refiner } from '../lib/refiners'

interface Conflict { mine: string; server: Refiner | null; serverEtag: string }

export default function RefinerDetailPage() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const [refiner, setRefiner] = useState<Refiner | null>(null)
  const [etag, setEtag] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getRefiner(id, controller.signal)
      .then(({ refiner: r, etag: e }) => { setRefiner(r); setEtag(e); setTitle(r.title) })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof ApiError ? e.body.message : 'No se pudo cargar el expediente.')
      })
    return () => controller.abort()
  }, [id])

  const save = async (useEtag: string, value: string) => {
    if (saving) return
    setSaving(true)
    setError(null)
    setOk(false)
    try {
      const res = await patchRefiner(id, useEtag, { title: value })
      setRefiner(res.refiner); setEtag(res.etag); setTitle(res.refiner.title); setConflict(null); setOk(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) {
        // El expediente cambió desde que lo leí: pantalla de conflicto, nunca sobrescribir en silencio.
        const current = e.body.details?.current as Refiner | undefined
        setConflict({ mine: value, server: current ?? null, serverEtag: e.headers.get('ETag') ?? '' })
      } else {
        setError(e instanceof ApiError ? e.body.message : 'Sin conexión con Lumon.')
      }
    } finally {
      setSaving(false)
    }
  }

  const reloadServer = async () => {
    try {
      const { refiner: r, etag: e } = await getRefiner(id)
      setRefiner(r); setEtag(e); setTitle(r.title); setConflict(null)
    } catch { setError('No se pudo recargar el expediente.') }
  }

  if (error && !refiner) return <main className="p-8"><p role="alert">{error}</p><Link className="underline" to="/refiners">Volver</Link></main>
  if (!refiner) return <main className="p-8"><p>Cargando…</p></main>

  const canWrite = can('refiners:write')

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link className="text-sm underline" to="/refiners">← Directorio</Link>
      <div className="mt-2 flex items-center gap-4">
        {refiner.badge && <img src={refiner.badge.url} alt={`Fotocheck de ${refiner.fullName}`} width={96} height={96} className="h-24 w-24 rounded object-cover" />}
        <div>
          <h1 className="text-2xl font-bold">{refiner.fullName}</h1>
          <p className="text-sm text-gray-600">{refiner.department.name} · ext. {refiner.extension} · versión {refiner.version}</p>
        </div>
      </div>
      <p className="my-4 whitespace-pre-wrap">{refiner.bio}</p>

      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void save(etag, title) }}>
        <label className="flex flex-col text-sm">
          Título
          <input className="rounded border px-2 py-1" value={title} maxLength={120} disabled={!canWrite || saving} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {canWrite
          ? <button className="self-start rounded bg-emerald-600 px-4 py-1 text-white disabled:opacity-50" disabled={saving || title.trim() === '' || title === refiner.title}>Guardar</button>
          : <p className="text-sm text-gray-600">Solo lectura: tu rol no tiene permiso de edición.</p>}
      </form>

      {ok && <p role="status" className="mt-3 rounded bg-emerald-100 p-2 text-emerald-800">Guardado.</p>}
      {error && <p role="alert" className="mt-3 rounded bg-red-100 p-2 text-red-800">{error}</p>}

      {conflict && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="conflicto" className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded bg-white p-6">
            <h2 id="conflicto" className="mb-2 text-xl font-bold">Conflicto de versión</h2>
            <p className="mb-3 text-sm">Alguien editó este expediente mientras lo tenías abierto. Elige qué conservar.</p>
            <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="font-semibold">Tu título</dt><dd>{conflict.mine}</dd></div>
              <div><dt className="font-semibold">Título en el servidor</dt><dd>{conflict.server?.title ?? '(recarga para verlo)'}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <button className="rounded bg-emerald-600 px-3 py-1 text-white" disabled={saving || !conflict.serverEtag}
                onClick={() => void save(conflict.serverEtag, conflict.mine)}>Conservar el mío</button>
              <button className="rounded border px-3 py-1" onClick={() => void reloadServer()}>Usar el del servidor</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
