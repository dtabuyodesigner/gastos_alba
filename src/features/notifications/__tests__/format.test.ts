import { describe, it, expect } from 'vitest'
import { countUnread, formatBadgeCount, formatRelativeTime, notificationLink } from '../format'
import type { AppNotification } from '../../../lib/types'

function notification(patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    recipient_profile_id: 'dani-id',
    actor_profile_id: 'alba-id',
    type: 'ticket_created',
    title: 'Alba ha subido un ticket de 12,35 EUR',
    body: 'Farmacia',
    expense_id: 'expense-1',
    payment_id: null,
    read_at: null,
    created_at: '2026-08-27T10:00:00Z',
    ...patch,
  }
}

describe('countUnread', () => {
  it('cuenta solo las que no tienen fecha de lectura', () => {
    expect(
      countUnread([
        notification({ id: 'a', read_at: null }),
        notification({ id: 'b', read_at: '2026-08-27T11:00:00Z' }),
        notification({ id: 'c', read_at: null }),
      ]),
    ).toBe(2)
  })

  it('con el buzon vacio devuelve cero', () => {
    expect(countUnread([])).toBe(0)
  })
})

describe('formatBadgeCount', () => {
  it('no muestra nada cuando no hay avisos pendientes', () => {
    expect(formatBadgeCount(0)).toBe('')
    expect(formatBadgeCount(-3)).toBe('')
  })

  it('muestra el numero hasta nueve y luego lo recorta', () => {
    expect(formatBadgeCount(1)).toBe('1')
    expect(formatBadgeCount(9)).toBe('9')
    expect(formatBadgeCount(10)).toBe('9+')
    expect(formatBadgeCount(150)).toBe('9+')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-27T12:00:00Z')

  it('describe la antiguedad en lenguaje corriente', () => {
    expect(formatRelativeTime('2026-08-27T11:59:30Z', now)).toBe('ahora')
    expect(formatRelativeTime('2026-08-27T11:55:00Z', now)).toBe('hace 5 min')
    expect(formatRelativeTime('2026-08-27T10:00:00Z', now)).toBe('hace 2 h')
    expect(formatRelativeTime('2026-08-26T10:00:00Z', now)).toBe('ayer')
    expect(formatRelativeTime('2026-08-24T10:00:00Z', now)).toBe('hace 3 dias')
  })

  it('devuelve cadena vacia a partir de una semana, para que se use la fecha', () => {
    expect(formatRelativeTime('2026-08-01T10:00:00Z', now)).toBe('')
  })

  it('trata como "ahora" un reloj adelantado en el movil', () => {
    expect(formatRelativeTime('2026-08-27T12:05:00Z', now)).toBe('ahora')
  })

  it('no explota con una fecha invalida', () => {
    expect(formatRelativeTime('no-es-fecha', now)).toBe('')
  })
})

describe('notificationLink', () => {
  it('lleva al ticket cuando el aviso apunta a un gasto', () => {
    expect(notificationLink(notification({ expense_id: 'expense-9' }))).toBe('/gastos/expense-9')
  })

  it('lleva al historico en un pago agrupado, que no tiene un unico ticket', () => {
    expect(
      notificationLink(
        notification({ type: 'payment_registered', expense_id: null, payment_id: 'pago-1' }),
      ),
    ).toBe('/historico')
  })

  it('prefiere el ticket concreto cuando hay ambos', () => {
    expect(notificationLink(notification({ expense_id: 'expense-2', payment_id: 'pago-2' }))).toBe(
      '/gastos/expense-2',
    )
  })

  it('devuelve null si no hay contexto que abrir', () => {
    expect(notificationLink(notification({ expense_id: null, payment_id: null }))).toBeNull()
  })
})
