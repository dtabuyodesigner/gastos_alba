/*
 * Contador sobre el icono de la aplicacion instalada (Badging API).
 *
 * Que hace y que NO hace, para que nadie se lleve una sorpresa:
 *
 *  - Se pinta el numero de avisos sin leer sobre el icono de la PWA.
 *  - En iOS/iPadOS solo funciona si la aplicacion esta anadida a la pantalla
 *    de inicio (en una pestana de Safari la API ni siquiera existe) Y si la
 *    persona ha dado permiso de notificaciones. Sin ese permiso, las llamadas
 *    se aceptan pero el sistema no dibuja nada.
 *  - El numero se actualiza mientras la aplicacion esta abierta o mientras el
 *    service worker atiende un push. iOS no ejecuta la aplicacion cerrada por
 *    su cuenta: sin push, el badge refleja lo que se sabia la ultima vez que
 *    se abrio, no lo que ha pasado despues.
 *  - Chrome en Android no expone la API. Alli el aviso vive dentro de la
 *    aplicacion (la campana), que es la via que funciona en todas partes.
 */

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export type BadgeSupport = 'unsupported' | 'needs-permission' | 'denied' | 'active'

interface BadgeEnv {
  nav?: Navigator
  notification?: typeof Notification
}

function badgeNavigator(nav?: Navigator): BadgeNavigator | null {
  const candidate = nav as BadgeNavigator | undefined
  return typeof candidate?.setAppBadge === 'function' ? candidate : null
}

export function supportsAppBadge(nav?: Navigator): boolean {
  return badgeNavigator(nav) !== null
}

/**
 * Estado de cara a la interfaz: si merece la pena ofrecer el boton de activar.
 */
export function badgeSupport({ nav, notification }: BadgeEnv = {}): BadgeSupport {
  if (!badgeNavigator(nav)) return 'unsupported'
  if (typeof notification !== 'function') return 'unsupported'
  if (notification.permission === 'granted') return 'active'
  if (notification.permission === 'denied') return 'denied'
  return 'needs-permission'
}

/**
 * Pone o quita el contador. Nunca lanza: un badge es un adorno y no debe
 * tumbar la pantalla en la que este la persona.
 */
export async function applyAppBadge(count: number, nav?: Navigator): Promise<void> {
  const target = badgeNavigator(nav)
  if (!target) return
  try {
    if (count > 0) {
      await target.setAppBadge(count)
    } else if (typeof target.clearAppBadge === 'function') {
      await target.clearAppBadge()
    } else {
      await target.setAppBadge(0)
    }
  } catch {
    // Permiso retirado, navegador raro o pestana en segundo plano: da igual.
  }
}

/**
 * Pide el permiso de notificaciones, que en iOS es lo que destapa el badge.
 * Debe llamarse desde un gesto de la persona (un click), o iOS lo ignora.
 */
export async function requestBadgePermission(notification?: typeof Notification): Promise<NotificationPermission> {
  if (typeof notification !== 'function') return 'denied'
  try {
    return await notification.requestPermission()
  } catch {
    return 'denied'
  }
}
