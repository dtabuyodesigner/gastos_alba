import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { useAsyncData } from '../../lib/useAsyncData'
import { humanizeError } from '../../lib/supabase'
import { formatCents, parseAmountToCents, centsToInputValue } from '../../lib/money'
import { formatIsoDate, formatTimestamp, todayIso } from '../../lib/dates'
import { permissions } from '../../lib/types'
import { getExpense, replaceExpensePhoto, updateExpense, voidExpense } from './api'
import { currentPhotos } from './photos'
import { PhotoReplacer } from './PhotoReplacer'
import { registerPayment } from '../payments/api'
import { PaymentForm } from '../payments/PaymentForm'
import type { PaymentMethod } from '../payments/methods'
import { ExpenseFormFields, type ExpenseFormState } from './ExpenseFormFields'
import { TicketPhoto } from '../photos/TicketPhoto'
import { StatusBadge } from '../../components/StatusBadge'
import { Spinner } from '../../components/Spinner'

export function ExpenseDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const loader = useCallback(() => getExpense(id), [id])
  const { data: expense, loading, error, reload } = useAsyncData(loader)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ExpenseFormState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [payingOpen, setPayingOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)

  useEffect(() => {
    document.title = expense ? `${expense.concept} · Gastos Alba` : 'Ticket · Gastos Alba'
  }, [expense])

  if (loading) {
    return (
      <div className="page">
        <Spinner label="Cargando ticket…" />
      </div>
    )
  }

  if (error || !expense || !profile) {
    return (
      <div className="page">
        <p className="alert alert--error">{error ?? 'Este ticket no existe o no tienes acceso.'}</p>
        <Link className="btn btn--secondary" to="/gastos">
          Volver a los tickets
        </Link>
      </div>
    )
  }

  const canEdit = permissions.canEditExpense(profile.role, profile.id, expense)
  const canVoid = permissions.canVoidExpense(profile.role, profile.id, expense)
  const canPay = permissions.canRegisterPayment(profile.role) && expense.status === 'pendiente'
  const canReplacePhoto = permissions.canReplacePhoto(profile.role, profile.id, expense)
  const photos = currentPhotos(expense.expense_photos)

  function startEditing() {
    if (!expense) return
    setActionError(null)
    setForm({
      concept: expense.concept,
      expenseDate: expense.expense_date,
      amount: centsToInputValue(expense.total_amount_cents),
      daniPercent: Number(expense.dani_share_percent),
      notes: expense.notes ?? '',
    })
    setEditing(true)
  }

  async function handleSave() {
    if (!form || busy) return
    const parsed = parseAmountToCents(form.amount)
    if (!parsed.ok) {
      setActionError(parsed.error)
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await updateExpense(id, {
        concept: form.concept,
        expenseDate: form.expenseDate,
        totalCents: parsed.cents,
        daniPercent: form.daniPercent,
        notes: form.notes,
      })
      setEditing(false)
      await reload()
    } catch (err) {
      setActionError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleMarkPaid(method: PaymentMethod, notes: string) {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await registerPayment({ expenseIds: [id], method, notes: notes || null })
      setPayingOpen(false)
      await reload()
    } catch (err) {
      setActionError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleReplacePhoto(file: File) {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await replaceExpensePhoto(id, file)
      setPhotoOpen(false)
      await reload()
    } catch (err) {
      setActionError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleVoid() {
    if (busy) return
    if (!window.confirm('¿Anular este ticket? No se borra: queda en el historico como anulado.')) return
    setBusy(true)
    setActionError(null)
    try {
      await voidExpense(id)
      await reload()
    } catch (err) {
      setActionError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate(-1)}>
        ← Volver
      </button>

      {editing && form ? (
        <div className="form">
          <h1 className="page__title">Editar ticket</h1>
          <ExpenseFormFields value={form} onChange={setForm} maxDate={todayIso()} />
          {actionError ? <p className="alert alert--error">{actionError}</p> : null}
          <div className="actions">
            <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void handleSave()}>
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="detail__head">
            <h1 className="page__title">{expense.concept}</h1>
            <StatusBadge status={expense.status} />
          </header>

          <p className="detail__total">{formatCents(expense.total_amount_cents)}</p>
          <p className="muted">{formatIsoDate(expense.expense_date)}</p>

          <dl className="detail__grid">
            <div>
              <dt>Parte de Dani</dt>
              <dd className="strong">
                {formatCents(expense.dani_share_cents)}{' '}
                <span className="muted">· {expense.dani_share_percent}%</span>
              </dd>
            </div>
            <div>
              <dt>Otra parte</dt>
              <dd>
                {formatCents(expense.other_share_cents)}{' '}
                <span className="muted">· {expense.other_share_percent}%</span>
              </dd>
            </div>
          </dl>

          {expense.notes ? <p className="detail__notes">{expense.notes}</p> : null}

          {photos.length > 0 ? (
            photos.map((photo) => <TicketPhoto key={photo.id} storagePath={photo.storage_path} />)
          ) : (
            <p className="muted">Este ticket no tiene foto.</p>
          )}

          {canReplacePhoto && !photoOpen ? (
            <button type="button" className="btn btn--secondary" onClick={() => setPhotoOpen(true)}>
              Cambiar foto
            </button>
          ) : null}

          {canReplacePhoto && photoOpen ? (
            <PhotoReplacer
              busy={busy}
              onCancel={() => setPhotoOpen(false)}
              onConfirm={(file) => void handleReplacePhoto(file)}
            />
          ) : null}

          {actionError ? <p className="alert alert--error">{actionError}</p> : null}

          <div className="actions actions--stack">
            {canPay && !payingOpen ? (
              <button
                className="btn btn--primary btn--block"
                type="button"
                disabled={busy}
                onClick={() => setPayingOpen(true)}
              >
                Marcar mi parte como pagada ({formatCents(expense.dani_share_cents)})
              </button>
            ) : null}

            {canPay && payingOpen ? (
              <PaymentForm
                amountCents={expense.dani_share_cents}
                ticketCount={1}
                busy={busy}
                onCancel={() => setPayingOpen(false)}
                onConfirm={(method, notes) => void handleMarkPaid(method, notes)}
              />
            ) : null}
            {canEdit ? (
              <button className="btn btn--secondary" type="button" onClick={startEditing}>
                Editar
              </button>
            ) : null}
            {canVoid ? (
              <button className="btn btn--danger-ghost" type="button" disabled={busy} onClick={() => void handleVoid()}>
                Anular ticket
              </button>
            ) : null}
          </div>

          <p className="detail__foot muted">
            Creado {formatTimestamp(expense.created_at)}
            {expense.voided_at ? ` · Anulado ${formatTimestamp(expense.voided_at)}` : ''}
          </p>
        </>
      )}
    </div>
  )
}
