import { parseAmountToCents } from '../../lib/money'

/**
 * Reglas de validacion del alta de un ticket, en un modulo puro y sin React
 * para poder probarlas de verdad.
 *
 * La foto es OBLIGATORIA en el MVP: el valor de la aplicacion esta en tener el
 * justificante, no solo la cifra. La misma regla se aplica en el servidor,
 * dentro de create_expense(); esto solo la adelanta para dar un error util
 * antes de subir nada.
 */
export interface ExpenseDraft {
  concept: string
  amount: string
  expenseDate: string
  hasPhoto: boolean
}

/** Devuelve el primer problema encontrado, o `null` si el ticket se puede guardar. */
export function validateExpenseDraft(draft: ExpenseDraft): string | null {
  if (!draft.hasPhoto) return 'Anade la foto del ticket: es obligatoria.'
  if (!draft.concept.trim()) return 'Escribe un concepto.'

  const parsed = parseAmountToCents(draft.amount)
  if (!parsed.ok) return parsed.error

  if (!draft.expenseDate) return 'Indica la fecha del ticket.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expenseDate)) return 'La fecha del ticket no es valida.'

  return null
}
