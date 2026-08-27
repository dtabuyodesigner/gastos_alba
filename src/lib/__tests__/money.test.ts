import { describe, it, expect } from 'vitest'
import {
  formatCents,
  formatCentsPlain,
  parseAmountToCents,
  centsToInputValue,
  MAX_AMOUNT_CENTS,
} from '../money'

describe('formatCents', () => {
  it('formatea centimos como euros en formato es-ES', () => {
    // Intl separa el simbolo con un espacio duro; se normaliza para comparar.
    expect(formatCents(1235).replace(/\s/g, ' ')).toBe('12,35 €')
    expect(formatCents(0).replace(/\s/g, ' ')).toBe('0,00 €')
    expect(formatCents(5).replace(/\s/g, ' ')).toBe('0,05 €')
  })

  it('no explota con valores no finitos', () => {
    expect(formatCents(Number.NaN).replace(/\s/g, ' ')).toBe('0,00 €')
  })
})

describe('formatCentsPlain', () => {
  it('devuelve el importe sin simbolo de moneda', () => {
    expect(formatCentsPlain(1235)).toBe('12,35')
    expect(formatCentsPlain(7)).toBe('0,07')
    expect(formatCentsPlain(100)).toBe('1,00')
    expect(formatCentsPlain(-250)).toBe('-2,50')
  })
})

describe('parseAmountToCents', () => {
  it('acepta coma decimal (formato espanol)', () => {
    expect(parseAmountToCents('12,35')).toEqual({ ok: true, cents: 1235 })
    expect(parseAmountToCents('0,05')).toEqual({ ok: true, cents: 5 })
  })

  it('acepta punto decimal', () => {
    expect(parseAmountToCents('12.35')).toEqual({ ok: true, cents: 1235 })
  })

  it('acepta enteros y completa los decimales', () => {
    expect(parseAmountToCents('12')).toEqual({ ok: true, cents: 1200 })
    expect(parseAmountToCents('12,5')).toEqual({ ok: true, cents: 1250 })
  })

  it('ignora el simbolo de euro y los espacios', () => {
    expect(parseAmountToCents(' 12,35 € ')).toEqual({ ok: true, cents: 1235 })
  })

  it('interpreta separadores de miles en ambos formatos', () => {
    expect(parseAmountToCents('1.234,50')).toEqual({ ok: true, cents: 123450 })
    expect(parseAmountToCents('1,234.50')).toEqual({ ok: true, cents: 123450 })
    expect(parseAmountToCents('1.234')).toEqual({ ok: true, cents: 123400 })
  })

  it('rechaza entradas invalidas en vez de adivinar', () => {
    expect(parseAmountToCents('').ok).toBe(false)
    expect(parseAmountToCents('abc').ok).toBe(false)
    expect(parseAmountToCents('12,345').ok).toBe(false)
    expect(parseAmountToCents('0').ok).toBe(false)
    expect(parseAmountToCents('-5').ok).toBe(false)
    expect(parseAmountToCents('12,,3').ok).toBe(false)
  })

  it('rechaza importes por encima del tope defensivo', () => {
    expect(parseAmountToCents('1000000').ok).toBe(true)
    expect(parseAmountToCents('1000000,01').ok).toBe(false)
    expect(MAX_AMOUNT_CENTS).toBe(100_000_000)
  })

  it('no pierde precision con decimales tipicos de coma flotante', () => {
    // 0.1 + 0.2 en float da 0.30000000000000004; en centimos no hay ambiguedad.
    expect(parseAmountToCents('0,10').ok && parseAmountToCents('0,20').ok).toBe(true)
    const a = parseAmountToCents('0,10')
    const b = parseAmountToCents('0,20')
    if (a.ok && b.ok) expect(a.cents + b.cents).toBe(30)
  })
})

describe('centsToInputValue', () => {
  it('produce un valor valido para inputs numericos', () => {
    expect(centsToInputValue(1235)).toBe('12.35')
    expect(centsToInputValue(100)).toBe('1.00')
  })
})
