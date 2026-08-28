import { describe, it, expect } from 'vitest'
import { activePayments, isPaymentActive, paymentStateLabel, totalPaidCents } from '../state'
import type { Payment } from '../../../lib/types'

function payment(patch: Partial<Payment> = {}): Payment {
  return {
    id: 'pago-1',
    paid_by: 'dani-id',
    paid_at: '2026-08-27T10:00:00Z',
    amount_cents: 1000,
    method: 'bizum',
    notes: null,
    created_at: '2026-08-27T10:00:00Z',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...patch,
  }
}

const vigente = payment({ id: 'vigente', amount_cents: 1000 })
const deshecho = payment({
  id: 'deshecho',
  amount_cents: 5000,
  voided_at: '2026-08-28T09:00:00Z',
  voided_by: 'dani-id',
  void_reason: 'Ticket equivocado',
})

describe('isPaymentActive', () => {
  it('un pago deshecho deja de estar vigente, pero sigue existiendo', () => {
    expect(isPaymentActive(vigente)).toBe(true)
    expect(isPaymentActive(deshecho)).toBe(false)
  })
})

describe('activePayments', () => {
  it('filtra los deshechos sin perderlos de la lista original', () => {
    const todos = [vigente, deshecho]
    expect(activePayments(todos).map((p) => p.id)).toEqual(['vigente'])
    expect(todos).toHaveLength(2)
  })
})

describe('totalPaidCents', () => {
  it('un pago deshecho no cuenta como pagado', () => {
    // Es el punto del que depende que el resumen no mienta: 5.000 centimos
    // deshechos no pueden sumarse a lo pagado.
    expect(totalPaidCents([vigente, deshecho])).toBe(1000)
    expect(totalPaidCents([deshecho])).toBe(0)
    expect(totalPaidCents([])).toBe(0)
  })

  it('suma varios pagos vigentes', () => {
    expect(totalPaidCents([vigente, payment({ id: 'otro', amount_cents: 235 })])).toBe(1235)
  })
})

describe('paymentStateLabel', () => {
  it('nombra el estado en la interfaz', () => {
    expect(paymentStateLabel(vigente)).toBe('Pagado')
    expect(paymentStateLabel(deshecho)).toBe('Deshecho')
  })
})
