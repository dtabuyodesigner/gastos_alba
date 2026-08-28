import { useState } from 'react'
import { formatCents } from '../../lib/money'
import { paymentMethodLabel } from './methods'
import type { Payment } from '../../lib/types'

interface Props {
  payment: Payment
  /** Cuantos tickets cubre el pago: deshacerlo los devuelve todos a pendiente. */
  ticketCount: number
  busy: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

/**
 * Confirmacion para deshacer un pago.
 *
 * Deja claro el alcance antes de pulsar: si el pago cubria varios tickets,
 * vuelven todos. Es la parte que mas se malinterpreta del pago agrupado.
 */
export function VoidPaymentForm({ payment, ticketCount, busy, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('')

  return (
    <section className="paysheet" aria-label="Deshacer pago">
      <div className="paysheet__head">
        <span className="muted">{paymentMethodLabel(payment.method)}</span>
        <strong className="paysheet__amount">{formatCents(payment.amount_cents)}</strong>
      </div>

      <p className="alert alert--warn">
        {ticketCount > 1
          ? `Este pago cubre ${ticketCount} tickets. Al deshacerlo vuelven todos a pendiente.`
          : 'El ticket vuelve a pendiente. El pago queda en el historico como deshecho.'}
      </p>

      <label className="field">
        <span className="field__label">
          Motivo <span className="muted">(opcional)</span>
        </span>
        <input
          className="input"
          type="text"
          maxLength={200}
          placeholder="Me equivoque de ticket…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      <div className="actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onConfirm(reason)}>
          {busy ? 'Deshaciendo…' : 'Deshacer pago'}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
