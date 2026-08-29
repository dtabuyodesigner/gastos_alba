import { useEffect, useState } from 'react'
import { PhotoSourcePicker } from '../photos/PhotoSourcePicker'

interface PhotoReplacerProps {
  busy: boolean
  onCancel: () => void
  onConfirm: (file: File) => void
}

/**
 * Sustituir la foto de un ticket pendiente.
 *
 * Pide confirmacion con la foto nueva a la vista, porque el error tipico es
 * justamente elegir otra equivocada. La anterior no se pierde: queda guardada
 * como reemplazada.
 */
export function PhotoReplacer({ busy, onCancel, onConfirm }: PhotoReplacerProps) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <section className="paysheet" aria-label="Cambiar la foto del ticket">
      <p className="muted">La foto actual se conserva como historico.</p>

      {previewUrl ? (
        <img className="photo-picker__preview" src={previewUrl} alt="Foto nueva del ticket" />
      ) : null}

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <PhotoSourcePicker
        disabled={busy}
        onSelect={(chosen) => {
          setError(null)
          setFile(chosen)
        }}
        onReject={(message) => {
          setError(message)
          setFile(null)
        }}
      />

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !file}
          onClick={() => file && onConfirm(file)}
        >
          {busy ? 'Guardando…' : 'Guardar foto nueva'}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
