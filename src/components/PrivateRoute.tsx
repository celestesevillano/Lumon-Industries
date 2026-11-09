import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function PrivateRoute({ permission }: { permission?: string }) {
  const { me, loading, can } = useAuth()
  const loc = useLocation()
  if (loading) return <p className="p-8">Cargando…</p>
  // vuelve exactamente a donde quería ir, con su query string
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
  if (permission && !can(permission)) return <p role="alert" className="p-8">No tienes permiso para ver esta página.</p>
  return <Outlet />
}
