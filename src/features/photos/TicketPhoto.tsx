import { useCallback } from 'react'
import { getSignedPhotoUrl } from './api'
import { useAsyncData } from '../../lib/useAsyncData'
import { Spinner } from '../../components/Spinner'

/**
 * Muestra la foto del ticket resolviendo una URL firmada temporal.
 * El bucket es privado: sin firma no hay imagen, ni siquiera con la URL a mano.
 */
export function TicketPhoto({ storagePath }: { storagePath: string }) {
  const loader = useCallback(() => getSignedPhotoUrl(storagePath), [storagePath])
  const { data: url, loading, error, reload } = useAsyncData(loader)

  if (loading) {
    return (
      <div className="photo photo--placeholder">
        <Spinner label="Cargando foto…" />
      </div>
    )
  }

  if (error || !url) {
    return (
      <div className="photo photo--placeholder">
        <p className="alert alert--warn">{error ?? 'No se ha podido cargar la foto.'}</p>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void reload()}>
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <a className="photo" href={url} target="_blank" rel="noreferrer noopener">
      <img src={url} alt="Foto del ticket" loading="lazy" />
      <span className="photo__hint">Abrir a tamano completo</span>
    </a>
  )
}
