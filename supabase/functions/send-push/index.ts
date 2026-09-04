/*
 * send-push — envia como push del navegador un aviso ya guardado en la tabla
 * `notifications`.
 *
 * QUIEN LA LLAMA
 * El trigger `notifications_push_dispatch` (migracion 0006), una vez por cada
 * fila insertada en `notifications`. No la llama nunca el frontend.
 *
 * PRINCIPIO
 * El push es un canal ADICIONAL del aviso que ya existe, no un camino paralelo.
 * Si esta funcion falla, el aviso sigue en la app y no se pierde nada: por eso
 * responde 200 incluso cuando algun envio concreto no ha salido, para que un
 * fallo de push no reintente ni ensucie la base.
 *
 * SECRETOS (supabase secrets set ...)
 *   VAPID_PUBLIC_KEY   la misma que el frontend
 *   VAPID_PRIVATE_KEY  privada, solo aqui
 *   VAPID_SUBJECT      mailto: de contacto, lo exige el estandar
 *   PUSH_HOOK_SECRET   lo que el trigger manda en la cabecera x-push-secret
 * SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las inyecta la plataforma.
 */

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

interface NotificationRow {
  id: string
  recipient_profile_id: string
  title: string
  body: string
  expense_id: string | null
  payment_id: string | null
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? ''
const PUSH_HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? ''

/**
 * Configuracion VAPID, perezosa y una sola vez.
 *
 * `setVapidDetails` VALIDA lo que recibe y lanza si falta algo o el formato no
 * cuadra. Llamarla al cargar el modulo tumbaria el arranque de la funcion, y
 * entonces el 200 defensivo de mas abajo no llegaria a ejecutarse nunca: un
 * despliegue a medio configurar se llevaria por delante el envio en vez de
 * degradarse en silencio. Por eso se hace aqui dentro, ya comprobado todo.
 */
let vapidReady = false

function ensureVapid(): boolean {
  if (vapidReady) return true
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    vapidReady = true
    return true
  } catch (err) {
    // Claves presentes pero invalidas (mal copiadas, subject sin `mailto:`…).
    console.error('Claves VAPID invalidas:', (err as Error).message)
    return false
  }
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  // Service role: esta funcion tiene que leer las suscripciones del OTRO, cosa
  // que el RLS (correctamente) prohibe a cualquier persona.
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
)

/** Mismo criterio que `notificationLink` en el frontend. */
function targetUrl(row: NotificationRow): string {
  if (row.expense_id) return `/gastos/${row.expense_id}`
  if (row.payment_id) return '/historico'
  return '/notificaciones'
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // El trigger es el unico emisor legitimo. Sin esto, cualquiera con la URL de
  // la funcion podria provocar notificaciones.
  if (!PUSH_HOOK_SECRET || request.headers.get('x-push-secret') !== PUSH_HOOK_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  if (!ensureVapid()) {
    // El aviso ya esta guardado en `notifications`: no se pierde nada, solo no
    // suena el movil. Se responde 200 para no provocar reintentos.
    console.error('VAPID no configurado o invalido: no se envia nada.')
    return new Response(JSON.stringify({ sent: 0, reason: 'sin-vapid' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  let row: NotificationRow
  try {
    // El webhook de base de datos manda { record: {...} }; se acepta tambien la
    // fila pelada para poder probar la funcion a mano.
    const payload = await request.json()
    row = (payload.record ?? payload) as NotificationRow
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  if (!row?.recipient_profile_id) return new Response('Bad request', { status: 400 })

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('profile_id', row.recipient_profile_id)
    .is('disabled_at', null)

  if (error) {
    console.error('No se han podido leer las suscripciones:', error.message)
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  const payload = JSON.stringify({
    title: row.title,
    body: row.body,
    url: targetUrl(row),
    // Un `tag` por aviso: dos tickets distintos no deben pisarse en la bandeja.
    tag: `gastos-alba-${row.id}`,
  })

  let sent = 0
  const expired: string[] = []

  await Promise.all(
    ((subscriptions ?? []) as SubscriptionRow[]).map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        )
        sent += 1
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404/410: el navegador ha revocado la suscripcion (app desinstalada,
        // permiso retirado). No se borra la fila, se desactiva.
        if (status === 404 || status === 410) expired.push(subscription.id)
        else console.error('Fallo al enviar push:', status, (err as Error).message)
      }
    }),
  )

  if (expired.length > 0) {
    await admin
      .from('push_subscriptions')
      .update({ disabled_at: new Date().toISOString() })
      .in('id', expired)
  }

  return new Response(JSON.stringify({ sent, disabled: expired.length }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
