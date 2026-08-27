import type { ExpenseStatus } from '../lib/types'
import { STATUS_LABELS } from '../lib/types'

export function StatusBadge({ status }: { status: ExpenseStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABELS[status]}</span>
}
