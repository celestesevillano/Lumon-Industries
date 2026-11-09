// Cliente HTTP. Decisiones (y por qué):
// - access token SOLO en memoria (XSS no lo puede leer de storage).
// - refresh token en localStorage; es de un solo uso, por eso el refresh se coordina:
//   una sola promesa compartida + Web Locks entre pestañas.
// - solo TOKEN_EXPIRED dispara refresh; cada request se reintenta UNA vez.
const API = import.meta.env.VITE_API_BASE_URL
const REFRESH_KEY = 'lumon.refresh'

export interface ApiErrorBody {
  error: string
  message: string
  details: Record<string, unknown> | null
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody, public headers: Headers) {
    super(body.message)
  }
  get code() { return this.body.error }
}

let accessToken: string | null = null
let refreshPromise: Promise<boolean> | null = null
const listeners = new Set<(reason: 'expired' | 'revoked') => void>()
export const onSessionLost = (fn: (r: 'expired' | 'revoked') => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
const sessionLost = (r: 'expired' | 'revoked') => { clearSession(); listeners.forEach((f) => f(r)) }

export const hasRefreshToken = () => localStorage.getItem(REFRESH_KEY) !== null
export function setSession(access: string, refresh: string) {
  accessToken = access
  localStorage.setItem(REFRESH_KEY, refresh)
}
export function clearSession() {
  accessToken = null
  localStorage.removeItem(REFRESH_KEY)
}

interface TokenPair { accessToken: string; refreshToken: string }

async function doRefresh(): Promise<boolean> {
  const rt = localStorage.getItem(REFRESH_KEY)
  if (!rt) return false
  const res = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lumon-Build': __LUMON_BUILD__ },
    body: JSON.stringify({ refreshToken: rt }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null
    sessionLost(body?.error === 'REFRESH_REUSED' || body?.error === 'SESSION_REVOKED' ? 'revoked' : 'expired')
    return false
  }
  const pair = (await res.json()) as TokenPair
  setSession(pair.accessToken, pair.refreshToken)
  return true
}

// Coordinado: misma promesa dentro de la pestaña; Web Locks entre pestañas.
export function refresh(): Promise<boolean> {
  if (!refreshPromise) {
    // Web Locks: solo una pestaña a la vez rota el refresh token (si no, REFRESH_REUSED).
    // TODO(hackathon): si otra pestaña ya rotó mientras esperábamos el lock, el refresh token
    // guardado cambió; propagar el access nuevo por BroadcastChannel en vez de refrescar de nuevo.
    refreshPromise = navigator.locks
      .request('lumon-refresh', () => doRefresh())
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  auth?: boolean
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { body, auth = true, headers, ...rest } = opts
  const h = new Headers(headers)
  h.set('X-Lumon-Build', __LUMON_BUILD__)
  if (body !== undefined && !(body instanceof FormData)) h.set('Content-Type', 'application/json')
  if (auth && accessToken) h.set('Authorization', `Bearer ${accessToken}`)
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: h,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
  if (res.ok) return res.status === 204 ? (undefined as T) : ((await res.json()) as T)

  const err = new ApiError(
    res.status,
    (await res.json().catch(() => ({ error: 'UNKNOWN', message: res.statusText, details: null }))) as ApiErrorBody,
    res.headers,
  )
  if (auth && !retried && err.code === 'TOKEN_EXPIRED') {
    if (await refresh()) return api<T>(path, opts, true)
  }
  if (err.code === 'SESSION_REVOKED' || err.code === 'REFRESH_REUSED') sessionLost('revoked')
  throw err
}
