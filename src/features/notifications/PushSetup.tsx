import { useCallback, useEffect, useState } from 'react'
import { humanizeError } from '../../lib/supabase'
import { disablePush, enablePush, readPushStatus, type PushStatus } from './push'

/**
 * Tarjeta para activar los avisos en el movil (push del navegador).
 *
 * Vive en la pagina de notificaciones y no en un ajuste escondido porque es
 * donde alguien va cuando se pregunta "¿por que no me entero de nada?".
 *
 * Se muestra por dispositivo: activar en el movil no activa en el portatil.
 */
export function PushSetup() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void readPushStatus().then(setStatus)
  }, [])

  useEffect(refresh, [refresh])

  async function run(action: () => Promise<PushStatus>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setStatus(await action())
    } catch (err) {
      setError(humanizeError(err))
      refresh()
    } finally {
      setBusy(false)
    }
  }

  // Mientras se resuelve, o si el navegador no puede, no se ensucia la pagina.
  if (status === null || status === 'unsupported') return null

  return (
    <section className="push-setup">
      <h2 className="push-setup__title">Avisos en este dispositivo</h2>

      {status === 'needs-install' ? (
        <p className="push-setup__text muted">
          Para recibir avisos en el iPhone, primero anade la app a la pantalla de inicio: boton
          Compartir → «Anadir a pantalla de inicio». Despues abrela desde ese icono y vuelve aqui.
        </p>
      ) : null}

      {status === 'denied' ? (
        <p className="push-setup__text muted">
          Los avisos estan bloqueados en este dispositivo. Desde la app no se puede volver a
          preguntar: hay que permitir las notificaciones de Gastos Alba en los ajustes del sistema.
        </p>
      ) : null}

      {status === 'idle' ? (
        <>
          <p className="push-setup__text muted">
            Ahora mismo solo ves los avisos al entrar en la app. Activalos y el movil te avisara
            aunque la tengas cerrada.
          </p>
          <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => void run(enablePush)}>
            {busy ? 'Activando…' : 'Activar avisos'}
          </button>
        </>
      ) : null}

      {status === 'enabled' ? (
        <>
          <p className="push-setup__text muted">Avisos activados en este dispositivo.</p>
          <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={() => void run(disablePush)}>
            {busy ? 'Desactivando…' : 'Desactivar aqui'}
          </button>
        </>
      ) : null}

      {error ? <p className="alert alert--error">{error}</p> : null}
    </section>
  )
}
