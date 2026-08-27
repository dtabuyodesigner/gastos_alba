/** Utilidades de fecha. Las fechas de gasto son `date` (sin hora) en formato ISO. */

/** Fecha de hoy en formato `YYYY-MM-DD` segun el reloj local del dispositivo. */
export function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** `2026-08-27` -> `27 ago 2026`. Devuelve el original si no es una fecha valida. */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!match) return iso ?? ''
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** Marca de tiempo completa para el historico de pagos. */
export function formatTimestamp(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** `2026-08` -> etiqueta de mes para agrupar el historico. */
export function monthKey(iso: string): string {
  return (iso ?? '').slice(0, 7)
}

export function formatMonthKey(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key ?? '')
  if (!match) return key ?? ''
  const [, year, month] = match
  const date = new Date(Number(year), Number(month) - 1, 1)
  const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date)
  return label.charAt(0).toUpperCase() + label.slice(1)
}
