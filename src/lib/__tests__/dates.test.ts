import { describe, it, expect } from 'vitest'
import { todayIso, formatIsoDate, monthKey, formatMonthKey } from '../dates'

describe('todayIso', () => {
  it('devuelve una fecha YYYY-MM-DD', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('formatIsoDate', () => {
  it('formatea fechas ISO en castellano', () => {
    expect(formatIsoDate('2026-08-27')).toContain('2026')
    expect(formatIsoDate('2026-08-27')).toContain('27')
  })

  it('devuelve la entrada tal cual si no es una fecha valida', () => {
    expect(formatIsoDate('no-es-fecha')).toBe('no-es-fecha')
    expect(formatIsoDate('')).toBe('')
  })
})

describe('monthKey / formatMonthKey', () => {
  it('agrupa por mes', () => {
    expect(monthKey('2026-08-27')).toBe('2026-08')
    expect(formatMonthKey('2026-08')).toMatch(/2026/)
  })

  it('tolera claves invalidas', () => {
    expect(formatMonthKey('mal')).toBe('mal')
  })
})
