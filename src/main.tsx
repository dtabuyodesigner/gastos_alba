import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se ha encontrado el nodo raiz #root.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// El service worker solo se registra en produccion: en desarrollo estorba mas
// que ayuda (cachea modulos y confunde el hot reload).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Sin service worker la app sigue funcionando; solo se pierde el modo offline.
    })
  })
}
