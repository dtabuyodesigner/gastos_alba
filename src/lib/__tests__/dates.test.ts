import { describe, it, expect, afterEach, vi } from 'vitest'
import { todayIso, formatIsoDate, formatTimestamp, monthKey, formatMonthKey } from '../dates'

afterEach(() => {
  vi.useRealTimers()
})

describe('todayIso', () => {
  it('devuelve la fecha local con ceros a la izquierda', () => {
    // Con reloj fijo se comprueba el padStart real, no solo el formato.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0))
    expect(todayIso()).toBe('2026-01-05')

    vi.setSystemTime(new Date(2026, 11, 31, 12, 0, 0))
    expect(todayIso()).toBe('2026-12-31')
  })
})

describe('formatIsoDate', () => {
  it('formatea el dia, el mes y el ano', () => {
    // El mes importa: un off-by-one en Number(month) - 1 desplazaria el gasto
    // un mes entero y el historico dejaria de cuadrar.
    const formatted = formatIsoDate('2026-08-27')
    expect(formatted).toContain('27')
    expect(formatted).toContain('ago')
    expect(formatted).toContain('2026')
  })

  it('no desplaza la fecha por el huso horario', () => {
    expect(formatIsoDate('2026-01-01')).toContain('ene')
    expect(formatIsoDate('2026-01-01')).toContain('1')
    expect(formatIsoDate('2026-12-31')).toContain('dic')
  })

  it('devuelve la entrada tal cual si no es una fecha valida', () => {
    expect(formatIsoDate('no-es-fecha')).toBe('no-es-fecha')
    expect(formatIsoDate('')).toBe('')
    expect(formatIsoDate('2026-8-7')).toBe('2026-8-7')
  })
})

describe('formatTimestamp', () => {
  it('formatea la marca de tiempo de un pago con fecha y hora', () => {
    const formatted = formatTimestamp('2026-08-27T10:30:00Z')
    expect(formatted).toContain('2026')
    // Sin comparar la hora exacta: depende del huso de la maquina que ejecute.
    expect(formatted).toMatch(/\d{1,2}:\d{2}/)
  })

  it('tolera valores vacios o invalidos sin mostrar "Invalid Date"', () => {
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp('')).toBe('')
    expect(formatTimestamp('no-es-fecha')).toBe('no-es-fecha')
  })
})

describe('monthKey / formatMonthKey', () => {
  it('agrupa por mes con el mes correcto', () => {
    expect(monthKey('2026-08-27')).toBe('2026-08')
    expect(formatMonthKey('2026-08').toLowerCase()).toContain('agosto')
    expect(formatMonthKey('2026-08')).toContain('2026')
    expect(formatMonthKey('2026-01').toLowerCase()).toContain('enero')
    expect(formatMonthKey('2026-12').toLowerCase()).toContain('diciembre')
  })

  it('empieza la etiqueta en mayuscula', () => {
    expect(formatMonthKey('2026-08').charAt(0)).toBe('A')
  })

  it('tolera claves invalidas', () => {
    expect(formatMonthKey('mal')).toBe('mal')
    expect(monthKey('')).toBe('')
  })
})
