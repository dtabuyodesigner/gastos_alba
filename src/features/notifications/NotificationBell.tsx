import { NavLink } from 'react-router-dom'
import { useNotifications } from './useNotifications'
import { formatBadgeCount } from './format'

/**
 * Indicador de avisos sin leer.
 *
 * Va en la cabecera y no en la barra inferior a proposito: la barra ya lleva
 * cuatro elementos y en una pantalla de 375 px no cabe un quinto sin apretar el
 * boton de "Nuevo ticket", que es el que mas se usa.
 */
export function NotificationBell() {
  const { unread } = useNotifications()
  const badge = formatBadgeCount(unread)
  const label = unread > 0 ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'

  return (
    <NavLink
      to="/notificaciones"
      className={({ isActive }) => `bell ${isActive ? 'bell--active' : ''}`}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
        <path
          d="M12 3a6 6 0 0 0-6 6v3.6L4.5 15.5h15L18 12.6V9a6 6 0 0 0-6-6Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M9.75 18.5a2.25 2.25 0 0 0 4.5 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      {badge ? (
        <span className="bell__badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
    </NavLink>
  )
}
