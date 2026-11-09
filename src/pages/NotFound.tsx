import { Link } from 'react-router-dom'
export default function NotFound() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-bold">404</h1>
      <Link className="underline" to="/files">Volver</Link>
    </main>
  )
}
