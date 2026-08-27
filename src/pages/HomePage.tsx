import { useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth'
import { useAsyncData } from '../lib/useAsyncData'
import { listExpenses, summarize } from '../features/expenses/api'
import { formatCents } from '../lib/money'
import { ExpenseCard } from '../features/expenses/ExpenseCard'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'

/** Resumen de un vistazo: cuanto debe Dani y que tickets estan pendientes. */
export function HomePage() {
  const { profile } = useAuth()
  const loader = useCallback(() => listExpenses(), [])
  const { data, loading, error } = useAsyncData(loader)

  useEffect(() => {
    document.title = 'Gastos Alba'
  }, [])

  const expenses = data ?? []
  const totals = summarize(expenses)
  const pendientes = expenses.filter((expense) => expense.status === 'pendiente').slice(0, 5)

  return (
    <div className="page">
      <h1 className="page__title">Hola{profile ? `, ${profile.display_name}` : ''}</h1>

      {loading ? <Spinner label="Cargando resumen…" /> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}

      {!loading && !error ? (
        <>
          <section className="summary">
            <div className="summary__card summary__card--main">
              <span className="summary__label">Pendiente de Dani</span>
              <strong className="summary__value">{formatCents(totals.pendienteCents)}</strong>
              <span className="muted">
                {totals.pendienteCount} {totals.pendienteCount === 1 ? 'ticket' : 'tickets'}
              </span>
            </div>
            <div className="summary__card">
              <span className="summary__label">Ya pagado</span>
              <strong className="summary__value">{formatCents(totals.pagadoCents)}</strong>
            </div>
            <div className="summary__card">
              <span className="summary__label">Total tickets</span>
              <strong className="summary__value">{formatCents(totals.totalTicketsCents)}</strong>
            </div>
          </section>

          <Link className="btn btn--primary btn--block" to="/gastos/nuevo">
            + Nuevo ticket
          </Link>

          <h2 className="section__title">Ultimos pendientes</h2>
          {pendientes.length === 0 ? (
            <EmptyState title="Nada pendiente." />
          ) : (
            <ul className="ticket-list">
              {pendientes.map((expense) => (
                <ExpenseCard key={expense.id} expense={expense} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  )
}
