import { formatCents, parseAmountToCents } from '../../lib/money'
import { computeSplit, DEFAULT_DANI_PERCENT } from '../../lib/split'

export interface ExpenseFormState {
  concept: string
  expenseDate: string
  amount: string
  daniPercent: number
  notes: string
}

interface Props {
  value: ExpenseFormState
  onChange: (next: ExpenseFormState) => void
  /** Fecha maxima aceptada (hoy). */
  maxDate: string
}

/**
 * Campos compartidos por "Nuevo ticket" y la edicion.
 * El reparto se muestra siempre en euros ademas de en porcentaje: es lo que
 * de verdad mira quien paga.
 */
export function ExpenseFormFields({ value, onChange, maxDate }: Props) {
  const parsed = parseAmountToCents(value.amount)
  const totalCents = parsed.ok ? parsed.cents : 0
  const split = computeSplit(totalCents, value.daniPercent)
  const isCustom = value.daniPercent !== DEFAULT_DANI_PERCENT

  const set = (patch: Partial<ExpenseFormState>) => onChange({ ...value, ...patch })

  return (
    <>
      <label className="field">
        <span className="field__label">Concepto</span>
        <input
          className="input"
          type="text"
          maxLength={200}
          placeholder="Farmacia, ropa, comedor…"
          value={value.concept}
          onChange={(e) => set({ concept: e.target.value })}
          required
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Importe total</span>
          <input
            className="input input--amount"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={value.amount}
            onChange={(e) => set({ amount: e.target.value })}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Fecha</span>
          <input
            className="input"
            type="date"
            max={maxDate}
            value={value.expenseDate}
            onChange={(e) => set({ expenseDate: e.target.value })}
            required
          />
        </label>
      </div>

      {value.amount && !parsed.ok ? (
        <p className="alert alert--warn" role="alert">
          {parsed.error}
        </p>
      ) : null}

      <fieldset className="field fieldset">
        <legend className="field__label">Reparto</legend>

        <div className="split">
          <button
            type="button"
            className={`chip ${!isCustom ? 'chip--active' : ''}`}
            onClick={() => set({ daniPercent: DEFAULT_DANI_PERCENT })}
          >
            50 / 50
          </button>
          <button
            type="button"
            className={`chip ${isCustom ? 'chip--active' : ''}`}
            onClick={() => set({ daniPercent: isCustom ? value.daniPercent : 60 })}
          >
            Otro reparto
          </button>
        </div>

        {isCustom ? (
          <label className="field field--inline">
            <span className="field__label">Porcentaje de Dani</span>
            <input
              className="input input--percent"
              type="number"
              min={0}
              max={100}
              step={1}
              value={value.daniPercent}
              onChange={(e) => set({ daniPercent: Number(e.target.value) })}
            />
            <span className="field__suffix">%</span>
          </label>
        ) : null}

        <dl className="split-preview">
          <div>
            <dt>Dani</dt>
            <dd>
              {formatCents(split.daniShareCents)} <span className="muted">· {split.daniPercent}%</span>
            </dd>
          </div>
          <div>
            <dt>Otra parte</dt>
            <dd>
              {formatCents(split.otherShareCents)} <span className="muted">· {split.otherPercent}%</span>
            </dd>
          </div>
        </dl>
      </fieldset>

      <label className="field">
        <span className="field__label">
          Notas <span className="muted">(opcional)</span>
        </span>
        <textarea
          className="input"
          rows={2}
          maxLength={1000}
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </label>
    </>
  )
}
