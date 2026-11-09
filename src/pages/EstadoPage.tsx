import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function EstadoPage() {
  const { me, logout } = useAuth()
  const [health, setHealth] = useState<unknown>(null)
  const [integrations, setIntegrations] = useState<unknown>(null)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    api('/meta/health', { auth: false, signal: ac.signal }).then(setHealth).catch(() => setHealth('sin respuesta'))
    api('/integrations/status', { signal: ac.signal }).then(setIntegrations).catch(() => undefined)
    return () => ac.abort()
  }, [])

  async function openFloor() {
    setError(null)
    try { setResult(await api('/clearance/check', { method: 'POST' })) }
    catch (e) { setError(e instanceof ApiError ? `${e.code}: ${e.body.message}` : 'Error') }
  }

  return (
    <main className="p-8 space-y-3">
      <h1 className="text-xl font-bold">Estado</h1>
      <p>Build desplegado: <code>{__LUMON_BUILD__}</code></p>
      <p>Equipo: {me?.team.code} · Clearance: {me?.clearance.granted ? 'abierto' : 'cerrado'}</p>
      <pre className="overflow-auto rounded bg-gray-100 p-2 text-sm">{JSON.stringify({ health, integrations }, null, 2)}</pre>
      <button onClick={openFloor} className="rounded bg-black px-4 py-2 text-white">Abrir el Piso de Pruebas</button>
      {error && <p role="alert">{error}</p>}
      {result !== null && <pre className="rounded bg-gray-100 p-2 text-sm">{JSON.stringify(result, null, 2)}</pre>}
      <button onClick={logout} className="block underline">Cerrar sesión</button>
    </main>
  )
}
