import { useContext } from 'react'
import { NotificationsContext, type NotificationsContextValue } from './notifications-context'

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext)
  if (!context) throw new Error('useNotifications debe usarse dentro de <NotificationsProvider>.')
  return context
}
