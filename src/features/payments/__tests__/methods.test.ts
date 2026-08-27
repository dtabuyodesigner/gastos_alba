import { describe, it, expect } from 'vitest'
import {
  PAYMENT_METHODS,
  isPaymentMethod,
  paymentMethodLabel,
  validatePaymentMethod,
} from '../methods'

describe('PAYMENT_METHODS', () => {
  it('coincide con el enum payment_method del SQL', () => {
    // Si esta lista y la del enum se separan, el servidor rechazaria un metodo
    // que la interfaz ofrece. El test de migraciones comprueba el otro lado.
    expect([...PAYMENT_METHODS]).toEqual(['bizum', 'transferencia', 'efectivo', 'otro'])
  })
})

describe('isPaymentMethod', () => {
  it('acepta los cuatro metodos validos', () => {
    for (const method of PAYMENT_METHODS) expect(isPaymentMethod(method)).toBe(true)
  })

  it('rechaza cualquier otra cosa', () => {
    expect(isPaymentMethod('paypal')).toBe(false)
    expect(isPaymentMethod('Bizum')).toBe(false) // el enum va en minusculas
    expect(isPaymentMethod('')).toBe(false)
    expect(isPaymentMethod(null)).toBe(false)
    expect(isPaymentMethod(undefined)).toBe(false)
    expect(isPaymentMethod(42)).toBe(false)
  })
})

describe('paymentMethodLabel', () => {
  it('devuelve la etiqueta de la interfaz', () => {
    expect(paymentMethodLabel('bizum')).toBe('Bizum')
    expect(paymentMethodLabel('transferencia')).toBe('Transferencia')
    expect(paymentMethodLabel('efectivo')).toBe('Efectivo')
    expect(paymentMethodLabel('otro')).toBe('Otro')
  })

  it('no rompe el historico con un valor ausente o desconocido', () => {
    expect(paymentMethodLabel(null)).toBe('Sin metodo')
    expect(paymentMethodLabel(undefined)).toBe('Sin metodo')
    expect(paymentMethodLabel('')).toBe('Sin metodo')
    // Un valor futuro que esta interfaz no conozca se muestra tal cual en vez
    // de dejar el hueco en blanco.
    expect(paymentMethodLabel('cripto')).toBe('cripto')
  })
})

describe('validatePaymentMethod', () => {
  it('acepta los metodos validos', () => {
    for (const method of PAYMENT_METHODS) expect(validatePaymentMethod(method)).toBeNull()
  })

  it('exige elegir metodo: no hay valor por defecto', () => {
    // Decision consciente: sin metodo no se registra el pago, ni se cae en
    // "otro" por descuido, porque entonces el historico no serviria de nada.
    expect(validatePaymentMethod(null)).toBe('Indica como has pagado.')
    expect(validatePaymentMethod('')).toBe('Indica como has pagado.')
  })

  it('rechaza un metodo inventado', () => {
    expect(validatePaymentMethod('paypal')).toBe('Metodo de pago no valido.')
  })
})
