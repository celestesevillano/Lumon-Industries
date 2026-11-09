import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, clearSession, hasRefreshToken, onSessionLost, refresh, setSession } from './api'

export interface Me {
  user: { id: number; email: string; displayName: string }
  team: { code: string; name: string }
  role: { code: string; name: string }
  permissions: string[]
  clearance: { granted: boolean; grantedAt: string | null }
}
interface LoginResponse { accessToken: string; refreshToken: string }

interface AuthState {
  me: Me | null
  loading: boolean
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: string) => boolean
}
const Ctx = createContext<AuthState | null>(null)

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lumon-auth') : null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  // Restaurar sesión sin mostrar login mientras se verifica.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (hasRefreshToken() && (await refresh())) {
          const m = await api<Me>('/auth/me')
          if (alive) setMe(m)
        }
      } catch { /* sin sesión */ } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => onSessionLost((r) => {
    setMe(null)
    setNotice(r === 'revoked' ? 'Tu sesión fue revocada. Inicia sesión de nuevo.' : 'Tu sesión venció.')
  }), [])

  // Logout en una pestaña => todas (menos de 2 s con BroadcastChannel).
  useEffect(() => {
    if (!channel) return
    channel.onmessage = (e: MessageEvent<string>) => {
      if (e.data === 'logout') { clearSession(); setMe(null) }
    }
    return () => { channel.onmessage = null }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false })
    setSession(res.accessToken, res.refreshToken)
    setMe(await api<Me>('/auth/me'))
    setNotice(null)
  }, [])

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* igual cerramos local */ }
    clearSession(); setMe(null); channel?.postMessage('logout')
  }, [])

  const value = useMemo<AuthState>(() => ({
    me, loading, notice, login, logout,
    can: (p) => me?.permissions.includes(p) ?? false, // la UI se decide por permissions, no por role
  }), [me, loading, notice, login, logout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fuera de AuthProvider')
  return v
}
