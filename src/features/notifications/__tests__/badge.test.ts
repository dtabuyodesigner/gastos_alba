import { describe, it, expect, vi } from 'vitest'
import { applyAppBadge, badgeSupport, requestBadgePermission, supportsAppBadge } from '../badge'

function navWithBadge(overrides: Record<string, unknown> = {}) {
  return {
    setAppBadge: vi.fn(async () => {}),
    clearAppBadge: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Navigator
}

function notificationWith(permission: NotificationPermission) {
  const fake = (() => {}) as unknown as typeof Notification
  Object.defineProperty(fake, 'permission', { value: permission })
  return fake
}

describe('supportsAppBadge', () => {
  it('detecta la API', () => {
    expect(supportsAppBadge(navWithBadge())).toBe(true)
  })

  it('devuelve false donde no existe (Safari en pestana, Chrome Android)', () => {
    expect(supportsAppBadge({} as Navigator)).toBe(false)
    expect(supportsAppBadge(undefined)).toBe(false)
  })
})

describe('badgeSupport', () => {
  it('sin API no hay nada que ofrecer', () => {
    expect(badgeSupport({ nav: {} as Navigator, notification: notificationWith('granted') })).toBe('unsupported')
  })

  it('con API y permiso concedido, ya esta activo', () => {
    expect(badgeSupport({ nav: navWithBadge(), notification: notificationWith('granted') })).toBe('active')
  })

  it('con API y permiso sin decidir, hay que pedirlo', () => {
    expect(badgeSupport({ nav: navWithBadge(), notification: notificationWith('default') })).toBe('needs-permission')
  })

  it('con permiso denegado lo dice, para poder explicar como reactivarlo', () => {
    expect(badgeSupport({ nav: navWithBadge(), notification: notificationWith('denied') })).toBe('denied')
  })
})

describe('applyAppBadge', () => {
  it('pinta el numero cuando hay avisos', async () => {
    const nav = navWithBadge()
    await applyAppBadge(3, nav)
    expect(nav.setAppBadge).toHaveBeenCalledWith(3)
  })

  it('limpia el icono cuando no queda nada por leer', async () => {
    const nav = navWithBadge()
    await applyAppBadge(0, nav)
    expect(nav.clearAppBadge).toHaveBeenCalled()
    expect(nav.setAppBadge).not.toHaveBeenCalled()
  })

  it('no lanza si el navegador rechaza la llamada', async () => {
    const nav = navWithBadge({
      setAppBadge: vi.fn(async () => {
        throw new Error('sin permiso')
      }),
    })
    await expect(applyAppBadge(2, nav)).resolves.toBeUndefined()
  })

  it('no hace nada sin API', async () => {
    await expect(applyAppBadge(2, {} as Navigator)).resolves.toBeUndefined()
  })
})

describe('requestBadgePermission', () => {
  it('devuelve denied si no hay Notification', async () => {
    await expect(requestBadgePermission(undefined)).resolves.toBe('denied')
  })

  it('devuelve lo que conteste el navegador', async () => {
    const fake = (() => {}) as unknown as typeof Notification
    Object.defineProperty(fake, 'requestPermission', { value: async () => 'granted' as NotificationPermission })
    await expect(requestBadgePermission(fake)).resolves.toBe('granted')
  })
})
