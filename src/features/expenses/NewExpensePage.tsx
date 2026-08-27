import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { humanizeError } from '../../lib/supabase'
import { parseAmountToCents } from '../../lib/money'
import { DEFAULT_DANI_PERCENT } from '../../lib/split'
import { todayIso } from '../../lib/dates'
import { createExpense } from './api'
import { ExpenseFormFields, type ExpenseFormState } from './ExpenseFormFields'
import { compressImage, validatePhoto } from '../photos/api'

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
  const fileInput = useRef<HTMLInputElement>(null)

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

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setError(null)
    if (!file) {
      setPhoto(null)
      return
    }
    const problem = validatePhoto(file)
    if (problem) {
      setError(problem)
      setPhoto(null)
      event.target.value = ''
      return
    }
    setPhoto(file)
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

    if (!form.concept.trim()) {
      setError('Escribe un concepto.')
      return
    }
    const parsed = parseAmountToCents(form.amount)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (!form.expenseDate) {
      setError('Indica la fecha del ticket.')
      return
    }

    setSubmitting(true)
    try {
      const file = photo ? await compressImage(photo) : null
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
            <p className="photo-picker__hint">Anade la foto del ticket</p>
          )}

          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
          />
          <div className="photo-picker__actions">
            <button type="button" className="btn btn--secondary" onClick={() => fileInput.current?.click()}>
              {photo ? 'Cambiar foto' : 'Hacer o elegir foto'}
            </button>
            {photo ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setPhoto(null)
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                Quitar
              </button>
            ) : null}
          </div>
        </div>

        <ExpenseFormFields value={form} onChange={setForm} maxDate={todayIso()} />

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="btn btn--primary btn--block" type="submit" disabled={submitting}>
          {submitting ? 'Guardando…' : 'Guardar ticket'}
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
