import { Link } from 'react-router-dom'
import type { ExpenseWithPhotos } from '../../lib/types'
import { formatIsoDate } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import { StatusBadge } from '../../components/StatusBadge'
import { hasCurrentPhoto } from './photos'

interface ExpenseCardProps {
  expense: ExpenseWithPhotos
  /** Casilla de seleccion para el pago agrupado. */
  selectable?: boolean
  selected?: boolean
  onToggle?: (id: string) => void
}

export function ExpenseCard({ expense, selectable, selected, onToggle }: ExpenseCardProps) {
  const hasPhoto = hasCurrentPhoto(expense.expense_photos)

  return (
    <li className={`ticket ${expense.status === 'anulado' ? 'ticket--voided' : ''}`}>
      {selectable ? (
        <label className="ticket__check">
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={() => onToggle?.(expense.id)}
            aria-label={`Seleccionar ${expense.concept}`}
          />
        </label>
      ) : null}

      <Link to={`/gastos/${expense.id}`} className="ticket__body">
        <div className="ticket__top">
          <span className="ticket__concept">{expense.concept}</span>
          <span className="ticket__total">{formatCents(expense.total_amount_cents)}</span>
        </div>
        <div className="ticket__meta">
          <span>{formatIsoDate(expense.expense_date)}</span>
          <StatusBadge status={expense.status} />
          {hasPhoto ? (
            <span className="ticket__photo" title="Con foto">
              Foto
            </span>
          ) : (
            <span className="ticket__photo ticket__photo--missing" title="Sin foto">
              Sin foto
            </span>
          )}
        </div>
        <div className="ticket__share">
          Parte de Dani <strong>{formatCents(expense.dani_share_cents)}</strong>
          <span className="muted"> · {expense.dani_share_percent}%</span>
        </div>
      </Link>
    </li>
  )
}
