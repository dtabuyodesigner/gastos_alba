/** Tipos de dominio de Gastos Alba. Reflejan el esquema de supabase/migrations. */

export type UserRole = 'alba' | 'dani' | 'admin'
export type ExpenseStatus = 'pendiente' | 'pagado' | 'anulado'
export type SplitType = 'mitad' | 'porcentaje'

export interface Profile {
  id: string
  display_name: string
  email: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Expense {
  id: string
  created_by: string
  expense_date: string
  concept: string
  total_amount_cents: number
  currency: string
  dani_share_cents: number
  other_share_cents: number
  dani_share_percent: number
  other_share_percent: number
  split_type: SplitType
  status: ExpenseStatus
  notes: string | null
  created_at: string
  updated_at: string
  voided_at: string | null
}

export interface ExpensePhoto {
  id: string
  expense_id: string
  storage_path: string
  original_filename: string | null
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string
  created_at: string
}

export interface Payment {
  id: string
  paid_by: string
  paid_at: string
  amount_cents: number
  method: string | null
  notes: string | null
  created_at: string
}

/** Gasto con sus fotos, tal y como lo consume la interfaz. */
export interface ExpenseWithPhotos extends Expense {
  expense_photos: ExpensePhoto[]
}

/** Quien puede hacer que. Se refleja tambien en las politicas RLS. */
export const permissions = {
  /** Solo Dani y admin registran pagos. */
  canRegisterPayment: (role: UserRole): boolean => role === 'dani' || role === 'admin',
  /** Alba edita sus propios gastos mientras sigan pendientes; Dani y admin, cualquiera no anulado. */
  canEditExpense: (role: UserRole, userId: string, expense: Expense): boolean => {
    if (expense.status === 'anulado') return false
    if (role === 'dani' || role === 'admin') return true
    return expense.created_by === userId && expense.status === 'pendiente'
  },
  /** Anular es la unica via de "borrado": nunca se elimina fisicamente. */
  canVoidExpense: (role: UserRole, userId: string, expense: Expense): boolean => {
    if (expense.status === 'anulado') return false
    if (role === 'dani' || role === 'admin') return true
    return expense.created_by === userId && expense.status === 'pendiente'
  },
} as const

export const ROLE_LABELS: Record<UserRole, string> = {
  alba: 'Alba',
  dani: 'Dani',
  admin: 'Admin',
}

export const STATUS_LABELS: Record<ExpenseStatus, string> = {
  pendiente: 'Pendiente',
  pagado: 'Pagado',
  anulado: 'Anulado',
}
