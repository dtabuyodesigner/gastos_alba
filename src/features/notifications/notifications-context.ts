import { createContext } from 'react'

export interface NotificationsContextValue {
  /** Numero de avisos sin leer del usuario actual. */
  unread: number
  /** Vuelve a consultar el contador. */
  refresh: () => Promise<void>
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null)
