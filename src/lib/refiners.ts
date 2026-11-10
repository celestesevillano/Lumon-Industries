// CP4: expedientes. El texto de la API se muestra SIEMPRE como texto (JSX escapa): nunca HTML.
import { api } from './api'

export interface Refiner {
  id: number
  fullName: string
  department: { id: number; code: string; name: string }
  title: string
  extension: string
  bio: string
  profileUrl: string
  badge: { url: string; width: number; height: number } | null
  version: number
  updatedAt: string
}

export interface RefinerPage {
  content: Refiner[]
  totalElements: number
  totalPages: number
  page: number
  size: number
}

export interface RefinerQuery { page: number; size: number; q: string; departmentId: string }

export function listRefiners(query: RefinerQuery, signal: AbortSignal) {
  const p = new URLSearchParams({ page: String(query.page - 1), size: String(query.size) })
  if (query.q) p.set('q', query.q)
  if (query.departmentId) p.set('departmentId', query.departmentId)
  return api<RefinerPage>(`/refiners?${p}`, { signal })
}

// Devuelve el expediente y su ETag EXACTO (se reenvía tal cual en If-Match).
export async function getRefiner(id: string, signal?: AbortSignal): Promise<{ refiner: Refiner; etag: string }> {
  let etag = ''
  const refiner = await api<Refiner>(`/refiners/${id}`, { signal, onHeaders: (h) => { etag = h.get('ETag') ?? '' } })
  return { refiner, etag }
}

export async function patchRefiner(id: string, etag: string, changes: { title?: string; badgeMediaId?: number }) {
  let next = ''
  const refiner = await api<Refiner>(`/refiners/${id}`, {
    method: 'PATCH',
    headers: { 'If-Match': etag },
    body: changes,
    onHeaders: (h) => { next = h.get('ETag') ?? '' },
  })
  return { refiner, etag: next }
}
