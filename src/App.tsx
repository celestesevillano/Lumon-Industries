import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { HealthGate } from './components/HealthGate'
import { PrivateRoute } from './components/PrivateRoute'
import LoginPage from './pages/LoginPage'
import EstadoPage from './pages/EstadoPage'
import NotFound from './pages/NotFound'

// La grilla (CP2) va en un chunk aparte: no cuenta en los 180 KB de /login.
const FilesPage = lazy(() => import('./pages/FilesPage'))

export default function App() {
  return (
    <HealthGate>
      <Suspense fallback={<p className="p-8">Cargando…</p>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<PrivateRoute />}>
            <Route path="/estado" element={<EstadoPage />} />
            <Route path="/files" element={<FilesPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </HealthGate>
  )
}
