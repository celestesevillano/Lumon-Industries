import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function LoginPage() {
  const { me, login, notice } = useAuth()
  const nav = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/files'
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true); setError(null)
    try {
      await login(String(f.get('email')), String(f.get('password')))
      nav(from, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.body.message : 'No se pudo iniciar sesión')
    } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-bold">Lumon MDR</h1>
      {notice && <p role="status" className="mb-2">{notice}</p>}
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">Email <input name="email" type="email" required className="w-full rounded border p-2" /></label>
        <label className="block">Contraseña <input name="password" type="password" required className="w-full rounded border p-2" /></label>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <button disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">Entrar</button>
      </form>
      {/* TODO: registro de la cuadrilla (POST /auth/register) con errores por campo desde details */}
    </main>
  )
}
