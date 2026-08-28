import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { Spinner } from '../../components/Spinner'

/**
 * Login por email y contrasena.
 *
 * No hay registro publico a proposito: las cuentas se crean de forma controlada
 * (ver docs/supabase/BOOTSTRAP.md). Tampoco se ofrece "crear cuenta" en la
 * interfaz para no invitar a ello.
 */
export function LoginPage() {
  const { status, signIn, requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [resetMode, setResetMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Entrar · Gastos Alba'
  }, [])

  if (status === 'loading') {
    return (
      <div className="screen-center">
        <Spinner label="Comprobando sesion…" />
      </div>
    )
  }

  if (status === 'ready') return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setNotice(null)

    if (resetMode) {
      if (!email.trim()) {
        setError('Escribe tu email.')
        return
      }
      setSubmitting(true)
      const result = await requestPasswordReset(email)
      setSubmitting(false)
      if (!result.ok) {
        setError(result.error ?? 'No se ha podido enviar el enlace.')
        return
      }
      setNotice('Te hemos enviado un enlace para cambiar la contrasena.')
      return
    }

    if (!email.trim() || !password) {
      setError('Rellena email y contrasena.')
      return
    }

    setSubmitting(true)
    const result = await signIn(email, password)
    setSubmitting(false)
    if (!result.ok) setError(result.error ?? 'No se ha podido iniciar sesion.')
  }

  return (
    <div className="screen-center">
      <form className="card card--narrow" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="brand brand--stacked">
          <img src="/icons/icon.svg" alt="" width={48} height={48} />
          <h1 className="title">Gastos Alba</h1>
        </div>

        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="input"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Contrasena</span>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="alert alert--success" role="status">
            {notice}
          </p>
        ) : null}

        <button className="btn btn--primary btn--block" type="submit" disabled={submitting}>
          {submitting ? (resetMode ? 'Enviando…' : 'Entrando…') : resetMode ? 'Enviar enlace' : 'Entrar'}
        </button>

        <button
          className="btn btn--ghost btn--block"
          type="button"
          disabled={submitting}
          onClick={() => {
            setResetMode((current) => !current)
            setError(null)
            setNotice(null)
          }}
        >
          {resetMode ? 'Volver a entrar' : 'He olvidado mi contrasena'}
        </button>
      </form>
    </div>
  )
}
