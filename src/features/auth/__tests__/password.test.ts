import { describe, expect, it } from 'vitest'
import { buildPasswordRecoveryRedirect, validateNewPassword } from '../password'

describe('validateNewPassword', () => {
  it('exige una contrasena minima', () => {
    expect(validateNewPassword('', '')).toBe('Escribe la nueva contrasena.')
    expect(validateNewPassword('12345', '12345')).toBe('La contrasena debe tener al menos 8 caracteres.')
  })

  it('exige repetir la misma contrasena', () => {
    expect(validateNewPassword('contrasena-larga', 'otra-contrasena')).toBe('Las contrasenas no coinciden.')
  })

  it('acepta dos contrasenas iguales y suficientemente largas', () => {
    expect(validateNewPassword('contrasena-larga', 'contrasena-larga')).toBeNull()
  })
})

describe('buildPasswordRecoveryRedirect', () => {
  it('apunta a la pantalla publica de cambio de contrasena', () => {
    expect(buildPasswordRecoveryRedirect('https://gastos-alba.vercel.app')).toBe(
      'https://gastos-alba.vercel.app/cambiar-contrasena',
    )
  })

  it('normaliza una barra final en el origen', () => {
    expect(buildPasswordRecoveryRedirect('https://gastos-alba.vercel.app/')).toBe(
      'https://gastos-alba.vercel.app/cambiar-contrasena',
    )
  })
})
