import type { AppNotification } from '../../lib/types'

/** Cuantas notificaciones quedan sin leer. */
export function countUnread(notifications: AppNotification[]): number {
  return notifications.reduce((total, n) => (n.read_at === null ? total + 1 : total), 0)
}

/** Numero para el indicador de la cabecera: mas de 9 se muestra como "9+". */
export function formatBadgeCount(count: number): string {
  if (count <= 0) return ''
  return count > 9 ? '9+' : String(count)
}

/**
 * Antiguedad en lenguaje corriente: "ahora", "hace 5 min", "hace 2 h", "ayer",
 * "hace 3 dias". A partir de una semana se deja la fecha al componente, que la
 * formatea con `formatIsoDate`.
 *
 * `now` es un parametro para poder probarlo sin depender del reloj real.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (seconds < 0) return 'ahora'
  if (seconds < 60) return 'ahora'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 7) return `hace ${days} dias`

  return ''
}

/** Ruta a la que lleva una notificacion, o `null` si no tiene contexto abrible. */
export function notificationLink(notification: AppNotification): string | null {
  if (notification.expense_id) return `/gastos/${notification.expense_id}`
  // Un pago agrupado no tiene un unico ticket: se abre el historico, donde
  // estan tanto los pagos registrados como los tickets que cubren.
  if (notification.payment_id) return '/historico'
  return null
}
