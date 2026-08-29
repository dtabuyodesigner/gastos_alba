import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { validatePhoto } from './api'
import { shouldOfferCamera } from './source'

interface PhotoSourcePickerProps {
  /** Desactiva los botones mientras hay una operacion en curso. */
  disabled?: boolean
  /** Foto valida elegida por la persona. */
  onSelect: (file: File) => void
  /** El archivo no sirve (tamano o tipo). El texto ya viene en castellano. */
  onReject: (message: string) => void
  /** Botones adicionales del mismo grupo, p. ej. "Quitar". */
  children?: ReactNode
}

/**
 * Elegir la foto de un ticket, con los dos origenes separados.
 *
 * El motivo de que sean dos inputs y no uno: en Safari de iOS, un
 * `<input type="file">` que lleve el atributo `capture` abre la camara
 * directamente y no ofrece la fototeca. Con el atributo puesto no hay forma de
 * llegar a una foto ya guardada; sin el, iOS muestra su propio menu
 * (Fototeca / Hacer foto / Elegir archivo).
 *
 * Asi que en movil se ofrecen dos botones explicitos, cada uno con su input:
 * uno con `capture` para la camara y otro sin el para la fototeca. En
 * ordenador solo se muestra el segundo, porque alli `capture` se ignora y los
 * dos botones abririan el mismo dialogo de archivos.
 */
export function PhotoSourcePicker({ disabled, onSelect, onReject, children }: PhotoSourcePickerProps) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const [offerCamera] = useState(() =>
    shouldOfferCamera(typeof window === 'undefined' ? undefined : window.matchMedia),
  )

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Se vacia siempre: si no, elegir dos veces la misma foto no dispara
    // `change` y parece que la aplicacion se ha quedado colgada.
    event.target.value = ''
    if (!file) return

    const problem = validatePhoto(file)
    if (problem) {
      onReject(problem)
      return
    }
    onSelect(file)
  }

  return (
    <>
      {offerCamera ? (
        <input
          ref={cameraInput}
          className="sr-only"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleChange}
        />
      ) : null}

      {/* Sin `capture`: es lo que permite llegar a la fototeca en iOS. */}
      <input ref={libraryInput} className="sr-only" type="file" accept="image/*" onChange={handleChange} />

      <div className="photo-picker__actions">
        {offerCamera ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={disabled}
            onClick={() => cameraInput.current?.click()}
          >
            Hacer foto
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn--secondary"
          disabled={disabled}
          onClick={() => libraryInput.current?.click()}
        >
          {offerCamera ? 'Elegir de Fotos' : 'Elegir foto'}
        </button>

        {children}
      </div>
    </>
  )
}
