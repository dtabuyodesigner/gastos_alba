/**
 * Reparto de un gasto entre Dani y la "otra parte".
 *
 * La "otra parte" no es un usuario ni tiene cuenta: es solo el resto economico
 * del ticket (ver GASTOS_ALBA.md). Aqui solo se calculan centimos.
 *
 * Reglas de redondeo, explicitas a proposito:
 *  1. La parte de Dani se calcula con redondeo half-up sobre el porcentaje.
 *  2. La otra parte es SIEMPRE el resto (total - parte de Dani).
 * De esta forma `dani + otra === total` se cumple por construccion y jamas se
 * pierde ni se inventa un centimo por redondeo.
 */

export const DEFAULT_DANI_PERCENT = 50

export interface Split {
  daniShareCents: number
  otherShareCents: number
  daniPercent: number
  otherPercent: number
}

/** Redondeo half-up sobre valores no negativos (Math.round basta, pero se deja explicito). */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5)
}

/**
 * Calcula el reparto a partir del total y del porcentaje de Dani.
 * `daniPercent` admite decimales (p. ej. 33,33) y se acota a [0, 100].
 */
export function computeSplit(totalCents: number, daniPercent: number): Split {
  const total = Math.max(0, Math.trunc(totalCents))
  const percent = clampPercent(daniPercent)
  const daniShareCents = Math.min(total, roundHalfUp((total * percent) / 100))
  return {
    daniShareCents,
    otherShareCents: total - daniShareCents,
    daniPercent: percent,
    otherPercent: roundPercent(100 - percent),
  }
}

/** Reparto por defecto del MVP: 50/50. */
export function defaultSplit(totalCents: number): Split {
  return computeSplit(totalCents, DEFAULT_DANI_PERCENT)
}

/** Acota a [0, 100] y normaliza a 2 decimales; NaN se trata como 0. */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return roundPercent(Math.min(100, Math.max(0, percent)))
}

function roundPercent(percent: number): number {
  return Math.round(percent * 100) / 100
}

/** True si el reparto no es el 50/50 por defecto. */
export function isCustomSplit(daniPercent: number): boolean {
  return clampPercent(daniPercent) !== DEFAULT_DANI_PERCENT
}

/**
 * Invariante que tambien vive como CHECK constraint en la base de datos.
 * Se comprueba en cliente para dar un error util antes de llegar a Postgres.
 */
export function isConsistentSplit(totalCents: number, split: Split): boolean {
  return (
    Number.isSafeInteger(split.daniShareCents) &&
    Number.isSafeInteger(split.otherShareCents) &&
    split.daniShareCents >= 0 &&
    split.otherShareCents >= 0 &&
    split.daniShareCents + split.otherShareCents === Math.trunc(totalCents)
  )
}
