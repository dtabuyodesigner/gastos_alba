/*
 * Gastos Alba — service worker minimo.
 *
 * Objetivos:
 *  1. Hacer la app instalable como PWA.
 *  2. Que el "app shell" cargue rapido y sobreviva a una red mala.
 *
 * Reglas de privacidad (importantes, no tocar sin pensar):
 *  - Solo se cachean peticiones GET del MISMO origen.
 *  - NUNCA se cachean respuestas de Supabase (API, Auth ni Storage), asi que
 *    ni las fotos de tickets ni los datos de gastos quedan en disco del
 *    navegador a traves del service worker.
 */

const CACHE_VERSION = 'gastos-alba-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Todo lo que no sea de nuestro origen (Supabase incluido) va a la red sin cache.
  if (url.origin !== self.location.origin) return

  // Navegaciones: red primero, cache como red de seguridad offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    )
    return
  }

  // Estaticos del propio origen: cache primero, y refresco en segundo plano.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached || Response.error())
      return cached || network
    }),
  )
})
