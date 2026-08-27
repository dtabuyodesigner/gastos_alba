import type { ExpensePhoto } from '../../lib/types'

/**
 * Fotos vigentes de un ticket.
 *
 * Una foto sustituida no se borra: se queda con `replaced_at` puesto, tanto en
 * la tabla como en el bucket. El filtro se hace aqui, en el cliente, y ademas
 * la base de datos garantiza con un indice unico parcial que no puede haber dos
 * vigentes a la vez para el mismo ticket.
 */
export function currentPhotos(photos: ExpensePhoto[] | null | undefined): ExpensePhoto[] {
  return (photos ?? []).filter((photo) => photo.replaced_at === null)
}

/** Fotos que en su dia fueron el justificante y luego se sustituyeron. */
export function replacedPhotos(photos: ExpensePhoto[] | null | undefined): ExpensePhoto[] {
  return (photos ?? [])
    .filter((photo) => photo.replaced_at !== null)
    .sort((a, b) => (b.replaced_at ?? '').localeCompare(a.replaced_at ?? ''))
}

export function hasCurrentPhoto(photos: ExpensePhoto[] | null | undefined): boolean {
  return currentPhotos(photos).length > 0
}
