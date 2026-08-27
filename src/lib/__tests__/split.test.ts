import { describe, it, expect } from 'vitest'
import {
  computeSplit,
  defaultSplit,
  clampPercent,
  isCustomSplit,
  isConsistentSplit,
  DEFAULT_DANI_PERCENT,
} from '../split'

describe('defaultSplit (50/50)', () => {
  it('parte por la mitad los importes pares', () => {
    const split = defaultSplit(2000)
    expect(split.daniShareCents).toBe(1000)
    expect(split.otherShareCents).toBe(1000)
  })

  it('reparte el centimo suelto de forma determinista con importes impares', () => {
    // 12,35 € -> 617,5 centimos por cabeza. Half-up: Dani 618, otra parte 617.
    const split = defaultSplit(1235)
    expect(split.daniShareCents).toBe(618)
    expect(split.otherShareCents).toBe(617)
    expect(split.daniShareCents + split.otherShareCents).toBe(1235)
  })

  it('usa el 50% como porcentaje por defecto', () => {
    expect(DEFAULT_DANI_PERCENT).toBe(50)
    expect(defaultSplit(1000).daniPercent).toBe(50)
    expect(defaultSplit(1000).otherPercent).toBe(50)
  })
})

describe('computeSplit', () => {
  it('reparte con valores exactos en los limites de un centimo', () => {
    // Estos casos fijan el redondeo half-up. Un bucle que solo comprobara la
    // suma seguiria en verde con cualquier formula de redondeo.
    expect(computeSplit(1, 50)).toMatchObject({ daniShareCents: 1, otherShareCents: 0 })
    expect(computeSplit(3, 50)).toMatchObject({ daniShareCents: 2, otherShareCents: 1 })
    expect(computeSplit(1, 1)).toMatchObject({ daniShareCents: 0, otherShareCents: 1 })
    expect(computeSplit(1, 99)).toMatchObject({ daniShareCents: 1, otherShareCents: 0 })
    expect(computeSplit(5, 50)).toMatchObject({ daniShareCents: 3, otherShareCents: 2 })
  })

  it('mantiene el redondeo exacto con importes grandes', () => {
    // 33,33% de 9.999,99 EUR = 333.299,6667 milesimas de centimo -> 333300.
    expect(computeSplit(999999, 33.33)).toMatchObject({
      daniShareCents: 333300,
      otherShareCents: 666699,
    })
    expect(computeSplit(123457, 50)).toMatchObject({ daniShareCents: 61729, otherShareCents: 61728 })
  })

  it('nunca pierde ni inventa un centimo', () => {
    for (let total = 0; total <= 500; total++) {
      for (const percent of [0, 10, 25, 33.33, 50, 66.66, 70, 99, 100]) {
        const split = computeSplit(total, percent)
        expect(split.daniShareCents + split.otherShareCents).toBe(total)
        expect(split.daniShareCents).toBeGreaterThanOrEqual(0)
        expect(split.otherShareCents).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('soporta repartos asimetricos', () => {
    expect(computeSplit(10000, 70)).toMatchObject({
      daniShareCents: 7000,
      otherShareCents: 3000,
      daniPercent: 70,
      otherPercent: 30,
    })
    expect(computeSplit(10000, 100)).toMatchObject({ daniShareCents: 10000, otherShareCents: 0 })
    expect(computeSplit(10000, 0)).toMatchObject({ daniShareCents: 0, otherShareCents: 10000 })
  })

  it('redondea half-up la parte de Dani', () => {
    // 33,33% de 10,00 € = 333,3 centimos -> 333.
    expect(computeSplit(1000, 33.33).daniShareCents).toBe(333)
    // 30% de 1,05 € = 31,5 centimos -> 32.
    expect(computeSplit(105, 30).daniShareCents).toBe(32)
  })

  it('acota porcentajes fuera de rango en vez de producir importes absurdos', () => {
    expect(computeSplit(1000, 150).daniShareCents).toBe(1000)
    expect(computeSplit(1000, -20).daniShareCents).toBe(0)
    expect(computeSplit(1000, Number.NaN).daniShareCents).toBe(0)
  })

  it('trunca totales no enteros y descarta negativos', () => {
    expect(computeSplit(100.9, 50).daniShareCents + computeSplit(100.9, 50).otherShareCents).toBe(100)
    expect(computeSplit(-500, 50)).toMatchObject({ daniShareCents: 0, otherShareCents: 0 })
  })
})

describe('clampPercent', () => {
  it('acota a [0, 100] y normaliza a dos decimales', () => {
    expect(clampPercent(50)).toBe(50)
    expect(clampPercent(120)).toBe(100)
    expect(clampPercent(-3)).toBe(0)
    expect(clampPercent(33.333)).toBe(33.33)
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('isCustomSplit', () => {
  it('distingue el reparto por defecto de uno excepcional', () => {
    expect(isCustomSplit(50)).toBe(false)
    expect(isCustomSplit(70)).toBe(true)
    expect(isCustomSplit(50.5)).toBe(true)
  })
})

describe('isConsistentSplit', () => {
  it('valida el mismo invariante que el CHECK de la base de datos', () => {
    expect(isConsistentSplit(1235, defaultSplit(1235))).toBe(true)
    expect(
      isConsistentSplit(1000, { daniShareCents: 600, otherShareCents: 300, daniPercent: 60, otherPercent: 40 }),
    ).toBe(false)
    expect(
      isConsistentSplit(1000, { daniShareCents: -100, otherShareCents: 1100, daniPercent: 0, otherPercent: 100 }),
    ).toBe(false)
  })
})
