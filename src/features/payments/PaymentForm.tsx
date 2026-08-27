import { useState } from 'react'
import { formatCents } from '../../lib/money'
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentMethod } from './methods'

interface PaymentFormProps {
  /** Importe que se va a registrar, para que quede a la vista al confirmar. */
  amountCents: number
  /** Cuantos tickets cubre este pago. */
  ticketCount: number
  busy: boolean
  onCancel: () => void
  onConfirm: (method: PaymentMethod, notes: string) => void
}

/**
 * Panel compacto para registrar como se ha pagado.
 *
 * Registrar, no pagar: la aplicacion no mueve dinero ni habla con ningun banco.
 * Aqui solo se anota la forma en que se salda fuera, para que el historico
 * tenga sentido dentro de un mes.
 *
 * El metodo es obligatorio y no viene preseleccionado a proposito: si viniera,
 * se acabaria registrando "Bizum" en todo por inercia y el dato dejaria de
 * servir para nada.
 */
export function PaymentForm({ amountCents, ticketCount, busy, onCancel, onConfirm }: PaymentFormProps) {
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [notes, setNotes] = useState('')

  return (
    <section className="paysheet" aria-label="Registrar pago">
      <div className="paysheet__head">
        <span className="muted">
          {ticketCount === 1 ? '1 ticket' : `${ticketCount} tickets`}
        </span>
        <strong className="paysheet__amount">{formatCents(amountCents)}</strong>
      </div>

      <fieldset className="field fieldset">
        <legend className="field__label">Como has pagado</legend>
        <div className="split">
          {PAYMENT_METHODS.map((option) => (
            <button
              key={option}
              type="button"
              className={`chip ${method === option ? 'chip--active' : ''}`}
              aria-pressed={method === option}
              onClick={() => setMethod(option)}
            >
              {paymentMethodLabel(option)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="field__label">
          Nota <span className="muted">(opcional)</span>
        </span>
        <input
          className="input"
          type="text"
          maxLength={200}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || method === null}
          onClick={() => method && onConfirm(method, notes)}
        >
          {busy ? 'Registrando…' : method ? 'Confirmar pago' : 'Elige metodo'}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  )
}
