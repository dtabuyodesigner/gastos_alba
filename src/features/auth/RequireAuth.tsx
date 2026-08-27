import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { Spinner } from '../../components/Spinner'

/** Puerta de acceso: sin sesion y perfil activo no se pinta nada de la app. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="screen-center">
        <Spinner label="Comprobando sesion…" />
      </div>
    )
  }

  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (status === 'unauthorized') return <UnauthorizedScreen />

  return <>{children}</>
}

function UnauthorizedScreen() {
  const { signOut, error } = useAuth()
  return (
    <div className="screen-center">
      <div className="card card--narrow">
        <h1 className="title">Cuenta sin autorizar</h1>
        <p className="muted">
          Esta cuenta no tiene acceso a Gastos Alba. Pide que la activen antes de volver a intentarlo.
        </p>
        {error ? <p className="alert alert--error">{error}</p> : null}
        <button type="button" className="btn btn--secondary" onClick={() => void signOut()}>
          Cerrar sesion
        </button>
      </div>
    </div>
  )
}
