import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { humanizeError } from '../../lib/supabase'
import { parseAmountToCents } from '../../lib/money'
import { validateExpenseDraft } from './validation'
import { DEFAULT_DANI_PERCENT } from '../../lib/split'
import { todayIso } from '../../lib/dates'
import { createExpense } from './api'
import { ExpenseFormFields, type ExpenseFormState } from './ExpenseFormFields'
import { compressImage } from '../photos/api'
import { PhotoSourcePicker } from '../photos/PhotoSourcePicker'

const EMPTY: ExpenseFormState = {
  concept: '',
  expenseDate: todayIso(),
  amount: '',
  daniPercent: DEFAULT_DANI_PERCENT,
  notes: '',
}

export function NewExpensePage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState<ExpenseFormState>(EMPTY)
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    document.title = 'Nuevo ticket · Gastos Alba'
  }, [])

  // La vista previa vive en memoria del navegador; se libera al cambiarla.
  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  function handlePhotoSelected(file: File) {
    setError(null)
    setPhoto(file)
  }

  function handlePhotoRejected(message: string) {
    setError(message)
    setPhoto(null)
  }

  function handleCancel() {
    const hasContent = Boolean(photo || form.concept.trim() || form.amount.trim() || form.notes.trim())
    if (hasContent && !window.confirm('¿Descartar este ticket? Se pierde lo que has introducido.')) return
    navigate('/gastos')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !profile) return
    setError(null)

    const problem = validateExpenseDraft({
      concept: form.concept,
      amount: form.amount,
      expenseDate: form.expenseDate,
      hasPhoto: photo !== null,
    })
    if (problem) {
      setError(problem)
      return
    }

    // validateExpenseDraft ya ha comprobado los dos, pero TypeScript no lo sabe.
    const parsed = parseAmountToCents(form.amount)
    if (!parsed.ok || !photo) return

    setSubmitting(true)
    try {
      const file = await compressImage(photo)
      const expense = await createExpense({
        concept: form.concept,
        expenseDate: form.expenseDate,
        totalCents: parsed.cents,
        daniPercent: form.daniPercent,
        notes: form.notes,
        photo: file,
      })
      navigate(`/gastos/${expense.id}`, { replace: true })
    } catch (err) {
      setError(humanizeError(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page__title">Nuevo ticket</h1>

      <form className="form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="photo-picker">
          {previewUrl ? (
            <img className="photo-picker__preview" src={previewUrl} alt="Vista previa del ticket" />
          ) : (
            <p className="photo-picker__hint">Foto del ticket · obligatoria</p>
          )}

          <PhotoSourcePicker
            disabled={submitting}
            onSelect={handlePhotoSelected}
            onReject={handlePhotoRejected}
          >
            {photo ? (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={submitting}
                onClick={() => setPhoto(null)}
              >
                Quitar
              </button>
            ) : null}
          </PhotoSourcePicker>
        </div>

        <ExpenseFormFields value={form} onChange={setForm} maxDate={todayIso()} />

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="btn btn--primary btn--block" type="submit" disabled={submitting || !photo}>
          {submitting ? 'Guardando…' : photo ? 'Guardar ticket' : 'Anade la foto para guardar'}
        </button>

        <button
          className="btn btn--ghost btn--block"
          type="button"
          disabled={submitting}
          onClick={handleCancel}
        >
          Cancelar
        </button>
      </form>
    </div>
  )
}
