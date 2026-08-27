/** Pantalla de arranque cuando falta o es invalida la configuracion de Supabase. */
export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="screen-center">
      <div className="card card--narrow">
        <h1 className="title">Configuracion incompleta</h1>
        <p className="alert alert--error">{message}</p>
        <p className="muted">
          Revisa <code>.env.local</code> y el apartado de instalacion del <code>README.md</code>.
        </p>
      </div>
    </div>
  )
}
