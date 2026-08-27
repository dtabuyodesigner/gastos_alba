import { useCallback, useEffect, useMemo } from 'react'
import { useAsyncData } from '../lib/useAsyncData'
import { listExpenses } from '../features/expenses/api'
import { listPayments } from '../features/payments/api'
import { paymentMethodLabel } from '../features/payments/methods'
import { formatCents } from '../lib/money'
import { formatMonthKey, formatTimestamp, monthKey } from '../lib/dates'
import type { ExpenseWithPhotos, Payment } from '../lib/types'
import { ExpenseCard } from '../features/expenses/ExpenseCard'
import { Spinner } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'

/** Historico completo: todo agrupado por mes, incluidos anulados, mas los pagos. */
export function HistoryPage() {
  const loader = useCallback(
    async (): Promise<{ expenses: ExpenseWithPhotos[]; payments: Payment[] }> => {
      const [expenses, payments] = await Promise.all([
        listExpenses({ status: 'todos', includeVoided: true }),
        listPayments(),
      ])
      return { expenses, payments }
    },
    [],
  )
  const { data, loading, error } = useAsyncData(loader)

  useEffect(() => {
    document.title = 'Historico · Gastos Alba'
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<string, ExpenseWithPhotos[]>()
    for (const expense of data?.expenses ?? []) {
      const key = monthKey(expense.expense_date)
      const bucket = map.get(key)
      if (bucket) bucket.push(expense)
      else map.set(key, [expense])
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data])

  return (
    <div className="page">
      <h1 className="page__title">Historico</h1>

      {loading ? <Spinner label="Cargando historico…" /> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}

      {!loading && !error && grouped.length === 0 ? <EmptyState title="Todavia no hay historico." /> : null}

      {grouped.map(([key, expenses]) => {
        const monthTotal = expenses
          .filter((expense) => expense.status !== 'anulado')
          .reduce((sum, expense) => sum + expense.dani_share_cents, 0)
        return (
          <section key={key} className="month">
            <h2 className="section__title">
              {formatMonthKey(key)}
              <span className="muted"> · Dani {formatCents(monthTotal)}</span>
            </h2>
            <ul className="ticket-list">
              {expenses.map((expense) => (
                <ExpenseCard key={expense.id} expense={expense} />
              ))}
            </ul>
          </section>
        )
      })}

      {data && data.payments.length > 0 ? (
        <section className="month">
          <h2 className="section__title">Pagos registrados</h2>
          <ul className="payment-list">
            {data.payments.map((payment) => (
              <li key={payment.id} className="payment">
                <span>{formatTimestamp(payment.paid_at)}</span>
                <strong>{formatCents(payment.amount_cents)}</strong>
                <span className="payment__method">{paymentMethodLabel(payment.method)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
