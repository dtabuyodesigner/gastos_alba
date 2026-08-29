import { describe, it, expect } from 'vitest'
import { shouldOfferCamera } from '../source'

function fakeMatchMedia(coarse: boolean) {
  return ((query: string) => ({ matches: query.includes('coarse') ? coarse : !coarse })) as typeof window.matchMedia
}

describe('shouldOfferCamera', () => {
  it('ofrece el boton de camara en un puntero grueso (movil o tablet)', () => {
    expect(shouldOfferCamera(fakeMatchMedia(true))).toBe(true)
  })

  it('no lo ofrece con raton, porque alli los dos botones harian lo mismo', () => {
    expect(shouldOfferCamera(fakeMatchMedia(false))).toBe(false)
  })

  it('tolera un entorno sin matchMedia', () => {
    expect(shouldOfferCamera(undefined)).toBe(false)
  })

  it('tolera que matchMedia lance', () => {
    const throwing = (() => {
      throw new Error('no soportado')
    }) as unknown as typeof window.matchMedia
    expect(shouldOfferCamera(throwing)).toBe(false)
  })
})
