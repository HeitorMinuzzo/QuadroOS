import { useEffect, useState } from 'react'
import {
  CalendarRange,
  Play,
  Pause,
  Timer,
  History,
  ExternalLink,
  Link2,
  Star,
  ThumbsUp,
  Info,
  Download,
} from 'lucide-react'
import type { Task, CustomColumn, Workspace } from '../../shared/domain'
import {
  jsonObject,
  durationText,
  secondsNow,
  timeValue,
  validateRichValue,
  safeUrl,
} from '../../shared/rich-values'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DatePicker } from './DatePicker'

interface Props {
  task: Task
  column: CustomColumn
  workspace?: Pick<Workspace, 'tasks' | 'boards'>
  onOpenTask?: (id: string) => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
}
const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
function shortDate(value: unknown) {
  return typeof value === 'string' && value
    ? shortDateFormatter.format(new Date(value.length === 10 ? value + 'T12:00:00' : value))
    : 'Sem data'
}
function TimelineCell({ task, column, onPatch }: Props) {
  const raw = task.customValues[column.id] || '',
    value = jsonObject(raw)
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const label = column.name + ': ' + task.title
  async function save(clear = false) {
    setBusy(true)
    setError('')
    try {
      const next = clear ? '' : validateRichValue(column, JSON.stringify(draft))
      if (await onPatch(task.id, { customValues: { [column.id]: next } })) setOpen(false)
      else setError('Não foi possível salvar o cronograma.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Confira as datas.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraft(value)
          setError('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="rich-timeline-trigger" aria-label={label}>
          <CalendarRange size={14} />
          <span>
            {value.from || value.to
              ? `${shortDate(value.from)} → ${shortDate(value.to)}`
              : 'Definir período'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="rich-column-popover"
        align="start"
        aria-label={'Editar ' + column.name}
      >
        <strong>{column.name}</strong>
        <div className="rich-period-fields">
          <label>
            Início
            <DatePicker
              kind="date"
              label={'Início de ' + column.name}
              value={typeof draft.from === 'string' ? draft.from : null}
              onChange={async (value) => {
                setDraft({ ...draft, from: value })
                return true
              }}
            />
          </label>
          <label>
            Fim
            <DatePicker
              kind="date"
              label={'Fim de ' + column.name}
              value={typeof draft.to === 'string' ? draft.to : null}
              onChange={async (value) => {
                setDraft({ ...draft, to: value })
                return true
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(true)}>
            Limpar
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            Salvar período
          </Button>
        </footer>
      </PopoverContent>
    </Popover>
  )
}
function TimeTrackingCell({ task, column, onPatch }: Props) {
  const value = timeValue(task.customValues[column.id] || ''),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [manual, setManual] = useState('')
  useEffect(() => {
    if (!value.startedAt) return
    const interval = setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => clearInterval(interval)
  }, [value.startedAt])
  void tick
  async function change(next: ReturnType<typeof timeValue>) {
    setBusy(true)
    setError('')
    try {
      if (!(await onPatch(task.id, { customValues: { [column.id]: JSON.stringify(next) } })))
        setError('Não foi possível salvar as horas.')
    } finally {
      setBusy(false)
    }
  }
  function toggle() {
    const now = new Date().toISOString()
    void change(
      value.startedAt
        ? {
            duration: secondsNow(value),
            startedAt: null,
            sessions: [
              ...value.sessions,
              { startedAt: value.startedAt, endedAt: now, authorId: 'person-you' },
            ],
          }
        : { ...value, startedAt: now },
    )
  }
  function download() {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      ),
      anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'quadroos-historico-de-horas.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="rich-timer-cell" role="group" aria-label={column.name + ': ' + task.title}>
      <button
        type="button"
        className={value.startedAt ? 'is-running' : ''}
        disabled={busy}
        aria-label={
          (value.startedAt ? 'Pausar' : 'Iniciar') + ' ' + column.name + ': ' + task.title
        }
        onClick={toggle}
      >
        {value.startedAt ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="rich-timer-duration"
            aria-label={'Histórico de ' + column.name + ': ' + task.title}
          >
            {durationText(secondsNow(value))}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="rich-column-popover rich-timer-popover"
          align="start"
          aria-label={'Histórico de ' + column.name}
        >
          <strong>
            <Timer size={16} />
            {column.name}
          </strong>
          <div className="rich-timer-total">
            {durationText(secondsNow(value))}
            {value.startedAt && <span>Em execução</span>}
          </div>
          <div className="rich-time-sessions">
            {value.sessions.length ? (
              value.sessions
                .slice(-50)
                .reverse()
                .map((session, index) => (
                  <div key={String(session.id || index)}>
                    <History size={13} />
                    <span>
                      {shortDate(session.startedAt || session.started_at)}
                      <small>
                        {session.endedAt || session.ended_at
                          ? 'Sessão concluída'
                          : 'Sessão importada'}
                      </small>
                    </span>
                    <span>
                      {session.startedAt || session.started_at
                        ? durationText(
                            Math.max(
                              0,
                              (Date.parse(
                                String(
                                  session.endedAt || session.ended_at || new Date().toISOString(),
                                ),
                              ) -
                                Date.parse(String(session.startedAt || session.started_at))) /
                                1000,
                            ),
                          )
                        : ''}
                    </span>
                  </div>
                ))
            ) : (
              <p>Nenhuma sessão registrada.</p>
            )}
          </div>
          <label>
            Adicionar horas manualmente
            <Input
              type="number"
              min="0"
              step="0.25"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Ex.: 1,5"
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <footer>
            <Button variant="ghost" size="sm" onClick={download}>
              <Download size={14} />
              Histórico
            </Button>
            <Button
              size="sm"
              disabled={busy || !manual || !Number.isFinite(Number(manual)) || Number(manual) <= 0}
              onClick={() => {
                const seconds = Math.round(Number(manual) * 3600)
                void change({
                  ...value,
                  duration: value.duration + seconds,
                  sessions: [
                    ...value.sessions,
                    {
                      id: crypto.randomUUID(),
                      manual: true,
                      duration: seconds,
                      createdAt: new Date().toISOString(),
                      authorId: 'person-you',
                    },
                  ],
                }).then(() => setManual(''))
              }}
            >
              Adicionar horas
            </Button>
          </footer>
        </PopoverContent>
      </Popover>
    </div>
  )
}
const fields: Record<string, { key: string; label: string; type?: string }[]> = {
  link: [
    { key: 'url', label: 'Endereço', type: 'url' },
    { key: 'text', label: 'Texto do link' },
  ],
  email: [
    { key: 'email', label: 'E-mail', type: 'email' },
    { key: 'text', label: 'Nome' },
  ],
  phone: [
    { key: 'phone', label: 'Telefone', type: 'tel' },
    { key: 'countryShortName', label: 'Código do país' },
  ],
  country: [
    { key: 'countryName', label: 'País' },
    { key: 'countryCode', label: 'Código do país' },
  ],
  location: [
    { key: 'address', label: 'Endereço' },
    { key: 'lat', label: 'Latitude', type: 'number' },
    { key: 'lng', label: 'Longitude', type: 'number' },
  ],
  rating: [{ key: 'rating', label: 'Avaliação', type: 'number' }],
  hour: [
    { key: 'hour', label: 'Hora', type: 'number' },
    { key: 'minute', label: 'Minuto', type: 'number' },
  ],
  week: [
    { key: 'startDate', label: 'Início', type: 'date' },
    { key: 'endDate', label: 'Fim', type: 'date' },
  ],
  world_clock: [{ key: 'timezone', label: 'Fuso horário' }],
  color_picker: [{ key: 'color', label: 'Cor', type: 'color' }],
}
function ExternalColumnCell({ task, column, workspace, onPatch, onOpenTask }: Props) {
  const stored = jsonObject(task.customValues[column.id] || ''),
    value = jsonObject(stored.value),
    details = jsonObject(stored.details),
    type = column.source?.type || 'unsupported'
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [search, setSearch] = useState('')
  const label = column.name + ': ' + task.title,
    editable = !!fields[type] && !column.source?.readOnly
  const sourceText = String(stored.text || '')
  const href =
    type === 'link'
      ? safeUrl(value.url)
      : type === 'email' && typeof value.email === 'string'
        ? `mailto:${encodeURIComponent(value.email)}`
        : type === 'phone' && typeof value.phone === 'string'
          ? `tel:${value.phone.replace(/[^\d+]/g, '')}`
          : type === 'location' &&
              Number.isFinite(Number(value.lat)) &&
              Number.isFinite(Number(value.lng))
            ? `https://www.google.com/maps?q=${Number(value.lat)},${Number(value.lng)}`
            : null
  const referenceIds = Array.isArray(value.localIds)
    ? value.localIds.map(String)
    : Array.isArray(details.linked_item_ids)
      ? details.linked_item_ids.map(String)
      : Array.isArray(value.linkedPulseIds)
        ? value.linkedPulseIds.map((entry) => String(jsonObject(entry).linkedPulseId))
        : []
  const related = referenceIds.map(
    (id) =>
      workspace?.tasks.find((item) => item.id === id) ||
      workspace?.tasks.find((item) => item.boardId === task.boardId && item.externalId === id) ||
      workspace?.tasks.find((item) => item.externalId === id),
  )
  let text =
    sourceText ||
    String(
      value.text ||
        value.email ||
        value.phone ||
        value.address ||
        value.countryName ||
        value.timezone ||
        value.color ||
        '',
    )
  if (type === 'item_id') text = sourceText || task.externalId || task.id
  if (type === 'creation_log') text = shortDate(details.created_at || task.createdAt)
  if (type === 'rating')
    text = '★'.repeat(Math.max(0, Math.min(10, Number(value.rating) || 0))) || 'Avaliar'
  if (type === 'hour')
    text = `${String(value.hour || 0).padStart(2, '0')}:${String(value.minute || 0).padStart(2, '0')}`
  if (type === 'week') text = `${shortDate(value.startDate)} → ${shortDate(value.endDate)}`
  if (type === 'world_clock' && value.timezone) {
    try {
      text = new Intl.DateTimeFormat('pt-BR', {
        timeZone: String(value.timezone),
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date())
    } catch {
      /* Keep the source timezone visible. */
    }
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      const next = JSON.stringify({ ...stored, value: draft, text: '' })
      validateRichValue(column, next)
      if (await onPatch(task.id, { customValues: { [column.id]: next } })) setOpen(false)
      else setError('Não foi possível salvar.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Confira o valor.')
    } finally {
      setBusy(false)
    }
  }
  if (type === 'vote' && !column.source?.readOnly) {
    const voters = Array.isArray(details.voter_ids)
        ? details.voter_ids.map(String)
        : Array.isArray(value.voters)
          ? value.voters.map(String)
          : [],
      voted = voters.includes('person-you')
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        aria-pressed={voted}
        onClick={() => {
          const next = voted
            ? voters.filter((id) => id !== 'person-you')
            : [...voters, 'person-you']
          void onPatch(task.id, {
            customValues: {
              [column.id]: JSON.stringify({
                ...stored,
                value: { ...value, voters: next },
                details: { ...details, voter_ids: next, vote_count: next.length },
                text: String(next.length),
              }),
            },
          })
        }}
      >
        <ThumbsUp size={14} />
        {voters.length}
      </Button>
    )
  }
  if (type === 'board_relation' || type === 'dependency')
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="rich-external-trigger" aria-label={label}>
            <Link2 size={13} />
            <span>
              {related
                .filter(Boolean)
                .map((item) => item!.title)
                .join(', ') ||
                sourceText ||
                (referenceIds.length ? `${referenceIds.length} vínculos` : 'Vincular tarefas')}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="rich-column-popover" aria-label={'Vínculos de ' + column.name}>
          <strong>{column.name}</strong>
          {related.map((target, index) =>
            target ? (
              <Button
                key={target.id}
                variant="ghost"
                size="sm"
                onClick={() => onOpenTask?.(target.id)}
              >
                {target.title}
                <ExternalLink size={12} />
              </Button>
            ) : (
              <p key={referenceIds[index]}>
                Item #{referenceIds[index]} — importe o quadro relacionado para abrir o vínculo
                local.
              </p>
            ),
          )}
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar tarefas locais"
            aria-label="Pesquisar vínculo"
          />
          <div className="rich-related-options">
            {workspace?.tasks
              .filter(
                (item) =>
                  item.id !== task.id &&
                  item.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')),
              )
              .slice(0, 50)
              .map((item) => {
                const selected =
                  referenceIds.includes(item.id) ||
                  (!!item.externalId && referenceIds.includes(item.externalId))
                return (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        const ids = selected
                          ? referenceIds.filter((id) => id !== item.id && id !== item.externalId)
                          : [...referenceIds, item.id]
                        void onPatch(task.id, {
                          customValues: {
                            [column.id]: JSON.stringify({
                              ...stored,
                              value: { ...value, localIds: ids },
                              text: '',
                            }),
                          },
                        })
                      }}
                    />
                    {item.title}
                  </label>
                )
              })}
          </div>
        </PopoverContent>
      </Popover>
    )
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setDraft(value)
          setError('')
        }
      }}
    >
      <div className="rich-external-cell">
        <PopoverTrigger asChild>
          <button type="button" className="rich-external-trigger" aria-label={label}>
            {type === 'rating' ? (
              <Star size={13} />
            ) : column.source?.readOnly ? (
              <Info size={13} />
            ) : null}
            <span>{text || 'Sem valor'}</span>
          </button>
        </PopoverTrigger>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" aria-label={'Abrir ' + column.name}>
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      <PopoverContent className="rich-column-popover" aria-label={column.name}>
        <strong>{column.name}</strong>
        {editable ? (
          <>
            {fields[type].map((field) => (
              <label key={field.key}>
                {field.label}
                <Input
                  type={field.type || 'text'}
                  step={field.type === 'number' ? 'any' : undefined}
                  value={String(draft[field.key] ?? '')}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [field.key]:
                        field.type === 'number' ? Number(event.target.value) : event.target.value,
                    })
                  }
                />
              </label>
            ))}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              Salvar valor
            </Button>
          </>
        ) : (
          <>
            <p>
              {column.source?.formula
                ? 'Resultado e expressão preservados da origem. Esta expressão exige revisão antes de recalcular no QuadroOS.'
                : 'Valor e configuração preservados da origem.'}
            </p>
            {column.source?.formula && <code>{column.source.formula}</code>}
            <details>
              <summary>Dados originais</summary>
              <pre>{JSON.stringify(stored, null, 2)}</pre>
            </details>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
export function RichColumnCell(props: Props) {
  const { task, column, onPatch } = props,
    [busy, setBusy] = useState(false)
  const savedChecked = task.customValues[column.id] === 'true'
  const [checked, setChecked] = useState(savedChecked)
  useEffect(() => setChecked(savedChecked), [savedChecked, task.id, column.id])
  if (column.type === 'timeline') return <TimelineCell {...props} />
  if (column.type === 'time_tracking') return <TimeTrackingCell {...props} />
  if (column.type === 'last_updated')
    return (
      <output
        className="rich-last-updated"
        aria-label={column.name + ': ' + task.title}
        title={new Date(task.updatedAt).toLocaleString('pt-BR')}
      >
        <History size={13} />
        {shortDate(task.updatedAt)}
      </output>
    )
  if (column.type === 'checkbox')
    return (
      <label className="rich-checkbox checkbox-target">
        <input
          type="checkbox"
          aria-label={column.name + ': ' + task.title}
          checked={checked}
          disabled={busy}
          onChange={async (event) => {
            const next = event.target.checked
            setChecked(next)
            setBusy(true)
            try {
              if (!(await onPatch(task.id, { customValues: { [column.id]: String(next) } })))
                setChecked(savedChecked)
            } catch {
              setChecked(savedChecked)
            } finally {
              setBusy(false)
            }
          }}
        />
      </label>
    )
  return <ExternalColumnCell {...props} />
}
