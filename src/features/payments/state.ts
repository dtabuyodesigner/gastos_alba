import type { Payment } from '../../lib/types'

/**
 * Estado de un pago.
 *
 * Deshacer un pago no lo borra: se queda con `voided_at` puesto y sigue en el
 * historico. Estas ayudas evitan que un pago deshecho se cuele en un total y
 * haga creer que se pago algo que no.
 */

export function isPaymentActive(payment: Pick<Payment, 'voided_at'>): boolean {
  return payment.voided_at === null
}

export function activePayments(payments: Payment[]): Payment[] {
  return payments.filter(isPaymentActive)
}

/** Suma de los pagos vigentes. Los deshechos no cuentan. */
export function totalPaidCents(payments: Payment[]): number {
  return activePayments(payments).reduce((total, payment) => total + payment.amount_cents, 0)
}

export function paymentStateLabel(payment: Pick<Payment, 'voided_at'>): string {
  return isPaymentActive(payment) ? 'Pagado' : 'Deshecho'
}
