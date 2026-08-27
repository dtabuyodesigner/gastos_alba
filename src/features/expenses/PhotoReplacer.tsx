import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { validatePhoto } from '../photos/api'

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
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    setError(null)
    if (!chosen) {
      setFile(null)
      return
    }
    const problem = validatePhoto(chosen)
    if (problem) {
      setError(problem)
      setFile(null)
      event.target.value = ''
      return
    }
    setFile(chosen)
  }

  return (
    <section className="paysheet" aria-label="Cambiar la foto del ticket">
      <p className="muted">La foto actual se conserva como historico.</p>

      {previewUrl ? (
        <img className="photo-picker__preview" src={previewUrl} alt="Foto nueva del ticket" />
      ) : null}

      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleChange}
      />

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => input.current?.click()}>
          {file ? 'Elegir otra' : 'Elegir foto'}
        </button>
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
