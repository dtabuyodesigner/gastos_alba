import { formatCents } from '../lib/money'

interface AmountProps {
  cents: number
  /** `strong` para el importe protagonista de la pantalla. */
  tone?: 'default' | 'strong' | 'muted'
}

export function Amount({ cents, tone = 'default' }: AmountProps) {
  return <span className={`amount amount--${tone}`}>{formatCents(cents)}</span>
}
