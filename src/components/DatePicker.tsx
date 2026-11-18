import { useEffect, useState } from 'react'
import { CalendarDays, CircleAlert } from 'lucide-react'
import { ptBR } from 'react-day-picker/locale'
import { localDate } from '../../shared/domain'
import { DUE_SOON_DAYS, daysUntil, formatDay } from '../lib/dates'
import { Calendar } from './ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { Input } from './ui/input'
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

function inputTime(instant: string | null | undefined) {
  if (!instant) return ''
  const time = new Date(instant)
  const parts = [time.getHours(), time.getMinutes()]
  if (time.getSeconds()) parts.push(time.getSeconds())
  return parts.map((value) => String(value).padStart(2, '0')).join(':')
}

/** A ring that fills up as the deadline gets closer: one slice per day, full on the day itself. */
function DueSoonRing({ daysLeft }: { daysLeft: number }) {
  const r = 5.5
  const length = 2 * Math.PI * r
  const filled = (DUE_SOON_DAYS - daysLeft) / DUE_SOON_DAYS
  return (
    <svg
      className={`due-soon-ring ${daysLeft <= 1 ? 'urgent' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
    >
      <circle className="due-soon-track" cx="7" cy="7" r={r} />
      <circle
        className="due-soon-fill"
        cx="7"
        cy="7"
        r={r}
        strokeDasharray={length}
        strokeDashoffset={length * (1 - filled)}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

function dueSoonLabel(daysLeft: number) {
  if (daysLeft === 0) return 'Vence hoje'
  if (daysLeft === 1) return 'Vence amanhã'
  return `Vence em ${daysLeft} dias`
}

export function DatePicker({
  value,
  label,
  onChange,
  overdue = false,
  done,
  kind = 'deadline',
  dateTime = null,
  onChangeDateTime,
}: {
  value: string | null
  label: string
  onChange: (date: string | null) => Promise<boolean> | void
  overdue?: boolean
  /** Whether the task is finished; passing it turns on the approaching-deadline ring. */
  done?: boolean
  kind?: 'deadline' | 'date'
  dateTime?: string | null
  onChangeDateTime?: (date: string | null, dateTime: string | null) => Promise<boolean> | void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [includeTime, setIncludeTime] = useState(!!dateTime)
  const localTime = dateTime ? new Date(dateTime) : null
  const [draftTime, setDraftTime] = useState(inputTime(dateTime))
  const selected = value ? new Date(`${value}T12:00:00`) : undefined
  const daysLeft =
    kind === 'deadline' && done === false && !overdue && value ? daysUntil(value) : null
  const dueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft < DUE_SOON_DAYS
  useEffect(() => {
    if (open) {
      setDraft(value || '')
      setError('')
      setIncludeTime(!!dateTime)
      setDraftTime(inputTime(dateTime))
    }
  }, [value, open, dateTime])
  async function save(date: string | null) {
    setBusy(true)
    setError('')
    if (date && includeTime && !draftTime) {
      setError('Informe o horário.')
      setBusy(false)
      return
    }
    try {
      const instant =
        date && includeTime
          ? new Date(
              `${date}T${draftTime.length === 5 ? draftTime + ':00' : draftTime}`,
            ).toISOString()
          : null
      const saved = onChangeDateTime ? await onChangeDateTime(date, instant) : await onChange(date)
      if (saved === false) setError('Não foi possível salvar a data. Tente novamente.')
      else setOpen(false)
    } catch {
      setError('Não foi possível salvar a data. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`date-picker-trigger ${overdue ? 'overdue' : ''} ${dueSoon ? 'due-soon' : ''}`}
          aria-label={dueSoon ? `${label} · ${dueSoonLabel(daysLeft!)}` : label}
          title={dueSoon ? dueSoonLabel(daysLeft!) : undefined}
        >
          {overdue ? (
            <CircleAlert size={14} aria-hidden="true" />
          ) : dueSoon ? (
            <DueSoonRing daysLeft={daysLeft!} />
          ) : (
            <CalendarDays size={14} aria-hidden="true" />
          )}
          <span>
            {selected
              ? formatDay(selected) + (dateTime ? ` ${timeFormatter.format(localTime!)}` : '')
              : kind === 'date'
                ? 'Selecionar data'
                : 'Sem prazo'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        collisionPadding={12}
        className="date-picker-popover"
        aria-label={label}
      >
        <div className="picker-heading">
          <CalendarDays size={16} />
          <strong>{kind === 'date' ? 'Definir data' : 'Definir prazo'}</strong>
        </div>
        <Calendar
          mode="single"
          locale={ptBR}
          selected={includeTime && draft ? new Date(draft + 'T12:00:00') : selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (date) {
              if (includeTime) setDraft(localDate(date))
              else void save(localDate(date))
            }
          }}
          disabled={busy}
          fixedWeeks
          autoFocus
        />
        {onChangeDateTime && (
          <div className="date-picker-time">
            <label>
              <input
                type="checkbox"
                checked={includeTime}
                onChange={(event) => setIncludeTime(event.target.checked)}
                disabled={busy}
              />
              Incluir horário
            </label>
            {includeTime && (
              <Input
                type="time"
                aria-label="Horário"
                value={draftTime}
                onChange={(event) => setDraftTime(event.target.value)}
                disabled={busy}
              />
            )}
          </div>
        )}
        <form
          className="date-picker-input"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void save(draft || null)
          }}
        >
          <Input
            type="date"
            aria-label={kind === 'date' ? 'Data' : 'Data do prazo'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" size="sm" disabled={busy}>
            Aplicar
          </Button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="picker-footer">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void save(localDate())}
          >
            Hoje
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || !value}
            onClick={() => void save(null)}
          >
            {kind === 'date' ? 'Remover data' : 'Remover prazo'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
