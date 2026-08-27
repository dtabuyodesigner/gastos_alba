import { describe, it, expect } from 'vitest'
import { validateExpenseDraft, type ExpenseDraft } from '../validation'

/** Borrador valido; cada test rompe solo el campo que le interesa. */
function draft(patch: Partial<ExpenseDraft> = {}): ExpenseDraft {
  return {
    concept: 'Farmacia',
    amount: '12,35',
    expenseDate: '2026-08-27',
    hasPhoto: true,
    ...patch,
  }
}

describe('validateExpenseDraft', () => {
  it('acepta un ticket completo', () => {
    expect(validateExpenseDraft(draft())).toBeNull()
  })

  it('rechaza un ticket sin foto', () => {
    // La foto es el justificante: sin ella el ticket no vale para nada.
    expect(validateExpenseDraft(draft({ hasPhoto: false }))).toBe(
      'Anade la foto del ticket: es obligatoria.',
    )
  })

  it('exige la foto antes que cualquier otra cosa', () => {
    // Sin foto no tiene sentido quejarse del concepto o del importe: lo primero
    // que hay que decirle a Alba es que falta la foto.
    const roto = draft({ hasPhoto: false, concept: '   ', amount: 'abc', expenseDate: '' })
    expect(validateExpenseDraft(roto)).toBe('Anade la foto del ticket: es obligatoria.')
  })

  it('rechaza un concepto vacio o solo con espacios', () => {
    expect(validateExpenseDraft(draft({ concept: '' }))).toBe('Escribe un concepto.')
    expect(validateExpenseDraft(draft({ concept: '   ' }))).toBe('Escribe un concepto.')
  })

  it('propaga el error concreto del importe', () => {
    expect(validateExpenseDraft(draft({ amount: '' }))).toBe('Introduce un importe.')
    expect(validateExpenseDraft(draft({ amount: 'abc' }))).toBe('Importe no valido.')
    expect(validateExpenseDraft(draft({ amount: '0' }))).toBe('El importe debe ser mayor que cero.')
    expect(validateExpenseDraft(draft({ amount: '12,345' }))).toBe('Como maximo dos decimales.')
  })

  it('exige una fecha con formato de fecha', () => {
    expect(validateExpenseDraft(draft({ expenseDate: '' }))).toBe('Indica la fecha del ticket.')
    expect(validateExpenseDraft(draft({ expenseDate: '27/08/2026' }))).toBe(
      'La fecha del ticket no es valida.',
    )
  })

  it('acepta el importe minimo de un centimo con foto', () => {
    expect(validateExpenseDraft(draft({ amount: '0,01' }))).toBeNull()
  })
})
