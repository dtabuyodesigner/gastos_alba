import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsyncData } from '../../lib/useAsyncData'
import { humanizeError } from '../../lib/supabase'
import { formatIsoDate } from '../../lib/dates'
import type { AppNotification } from '../../lib/types'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from './api'
import { countUnread, formatRelativeTime, notificationLink } from './format'
import { useNotifications } from './useNotifications'
import { BadgeSetup } from './BadgeSetup'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'

export function NotificationsPage() {
  const loader = useCallback(() => listNotifications(), [])
  const { data, loading, error, reload } = useAsyncData(loader)
  const { refresh } = useNotifications()
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Notificaciones · Gastos Alba'
  }, [])

  const notifications = useMemo(() => data ?? [], [data])
  const unread = countUnread(notifications)

  async function handleMarkAll() {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await markAllNotificationsRead()
      await reload()
      await refresh()
    } catch (err) {
      setActionError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="detail__head">
        <h1 className="page__title">Notificaciones</h1>
        {unread > 0 ? (
          <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => void handleMarkAll()}>
            Marcar todo leido
          </button>
        ) : null}
      </div>

      <BadgeSetup />

      {loading ? <Spinner label="Cargando avisos…" /> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}
      {actionError ? <p className="alert alert--error">{actionError}</p> : null}

      {!loading && !error && notifications.length === 0 ? (
        <EmptyState title="No hay avisos todavia." />
      ) : null}

      {notifications.length > 0 ? (
        <ul className="notif-list">
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onChanged={async () => {
                await reload()
                await refresh()
              }}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

interface RowProps {
  notification: AppNotification
  onChanged: () => Promise<void>
}

function NotificationRow({ notification, onChanged }: RowProps) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const link = notificationLink(notification)
  const isUnread = notification.read_at === null
  const relative = formatRelativeTime(notification.created_at)
  const when = relative || formatIsoDate(notification.created_at.slice(0, 10))

  async function markRead() {
    if (busy || !isUnread) return
    setBusy(true)
    try {
      await markNotificationRead(notification.id)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  /** Abrir un aviso implica haberlo leido. */
  async function open() {
    if (isUnread) {
      setBusy(true)
      try {
        await markNotificationRead(notification.id)
        await onChanged()
      } finally {
        setBusy(false)
      }
    }
    if (link) navigate(link)
  }

  return (
    <li className={`notif ${isUnread ? 'notif--unread' : ''}`}>
      {link ? (
        <button type="button" className="notif__body" onClick={() => void open()}>
          <NotificationText notification={notification} when={when} />
        </button>
      ) : (
        <div className="notif__body notif__body--plain">
          <NotificationText notification={notification} when={when} />
        </div>
      )}

      {isUnread ? (
        <button
          type="button"
          className="btn btn--ghost btn--small notif__action"
          disabled={busy}
          onClick={() => void markRead()}
        >
          Marcar leido
        </button>
      ) : null}
    </li>
  )
}

function NotificationText({ notification, when }: { notification: AppNotification; when: string }) {
  return (
    <>
      <span className="notif__title">{notification.title}</span>
      <span className="notif__text">{notification.body}</span>
      <span className="notif__when muted">{when}</span>
    </>
  )
}
