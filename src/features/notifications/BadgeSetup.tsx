import { useCallback, useEffect, useState } from 'react'
import { applyAppBadge, badgeSupport, requestBadgePermission, type BadgeSupport } from './badge'
import { useNotifications } from './useNotifications'

function readSupport(): BadgeSupport {
  if (typeof window === 'undefined') return 'unsupported'
  return badgeSupport({
    nav: window.navigator,
    notification: 'Notification' in window ? window.Notification : undefined,
  })
}

/**
 * Activar el contador sobre el icono de la aplicacion.
 *
 * Solo aparece donde tiene sentido: en la PWA instalada de un iPhone o iPad,
 * y mientras el permiso no este resuelto. En un ordenador o en Android no se
 * muestra nada, porque alli el aviso ya lo da la campana de la cabecera.
 */
export function BadgeSetup() {
  const { unread } = useNotifications()
  const [support, setSupport] = useState<BadgeSupport>(readSupport)
  const [busy, setBusy] = useState(false)

  // El permiso se puede cambiar desde Ajustes con la aplicacion abierta.
  useEffect(() => {
    const onVisible = () => setSupport(readSupport())
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const activate = useCallback(async () => {
    setBusy(true)
    try {
      await requestBadgePermission(typeof window !== 'undefined' ? window.Notification : undefined)
      setSupport(readSupport())
      await applyAppBadge(unread)
    } finally {
      setBusy(false)
    }
  }, [unread])

  if (support === 'unsupported' || support === 'active') return null

  if (support === 'denied') {
    return (
      <p className="muted badge-setup">
        El aviso sobre el icono esta desactivado. Se vuelve a activar en Ajustes del telefono,
        en Notificaciones → Gastos Alba.
      </p>
    )
  }

  return (
    <div className="badge-setup">
      <p className="muted">
        Puedes ver los avisos pendientes como un numero sobre el icono de la aplicacion.
      </p>
      <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => void activate()}>
        {busy ? 'Activando…' : 'Activar aviso en el icono'}
      </button>
    </div>
  )
}
