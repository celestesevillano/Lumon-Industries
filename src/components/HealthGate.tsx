import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'

// "Conectando con Lumon…": reintenta con espera creciente y permite reintento manual.
export function HealthGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false)
  const attempt = useRef(0)
  const timer = useRef<number>()

  const check = useCallback(async () => {
    window.clearTimeout(timer.current)
    try {
      await api('/meta/health', { auth: false })
      setOk(true)
    } catch {
      const delay = Math.min(1000 * 2 ** attempt.current++, 15000)
      timer.current = window.setTimeout(check, delay)
    }
  }, [])

  useEffect(() => { void check(); return () => window.clearTimeout(timer.current) }, [check])

  if (ok) return children
  return (
    <div className="p-8" role="status">
      <p>Conectando con Lumon…</p>
      <button className="mt-2 rounded border px-3 py-1" onClick={() => { attempt.current = 0; void check() }}>
        Reintentar
      </button>
    </div>
  )
}
