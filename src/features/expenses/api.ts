import { supabase } from '../../lib/supabase'
import type { Expense, ExpenseStatus, ExpenseWithPhotos } from '../../lib/types'
import { computeSplit, isConsistentSplit, DEFAULT_DANI_PERCENT } from '../../lib/split'
import { uploadTicketPhoto } from '../photos/api'

const EXPENSE_COLUMNS = '*, expense_photos(*)'

export interface ExpenseFilters {
  status?: ExpenseStatus | 'todos'
  /** Los anulados quedan fuera salvo que se pidan expresamente. */
  includeVoided?: boolean
}

export async function listExpenses(filters: ExpenseFilters = {}): Promise<ExpenseWithPhotos[]> {
  let query = supabase
    .from('expenses')
    .select(EXPENSE_COLUMNS)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'todos') {
    query = query.eq('status', filters.status)
  } else if (!filters.includeVoided) {
    query = query.neq('status', 'anulado')
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ExpenseWithPhotos[]
}

export async function getExpense(id: string): Promise<ExpenseWithPhotos | null> {
  const { data, error } = await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as ExpenseWithPhotos | null) ?? null
}

export interface CreateExpenseInput {
  concept: string
  expenseDate: string
  totalCents: number
  daniPercent: number
  notes?: string
  photo?: File | null
}

/**
 * Crea un gasto con su foto.
 *
 * Orden deliberado: primero se sube la foto y despues se crea el gasto, para no
 * dejar tickets sin justificante si la subida falla (que en movil con mala
 * cobertura es lo que mas falla).
 *
 * La fila del gasto y la de la foto se insertan mediante la funcion
 * `create_expense`, que las mete en UNA transaccion: nunca queda un ticket
 * visible cuya foto no este enlazada. El reparto lo recalcula el servidor a
 * partir del total y del porcentaje.
 *
 * Contrapartida asumida: si la subida va bien pero la insercion falla, queda un
 * fichero huerfano en el bucket (ver docs/DECISIONES.md).
 */
export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const concept = input.concept.trim()
  if (!concept) throw new Error('El concepto no puede estar vacio.')
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error('El importe total no es valido.')
  }

  // Se valida tambien en cliente para dar un error util antes de ir al servidor.
  const split = computeSplit(input.totalCents, input.daniPercent)
  if (!isConsistentSplit(input.totalCents, split)) {
    throw new Error('El reparto no cuadra con el importe total.')
  }

  const id = crypto.randomUUID()

  let storagePath: string | null = null
  if (input.photo) {
    storagePath = await uploadTicketPhoto(id, input.photo)
  }

  const { error } = await supabase.rpc('create_expense', {
    p_id: id,
    p_concept: concept,
    p_expense_date: input.expenseDate,
    p_total_amount_cents: input.totalCents,
    p_dani_percent: split.daniPercent,
    p_notes: input.notes?.trim() || null,
    p_storage_path: storagePath,
    p_original_filename: input.photo ? input.photo.name.slice(0, 255) : null,
    p_mime_type: input.photo?.type || null,
    p_size_bytes: input.photo?.size ?? null,
  })
  if (error) throw error

  const created = await getExpense(id)
  if (!created) throw new Error('El ticket se ha creado pero no se ha podido leer.')
  return created
}

export interface UpdateExpenseInput {
  concept: string
  expenseDate: string
  totalCents: number
  daniPercent: number
  notes?: string
}

export async function updateExpense(id: string, input: UpdateExpenseInput): Promise<Expense> {
  const concept = input.concept.trim()
  if (!concept) throw new Error('El concepto no puede estar vacio.')
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error('El importe total no es valido.')
  }

  const split = computeSplit(input.totalCents, input.daniPercent)
  if (!isConsistentSplit(input.totalCents, split)) {
    throw new Error('El reparto no cuadra con el importe total.')
  }

  const { data, error } = await supabase
    .from('expenses')
    .update({
      concept,
      expense_date: input.expenseDate,
      total_amount_cents: input.totalCents,
      dani_share_cents: split.daniShareCents,
      other_share_cents: split.otherShareCents,
      dani_share_percent: split.daniPercent,
      other_share_percent: split.otherPercent,
      split_type: split.daniPercent === DEFAULT_DANI_PERCENT ? 'mitad' : 'porcentaje',
      notes: input.notes?.trim() || null,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as Expense
}

/**
 * Anula un gasto. NO existe borrado fisico desde la interfaz: la fila se
 * conserva y el historico sigue siendo consultable.
 */
export async function voidExpense(id: string): Promise<void> {
  const { error } = await supabase.rpc('void_expense', { p_expense_id: id })
  if (error) throw error
}

export interface ExpenseTotals {
  pendienteCents: number
  pagadoCents: number
  totalTicketsCents: number
  pendienteCount: number
}

/** Resumen para la pantalla de inicio. Se calcula en cliente sobre lo ya cargado. */
export function summarize(expenses: ExpenseWithPhotos[]): ExpenseTotals {
  return expenses.reduce<ExpenseTotals>(
    (acc, expense) => {
      if (expense.status === 'anulado') return acc
      acc.totalTicketsCents += expense.total_amount_cents
      if (expense.status === 'pendiente') {
        acc.pendienteCents += expense.dani_share_cents
        acc.pendienteCount += 1
      } else if (expense.status === 'pagado') {
        acc.pagadoCents += expense.dani_share_cents
      }
      return acc
    },
    { pendienteCents: 0, pagadoCents: 0, totalTicketsCents: 0, pendienteCount: 0 },
  )
}
