import { supabase } from '../../lib/supabase'
import type { AppNotification } from '../../lib/types'

/** Tope del buzon: con dos personas no hay volumen para paginar. */
const INBOX_LIMIT = 100

export async function listNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(INBOX_LIMIT)
  if (error) throw error
  return (data ?? []) as AppNotification[]
}

/**
 * Solo el numero de no leidas, para el indicador de la cabecera.
 * `head: true` no trae ninguna fila: solo el recuento.
 */
export async function countUnreadNotifications(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id })
  if (error) throw error
}

/** Devuelve cuantas se han marcado. */
export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_notifications_read')
  if (error) throw error
  return (data as number | null) ?? 0
}
