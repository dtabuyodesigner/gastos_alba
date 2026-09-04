/**
 * Push del navegador — alta y baja de la suscripcion de ESTE dispositivo.
 *
 * El aviso dentro de la aplicacion (tabla `notifications`) sigue siendo la
 * fuente de verdad. El push es un canal adicional: si falla, no se pierde nada,
 * simplemente no suena el movil.
 *
 * Notas que condicionan todo el codigo de este fichero:
 *  - En iOS/Safari el push SOLO funciona con la app anadida a la pantalla de
 *    inicio (iOS 16.4+). Desde el navegador no hay `PushManager` siquiera.
 *  - El permiso lo tiene que pedir un gesto de la persona, nunca la carga de la
 *    pagina. Por eso aqui no hay nada que se ejecute solo.
 *  - Si alguien deniega el permiso, no se puede volver a preguntar: hay que
 *    cambiarlo en los ajustes del sistema. La interfaz lo dice.
 */

import { supabase } from '../../lib/supabase'
import { readVapidPublicKey } from '../../lib/env'

export type PushStatus =
  /** El navegador no sabe hacer push (o falta configurar la clave VAPID). */
  | 'unsupported'
  /** iPhone/iPad en Safari: hace falta anadir la app a la pantalla de inicio. */
  | 'needs-install'
  /** Permiso denegado: solo se arregla desde los ajustes del dispositivo. */
  | 'denied'
  /** Se puede activar. */
  | 'idle'
  /** Ya activado en este dispositivo. */
  | 'enabled'

/** ¿Se esta ejecutando como aplicacion instalada y no como pestana del navegador? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true
}

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS se anuncia como Mac, de ahi la comprobacion del touch.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

/**
 * Estado actual del push en este dispositivo. Es una lectura, no pide permisos
 * ni cambia nada.
 */
export async function readPushStatus(): Promise<PushStatus> {
  if (typeof window === 'undefined') return 'unsupported'
  if (!readVapidPublicKey()) return 'unsupported'

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // En un iPhone sin instalar, esto es exactamente lo que pasa: el motivo real
    // no es que el movil no pueda, es que falta anadirla a la pantalla de inicio.
    return isAppleMobile() && !isStandalone() ? 'needs-install' : 'unsupported'
  }

  if (isAppleMobile() && !isStandalone()) return 'needs-install'
  if (Notification.permission === 'denied') return 'denied'

  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return subscription ? 'enabled' : 'idle'
}

/**
 * Pide permiso, se suscribe y guarda la suscripcion. Debe llamarse desde un
 * gesto de la persona (el `onClick` de un boton).
 *
 * Devuelve el estado resultante para que la interfaz no tenga que adivinarlo.
 */
export async function enablePush(): Promise<PushStatus> {
  const vapidPublicKey = readVapidPublicKey()
  if (!vapidPublicKey) throw new Error('Falta VITE_VAPID_PUBLIC_KEY en la configuracion del despliegue.')

  const registration = await navigator.serviceWorker.ready

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'idle'

  // Si ya habia una suscripcion se reutiliza: volver a suscribir con otra clave
  // VAPID falla, y con la misma devuelve la que ya existe.
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))

  await saveSubscription(subscription)
  return 'enabled'
}

/**
 * Baja de este dispositivo. Coherente con el resto del proyecto: la fila no se
 * borra, se marca `disabled_at`.
 */
export async function disablePush(): Promise<PushStatus> {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return 'idle'

  const { error } = await supabase
    .from('push_subscriptions')
    .update({ disabled_at: new Date().toISOString() })
    .eq('endpoint', subscription.endpoint)
  if (error) throw error

  await subscription.unsubscribe()
  return 'idle'
}

/**
 * Guarda (o reactiva) la suscripcion de este dispositivo.
 *
 * `endpoint` es unico, asi que reinstalar la app en el mismo movil actualiza la
 * fila en vez de duplicarla. `disabled_at: null` la reactiva si se habia dado de
 * baja antes.
 */
async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const profileId = sessionData.session?.user.id
  if (!profileId) throw new Error('Hay que iniciar sesion para activar los avisos.')

  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!p256dh || !auth) throw new Error('El navegador no ha devuelto las claves de la suscripcion.')

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: profileId,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 400),
      disabled_at: null,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
}

/**
 * `applicationServerKey` exige bytes crudos; la clave VAPID viaja en base64url.
 */
function urlBase64ToUint8Array(base64UrlKey: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64UrlKey.length % 4)) % 4)
  const base64 = (base64UrlKey + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}
