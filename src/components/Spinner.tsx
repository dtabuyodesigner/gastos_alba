export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__dot" aria-hidden="true" />
      {label ? <span className="spinner__label">{label}</span> : <span className="sr-only">Cargando</span>}
    </div>
  )
}
