import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Spinner } from '../../components/Spinner'
import { useAuth } from './useAuth'
import { validateNewPassword } from './password'

export function ResetPasswordPage() {
  const { status, session, updatePassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [repeated, setRepeated] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Nueva contrasena · Gastos Alba'
  }, [])

  if (status === 'loading') {
    return (
      <div className="screen-center">
        <Spinner label="Comprobando enlace…" />
      </div>
    )
  }

  if (done) return <Navigate to="/login" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)

    const problem = validateNewPassword(password, repeated)
    if (problem) {
      setError(problem)
      return
    }

    setSubmitting(true)
    const result = await updatePassword(password)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error ?? 'No se ha podido cambiar la contrasena.')
      return
    }
    await signOut()
    setDone(true)
  }

  return (
    <div className="screen-center">
      <form className="card card--narrow" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="brand brand--stacked">
          <img src="/icons/icon.svg" alt="" width={48} height={48} />
          <h1 className="title">Nueva contrasena</h1>
        </div>

        {!session ? (
          <p className="alert alert--error">
            Este enlace no esta activo o ha caducado. Pide otro desde la pantalla de entrada.
          </p>
        ) : null}

        <label className="field">
          <span className="field__label">Nueva contrasena</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Repetir contrasena</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={repeated}
            onChange={(event) => setRepeated(event.target.value)}
            required
          />
        </label>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="btn btn--primary btn--block" type="submit" disabled={submitting || !session}>
          {submitting ? 'Guardando…' : 'Guardar contrasena'}
        </button>

        <Link className="btn btn--ghost btn--block" to="/login">
          Volver a entrar
        </Link>
      </form>
    </div>
  )
}
