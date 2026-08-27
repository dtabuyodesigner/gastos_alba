import { supabase } from '../../lib/supabase'
import type { Expense, ExpenseStatus, ExpenseWithPhotos, SplitType } from '../../lib/types'
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
 * Orden deliberado: primero se sube la foto y despues se inserta el gasto, para
 * no dejar tickets sin justificante si la subida falla. El identificador se
 * genera en el cliente para poder agrupar la foto por gasto en el storage.
 * Contrapartida asumida: si falla la insercion posterior puede quedar un
 * fichero huerfano (ver docs/DECISIONES.md).
 */
export async function createExpense(input: CreateExpenseInput, userId: string): Promise<Expense> {
  const concept = input.concept.trim()
  if (!concept) throw new Error('El concepto no puede estar vacio.')
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error('El importe total no es valido.')
  }

  const split = computeSplit(input.totalCents, input.daniPercent)
  if (!isConsistentSplit(input.totalCents, split)) {
    throw new Error('El reparto no cuadra con el importe total.')
  }

  const id = crypto.randomUUID()
  const splitType: SplitType = split.daniPercent === DEFAULT_DANI_PERCENT ? 'mitad' : 'porcentaje'

  let storagePath: string | null = null
  let photoFile: File | null = null
  if (input.photo) {
    photoFile = input.photo
    storagePath = await uploadTicketPhoto(id, photoFile)
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      id,
      created_by: userId,
      expense_date: input.expenseDate,
      concept,
      total_amount_cents: input.totalCents,
      dani_share_cents: split.daniShareCents,
      other_share_cents: split.otherShareCents,
      dani_share_percent: split.daniPercent,
      other_share_percent: split.otherPercent,
      split_type: splitType,
      status: 'pendiente' satisfies ExpenseStatus,
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single()

  if (error) throw error

  if (storagePath && photoFile) {
    const { error: photoError } = await supabase.from('expense_photos').insert({
      expense_id: id,
      storage_path: storagePath,
      original_filename: photoFile.name.slice(0, 255),
      mime_type: photoFile.type || null,
      size_bytes: photoFile.size,
      uploaded_by: userId,
    })
    if (photoError) throw photoError
  }

  return data as Expense
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
