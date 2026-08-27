import { describe, it, expect } from 'vitest'
import { currentPhotos, replacedPhotos, hasCurrentPhoto } from '../photos'
import type { ExpensePhoto } from '../../../lib/types'

function photo(patch: Partial<ExpensePhoto> = {}): ExpensePhoto {
  return {
    id: 'p1',
    expense_id: 'expense-1',
    storage_path: 'expense-1/uno.jpg',
    original_filename: 'ticket.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    uploaded_by: 'alba-id',
    created_at: '2026-08-27T10:00:00Z',
    replaced_at: null,
    replaced_by: null,
    ...patch,
  }
}

const vigente = photo({ id: 'nueva', storage_path: 'expense-1/nueva.jpg' })
const antigua = photo({
  id: 'antigua',
  storage_path: 'expense-1/antigua.jpg',
  replaced_at: '2026-08-27T11:00:00Z',
  replaced_by: 'alba-id',
})
const masAntigua = photo({
  id: 'mas-antigua',
  storage_path: 'expense-1/mas-antigua.jpg',
  replaced_at: '2026-08-26T09:00:00Z',
  replaced_by: 'alba-id',
})

describe('currentPhotos', () => {
  it('devuelve solo la foto vigente, no las sustituidas', () => {
    expect(currentPhotos([antigua, vigente, masAntigua]).map((p) => p.id)).toEqual(['nueva'])
  })

  it('devuelve vacio si todas han sido sustituidas', () => {
    expect(currentPhotos([antigua, masAntigua])).toEqual([])
  })

  it('tolera un ticket sin fotos', () => {
    expect(currentPhotos([])).toEqual([])
    expect(currentPhotos(null)).toEqual([])
    expect(currentPhotos(undefined)).toEqual([])
  })
})

describe('replacedPhotos', () => {
  it('devuelve las sustituidas, de la mas reciente a la mas antigua', () => {
    expect(replacedPhotos([masAntigua, vigente, antigua]).map((p) => p.id)).toEqual([
      'antigua',
      'mas-antigua',
    ])
  })

  it('no incluye nunca la vigente', () => {
    expect(replacedPhotos([vigente])).toEqual([])
  })
})

describe('hasCurrentPhoto', () => {
  it('distingue tener foto de haberla sustituido', () => {
    expect(hasCurrentPhoto([vigente])).toBe(true)
    expect(hasCurrentPhoto([vigente, antigua])).toBe(true)
    // Un ticket cuya unica foto se sustituyo sin poner otra no deberia existir
    // (la funcion del servidor inserta la nueva en la misma transaccion), pero
    // si pasara, la interfaz debe decir "sin foto" y no fingir que la tiene.
    expect(hasCurrentPhoto([antigua])).toBe(false)
    expect(hasCurrentPhoto([])).toBe(false)
  })
})
