import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="page">
      <h1 className="page__title">Aqui no hay nada</h1>
      <Link className="btn btn--secondary" to="/">
        Volver al inicio
      </Link>
    </div>
  )
}
