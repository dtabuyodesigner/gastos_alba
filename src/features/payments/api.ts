import { supabase } from '../../lib/supabase'
import type { Payment } from '../../lib/types'
import { validatePaymentMethod, type PaymentMethod } from './methods'

/**
 * Registra un pago de la parte de Dani sobre uno o varios gastos.
 *
 * Se hace via RPC (`register_payment`, SECURITY DEFINER) y no con inserts
 * sueltos desde el cliente, para que la creacion del pago, el reparto por
 * ticket y el cambio de estado ocurran en UNA transaccion. Asi nunca queda un
 * gasto marcado como pagado sin su pago asociado, ni al reves.
 */
export async function registerPayment(params: {
  expenseIds: string[]
  /** Como se pago fuera de la app. Obligatorio: el servidor tambien lo exige. */
  method: PaymentMethod
  notes?: string | null
  paidAt?: string | null
}): Promise<string | null> {
  if (params.expenseIds.length === 0) throw new Error('Selecciona al menos un ticket.')

  const methodProblem = validatePaymentMethod(params.method)
  if (methodProblem) throw new Error(methodProblem)

  const { data, error } = await supabase.rpc('register_payment', {
    p_expense_ids: params.expenseIds,
    p_method: params.method,
    p_notes: params.notes ?? null,
    p_paid_at: params.paidAt ?? null,
  })
  // Devuelve null cuando el lote suma cero (tickets con 0% para Dani): esos
  // se cierran sin registrar pago porque no hay dinero que mover.
  if (error) throw error
  return (data as string | null) ?? null
}

export async function listPayments(): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('paid_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Payment[]
}
