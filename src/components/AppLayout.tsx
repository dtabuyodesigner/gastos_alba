import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth'
import { ROLE_LABELS } from '../lib/types'
import { NotificationBell } from '../features/notifications/NotificationBell'

/** Marco de la app: cabecera compacta y barra inferior con el pulgar en mente. */
export function AppLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <img src="/icons/icon.svg" alt="" width={28} height={28} />
          <span className="brand__name">Gastos Alba</span>
        </div>
        <div className="app__user">
          <NotificationBell />
          {profile ? (
            <span className="app__who">
              {profile.display_name}
              {/* El rol solo aporta cuando no coincide con el nombre visible. */}
              {ROLE_LABELS[profile.role] !== profile.display_name ? (
                <span className="app__role">{ROLE_LABELS[profile.role]}</span>
              ) : null}
            </span>
          ) : null}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void handleSignOut()}>
            Salir
          </button>
        </div>
      </header>

      <main className="app__main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navegacion principal">
        <NavLink to="/" end className={navClass}>
          Inicio
        </NavLink>
        <NavLink to="/gastos" className={navClass}>
          Tickets
        </NavLink>
        <NavLink to="/gastos/nuevo" className="tabbar__cta">
          + Nuevo
        </NavLink>
        <NavLink to="/historico" className={navClass}>
          Historico
        </NavLink>
      </nav>
    </div>
  )
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'tabbar__link tabbar__link--active' : 'tabbar__link'
}
