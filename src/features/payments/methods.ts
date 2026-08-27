/**
 * Metodo de pago: como se hizo el pago FUERA de la aplicacion.
 *
 * Es una etiqueta de registro y nada mas. Aqui no se mueve dinero, no hay
 * integracion con Bizum ni con ningun banco, y no se guarda ningun dato
 * bancario. Sirve para que dentro de un mes se pueda mirar el historico y saber
 * como se salda cada cosa.
 *
 * Esta lista tiene que coincidir con el enum `payment_method` de
 * supabase/migrations/0001_init.sql.
 */

export const PAYMENT_METHODS = ['bizum', 'transferencia', 'efectivo', 'otro'] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

const LABELS: Record<PaymentMethod, string> = {
  bizum: 'Bizum',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  otro: 'Otro',
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
}

/** Etiqueta para la interfaz. Un valor desconocido se muestra tal cual, sin romper nada. */
export function paymentMethodLabel(value: string | null | undefined): string {
  if (!value) return 'Sin metodo'
  if (isPaymentMethod(value)) return LABELS[value]
  return value
}

/** Valida antes de llamar al servidor, para dar un error util cuanto antes. */
export function validatePaymentMethod(value: string | null | undefined): string | null {
  if (!value) return 'Indica como has pagado.'
  if (!isPaymentMethod(value)) return 'Metodo de pago no valido.'
  return null
}
