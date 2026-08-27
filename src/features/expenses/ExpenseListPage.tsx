import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useAsyncData } from '../../lib/useAsyncData'
import { humanizeError } from '../../lib/supabase'
import { formatCents } from '../../lib/money'
import { permissions, type ExpenseStatus } from '../../lib/types'
import { listExpenses } from './api'
import { registerPayment } from '../payments/api'
import { PaymentForm } from '../payments/PaymentForm'
import type { PaymentMethod } from '../payments/methods'
import { ExpenseCard } from './ExpenseCard'
import { Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'

type Filter = ExpenseStatus | 'todos'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'pagado', label: 'Pagados' },
  { value: 'todos', label: 'Todos' },
  { value: 'anulado', label: 'Anulados' },
]

export function ExpenseListPage() {
  const { profile } = useAuth()
  const [filter, setFilter] = useState<Filter>('pendiente')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [payError, setPayError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [payingOpen, setPayingOpen] = useState(false)

  const loader = useCallback(() => listExpenses({ status: filter, includeVoided: filter === 'todos' }), [filter])
  const { data, loading, error, reload } = useAsyncData(loader)
  const expenses = useMemo(() => data ?? [], [data])

  useEffect(() => {
    document.title = 'Tickets · Gastos Alba'
  }, [])

  // Al cambiar de filtro la seleccion deja de tener sentido.
  useEffect(() => {
    setSelected(new Set())
    setPayError(null)
    setPayingOpen(false)
  }, [filter])

  const canPay = profile ? permissions.canRegisterPayment(profile.role) : false
  const groupingEnabled = canPay && filter === 'pendiente'

  const selectedTotal = useMemo(
    () =>
      expenses
        .filter((expense) => selected.has(expense.id))
        .reduce((sum, expense) => sum + expense.dani_share_cents, 0),
    [expenses, selected],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleGroupedPayment(method: PaymentMethod, notes: string) {
    if (paying || selected.size === 0) return
    setPaying(true)
    setPayError(null)
    try {
      await registerPayment({ expenseIds: [...selected], method, notes: notes || null })
      setSelected(new Set())
      setPayingOpen(false)
      await reload()
    } catch (err) {
      setPayError(humanizeError(err))
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">Tickets</h1>

      <div className="filters" role="tablist" aria-label="Filtrar tickets">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            className={`chip ${filter === option.value ? 'chip--active' : ''}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? <Spinner label="Cargando tickets…" /> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}

      {!loading && !error && expenses.length === 0 ? (
        <EmptyState title="No hay tickets aqui.">
          <p className="muted">Cuando se suba un ticket aparecera en esta lista.</p>
        </EmptyState>
      ) : null}

      {expenses.length > 0 ? (
        <ul className="ticket-list">
          {expenses.map((expense) => (
            <ExpenseCard
              key={expense.id}
              expense={expense}
              selectable={groupingEnabled}
              selected={selected.has(expense.id)}
              onToggle={toggle}
            />
          ))}
        </ul>
      ) : null}

      {payError ? <p className="alert alert--error">{payError}</p> : null}

      {groupingEnabled && selected.size > 0 && payingOpen ? (
        <PaymentForm
          amountCents={selectedTotal}
          ticketCount={selected.size}
          busy={paying}
          onCancel={() => setPayingOpen(false)}
          onConfirm={(method, notes) => void handleGroupedPayment(method, notes)}
        />
      ) : null}

      {groupingEnabled && selected.size > 0 && !payingOpen ? (
        <div className="paybar" role="region" aria-label="Pago agrupado">
          <div className="paybar__info">
            <span>
              {selected.size} {selected.size === 1 ? 'ticket' : 'tickets'}
            </span>
            <strong>{formatCents(selectedTotal)}</strong>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setPayingOpen(true)}>
            Marcar como pagados
          </button>
        </div>
      ) : null}
    </div>
  )
}
