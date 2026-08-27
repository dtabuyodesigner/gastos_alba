/**
 * Dinero en Gastos Alba.
 *
 * REGLA INNEGOCIABLE: la fuente de verdad de cualquier importe es un entero de
 * centimos. Los `number` en coma flotante solo aparecen de forma transitoria al
 * leer lo que teclea una persona y al pintar en pantalla, nunca en la base de
 * datos ni en los calculos de reparto.
 */

export const CURRENCY = 'EUR'

const eurFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Formatea centimos como importe en euros: 1235 -> "12,35 €". */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return eurFormatter.format(0)
  return eurFormatter.format(Math.trunc(cents) / 100)
}

/** Igual que `formatCents` pero sin simbolo de moneda: 1235 -> "12,35". */
export function formatCentsPlain(cents: number): string {
  if (!Number.isFinite(cents)) return '0,00'
  const value = Math.trunc(cents)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

export type ParseResult =
  | { ok: true; cents: number }
  | { ok: false; error: string }

/**
 * Convierte lo que escribe una persona ("12,35", "12.35", "1.234,50", "12 €")
 * en centimos enteros.
 *
 * Se rechaza en vez de adivinar cuando la entrada es ambigua o invalida: en una
 * app de dinero es preferible un error visible a un importe silenciosamente mal.
 */
export function parseAmountToCents(input: string): ParseResult {
  const raw = (input ?? '').trim()
  if (raw === '') return { ok: false, error: 'Introduce un importe.' }

  // Fuera simbolos de moneda y espacios (incluido el espacio fino de es-ES).
  let s = raw.replace(/[€\s]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('-')) return { ok: false, error: 'El importe no puede ser negativo.' }

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // "1.234,50" (es-ES) o "1,234.50" (en-US): manda el ultimo separador.
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const thousandsSep = decimalSep === ',' ? '.' : ','
    s = s.split(thousandsSep).join('')
    s = s.replace(decimalSep, '.')
  } else if (hasComma) {
    s = s.replace(',', '.')
  } else if (hasDot) {
    // Un solo punto con 3 decimales exactos se lee como separador de miles ("1.234").
    const [, decimals = ''] = s.split('.')
    if (decimals.length === 3) s = s.replace('.', '')
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: 'Importe no valido.' }

  const [whole = '0', decimals = ''] = s.split('.')
  if (decimals.length > 2) return { ok: false, error: 'Como maximo dos decimales.' }

  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return { ok: false, error: 'Importe demasiado grande.' }
  if (cents <= 0) return { ok: false, error: 'El importe debe ser mayor que cero.' }
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, error: 'Importe demasiado grande.' }

  return { ok: true, cents }
}

/** Tope defensivo: 1.000.000 € por ticket. Evita erratas del tipo "1235" -> 1235 €. */
export const MAX_AMOUNT_CENTS = 100_000_000

/** Valor para un `<input type="number" step="0.01">` a partir de centimos. */
export function centsToInputValue(cents: number): string {
  return (Math.trunc(cents) / 100).toFixed(2)
}
