import { describe, it, expect } from 'vitest'
import { permissions, type Expense, type ExpenseStatus } from '../types'

const ALBA = 'alba-user-id'
const DANI = 'dani-user-id'

function expenseWith(status: ExpenseStatus, createdBy = ALBA): Expense {
  return {
    id: 'expense-1',
    created_by: createdBy,
    expense_date: '2026-08-01',
    concept: 'Farmacia',
    total_amount_cents: 1235,
    currency: 'EUR',
    dani_share_cents: 618,
    other_share_cents: 617,
    dani_share_percent: 50,
    other_share_percent: 50,
    split_type: 'mitad',
    status,
    notes: null,
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    voided_at: status === 'anulado' ? '2026-08-02T10:00:00Z' : null,
  }
}

describe('canRegisterPayment', () => {
  it('solo Dani y admin registran pagos', () => {
    expect(permissions.canRegisterPayment('dani')).toBe(true)
    expect(permissions.canRegisterPayment('admin')).toBe(true)
    expect(permissions.canRegisterPayment('alba')).toBe(false)
  })
})

describe('canEditExpense', () => {
  it('Alba edita sus tickets solo mientras siguen pendientes', () => {
    expect(permissions.canEditExpense('alba', ALBA, expenseWith('pendiente'))).toBe(true)
    expect(permissions.canEditExpense('alba', ALBA, expenseWith('pagado'))).toBe(false)
  })

  it('Alba no edita tickets de otra persona', () => {
    expect(permissions.canEditExpense('alba', ALBA, expenseWith('pendiente', DANI))).toBe(false)
  })

  it('Dani y admin corrigen cualquier ticket no anulado', () => {
    expect(permissions.canEditExpense('dani', DANI, expenseWith('pendiente'))).toBe(true)
    expect(permissions.canEditExpense('dani', DANI, expenseWith('pagado'))).toBe(true)
    expect(permissions.canEditExpense('admin', DANI, expenseWith('pagado'))).toBe(true)
  })

  it('un ticket anulado no se edita nunca', () => {
    for (const role of ['alba', 'dani', 'admin'] as const) {
      expect(permissions.canEditExpense(role, ALBA, expenseWith('anulado'))).toBe(false)
    }
  })
})

describe('canVoidExpense', () => {
  it('Alba solo anula sus tickets pendientes', () => {
    expect(permissions.canVoidExpense('alba', ALBA, expenseWith('pendiente'))).toBe(true)
    expect(permissions.canVoidExpense('alba', ALBA, expenseWith('pagado'))).toBe(false)
    expect(permissions.canVoidExpense('alba', ALBA, expenseWith('pendiente', DANI))).toBe(false)
  })

  it('nunca se puede anular dos veces', () => {
    expect(permissions.canVoidExpense('admin', DANI, expenseWith('anulado'))).toBe(false)
  })
})
