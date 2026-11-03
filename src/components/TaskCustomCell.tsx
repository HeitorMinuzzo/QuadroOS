import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type {
  CustomColumn,
  Task,
  Person,
  Board,
  FileAttachment,
  Workspace,
} from '../../shared/domain'
import { localDate } from '../../shared/domain'
import { RichColumnCell } from './RichColumnCell'
import { columnList } from '../../shared/columns'
import { AssigneePicker } from './AssigneePicker'
import { DatePicker } from './DatePicker'
import { PillSelect } from './ui'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Button } from './ui/button'
import { FilesCell } from './FilesCell'
import { boardColumns } from '../../shared/columns'
import { evaluateFormula, formulaText } from '../../shared/formulas'
import { jsonObject } from '../../shared/rich-values'

function DropdownCell({
  task,
  column,
  onPatch,
}: {
  task: Task
  column: CustomColumn
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
}) {
  const value = columnList(task.customValues[column.id] || '')
  const [draft, setDraft] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = draft ?? value
  async function change(values: string[]) {
    setDraft(values)
    setBusy(true)
    setError('')
    try {
      if (!(await onPatch(task.id, { customValues: { [column.id]: JSON.stringify(values) } })))
        setError('Não foi possível salvar a seleção.')
    } catch {
      setError('Não foi possível salvar a seleção.')
    } finally {
      setDraft(null)
      setBusy(false)
    }
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="custom-dropdown-trigger"
          aria-label={column.name + ': ' + task.title}
        >
          <span className="custom-dropdown-values">
            {selected.length ? (
              selected.slice(0, 2).map((label) => (
                <span
                  key={label}
                  style={{
                    borderColor: column.options?.find((option) => option.label === label)?.color,
                  }}
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="custom-field-placeholder">Selecionar…</span>
            )}
            {selected.length > 2 && <small>+{selected.length - 2}</small>}
          </span>
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="custom-dropdown-popover"
        align="start"
        aria-label={'Opções de ' + column.name}
      >
        <strong>{column.name}</strong>
        <div role="group" aria-label="Opções da lista">
          {column.options?.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={selected.includes(option.label)}
                disabled={busy}
                onChange={(e) =>
                  void change(
                    e.target.checked
                      ? [...selected, option.label]
                      : selected.filter((label) => label !== option.label),
                  )
                }
              />
              <i style={{ background: option.color }} aria-hidden="true" />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || !selected.length}
          onClick={() => void change([])}
        >
          Limpar seleção
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function LongTextCell({
  value,
  label,
  onSave,
}: {
  value: string
  label: string
  onSave: (value: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
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
        <button type="button" className="rich-external-trigger" aria-label={label}>
          <span>{value || 'Adicionar texto…'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="rich-column-popover" aria-label={'Editar ' + label}>
        <strong>Texto longo</strong>
        <textarea
          aria-label={label}
          value={draft}
          rows={7}
          maxLength={1_000_000}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              if (await onSave(draft)) setOpen(false)
              else setError('Não foi possível salvar o texto.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Salvar texto
        </Button>
      </PopoverContent>
    </Popover>
  )
}
export function TaskCustomCell({
  task,
  column,
  onPatch,
  people = [],
  onEditColumn,
  board,
  attachments = [],
  onRefresh,
  workspace,
  onOpenTask,
}: {
  task: Task
  column: CustomColumn
  people?: Person[]
  board: Board
  attachments?: FileAttachment[]
  onRefresh: () => Promise<void>
  workspace?: Pick<Workspace, 'tasks' | 'boards'>
  onOpenTask?: (id: string) => void
  onEditColumn?: () => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
}) {
  const value = task.customValues[column.id] || ''
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(value), [value])
  const label = column.name + ': ' + task.title
  if (column.type === 'text' && column.source?.type === 'long_text')
    return (
      <LongTextCell
        value={value}
        label={label}
        onSave={(value) => onPatch(task.id, { customValues: { [column.id]: value } })}
      />
    )
  if (['timeline', 'checkbox', 'time_tracking', 'last_updated', 'external'].includes(column.type))
    return (
      <RichColumnCell
        task={task}
        column={column}
        onPatch={onPatch}
        workspace={workspace}
        onOpenTask={onOpenTask}
      />
    )
  if (column.type === 'files')
    return <FilesCell task={task} column={column} attachments={attachments} onRefresh={onRefresh} />
  if (column.type === 'formula') {
    const result = evaluateFormula(column, boardColumns(board), task)
    return (
      <output
        className={`formula-result ${result.error ? 'has-error' : ''}`}
        aria-label={label}
        title={result.error || 'Resultado calculado automaticamente'}
      >
        {formulaText(result)}
      </output>
    )
  }
  if (column.type === 'people')
    return (
      <AssigneePicker
        people={people}
        value={columnList(value)}
        label={label}
        onChange={(ids) => onPatch(task.id, { customValues: { [column.id]: JSON.stringify(ids) } })}
      />
    )
  if (column.type === 'date')
    return (
      <DatePicker
        kind="date"
        value={value.includes('T') ? localDate(new Date(value)) : value || null}
        dateTime={value.includes('T') ? value : null}
        onChangeDateTime={(date, instant) =>
          onPatch(task.id, { customValues: { [column.id]: instant || date || '' } })
        }
        label={label}
        onChange={(date) => onPatch(task.id, { customValues: { [column.id]: date || '' } })}
      />
    )
  if (column.type === 'status')
    return (
      <PillSelect
        kind="status"
        value={value}
        customOptions={column.options}
        placeholder="Selecionar…"
        allowClear
        label={label}
        onOpenEditLabels={onEditColumn}
        onChange={(status) => void onPatch(task.id, { customValues: { [column.id]: status } })}
      />
    )
  if (column.type === 'dropdown')
    return <DropdownCell task={task} column={column} onPatch={onPatch} />
  const control = (
    <input
      className="custom-input"
      aria-label={label}
      type={column.type}
      step={column.type === 'number' ? 'any' : undefined}
      value={draft}
      placeholder="—"
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        if (draft === value) return
        setBusy(true)
        try {
          if (!(await onPatch(task.id, { customValues: { [column.id]: draft } }))) setDraft(value)
        } finally {
          setBusy(false)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
  const unit = jsonObject(column.source?.settings?.unit)
  const symbol =
    unit.symbol === 'custom' ? String(unit.custom_unit || '') : String(unit.symbol || '')
  return column.type === 'number' && symbol ? (
    <div className="number-with-unit">
      {unit.direction !== 'right' && <span>{symbol}</span>}
      {control}
      {unit.direction === 'right' && <span>{symbol}</span>}
    </div>
  ) : (
    control
  )
}
