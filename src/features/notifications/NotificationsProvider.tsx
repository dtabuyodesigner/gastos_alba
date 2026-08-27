import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { countUnreadNotifications } from './api'
import { NotificationsContext, type NotificationsContextValue } from './notifications-context'

/** Cada cuanto se vuelve a mirar el buzon estando la pestana en primer plano. */
const POLL_MS = 60_000

/**
 * Contador de avisos sin leer.
 *
 * Se consulta por sondeo cada minuto y al volver a la pestana, no por
 * Realtime: con dos personas y unos pocos tickets al mes, una suscripcion en
 * vivo seria mas infraestructura que valor. Un minuto de retraso en un aviso
 * domestico no le importa a nadie.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const count = await countUnreadNotifications()
      if (mounted.current) setUnread(count)
    } catch {
      // Un fallo al contar avisos no debe estropear la pantalla en la que
      // este la persona: se reintenta en el siguiente sondeo.
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mounted.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const value = useMemo<NotificationsContextValue>(() => ({ unread, refresh }), [unread, refresh])

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}
