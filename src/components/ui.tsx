import {
  useEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react'
import { X, LoaderCircle, Check, TriangleAlert, Pencil } from 'lucide-react'
import {
  type Person,
  STATUS_META,
  type Status,
  PRIORITY_META,
  type LabelOption,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
} from '../../shared/domain'
import { OverlayContainer } from '../lib/overlay-container'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectSeparator } from './ui/select'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { cn } from 'cn'

export function IconButton({
  label,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('icon-button', className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  )
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  className = '',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // A press that starts inside the panel and is released over the backdrop (selecting or
  // pasting into a field) still clicks the dialog element; only a press that began there closes.
  const pressedBackdrop = useRef(false)
  useEffect(() => {
    const dialog = ref.current!
    setContainer(dialog)
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        closeRef.current()
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        const fromBackdrop = pressedBackdrop.current
        pressedBackdrop.current = false
        if (fromBackdrop && e.target === e.currentTarget) closeRef.current()
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={descriptionId}>{subtitle}</p>}
          </div>
          <IconButton label="Fechar janela" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        <OverlayContainer value={container}>{children}</OverlayContainer>
      </div>
    </dialog>
  )
}
export function Avatar({ person, small = false }: { person?: Person; small?: boolean }) {
  return (
    <span
      title={person?.name || 'Sem responsável'}
      className={`avatar ${small ? 'small' : ''} ${person ? '' : 'unassigned'}`}
      style={
        person ? { backgroundColor: `color-mix(in srgb, ${person.color} 85%, #183826)` } : undefined
      }
    >
      {person?.initials || '+'}
    </span>
  )
}
export function Loading({ text = 'Organizando seu espaço…' }: { text?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>{text}</span>
    </div>
  )
}
export function EditableText({
  value,
  onSave,
  label,
  className = '',
  placeholder = '',
  multiline = false,
  activation = 'focus',
}: {
  value: string
  onSave: (v: string) => void
  label: string
  className?: string
  placeholder?: string
  multiline?: boolean
  activation?: 'focus' | 'doubleClick'
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (editing) {
      // The title is already on screen; letting focus scroll would shift wide board tables sideways.
      input.current?.focus({ preventScroll: true })
      input.current?.select()
    }
  }, [editing])
  const begin = () => {
    if (activation === 'doubleClick') setEditing(true)
  }
  const save = () => {
    if (activation === 'doubleClick') setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      setDraft(value)
      return
    }
    const next = draft.trim()
    if (next !== value && (next || multiline)) onSave(next)
    else setDraft(value)
  }
  const common = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: save,
    'aria-label': label,
    placeholder,
    className: `editable ${className}`,
  }
  const field = multiline ? (
    <textarea {...common} rows={4} maxLength={20000} />
  ) : (
    <input
      {...common}
      ref={input}
      readOnly={activation === 'doubleClick' && !editing}
      title={
        activation === 'doubleClick'
          ? 'Dois cliques para editar · Enter ou F2 pelo teclado'
          : undefined
      }
      maxLength={300}
      onDoubleClick={begin}
      onKeyDown={(e) => {
        if (activation === 'doubleClick' && !editing && ['Enter', 'F2'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          begin()
          return
        }
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape' && (activation === 'focus' || editing)) {
          e.stopPropagation()
          cancelled.current = true
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
  return activation === 'doubleClick' ? (
    <span className={`task-name-surface ${editing ? 'is-editing' : ''}`} onDoubleClick={begin}>
      {field}
    </span>
  ) : (
    field
  )
}
export function PillSelect({
  value,
  options,
  customOptions,
  onOpenEditLabels,
  onChange,
  label,
  className = '',
  disabled = false,
  placeholder,
  allowClear = false,
  kind,
}: {
  value: string
  options?: readonly string[]
  customOptions?: LabelOption[]
  onOpenEditLabels?: () => void
  onChange: (v: string) => void
  label: string
  className?: string
  disabled?: boolean
  placeholder?: string
  allowClear?: boolean
  kind?: 'status' | 'priority'
}) {
  // Restoring focus after closing a Select can make pointer input look like keyboard input.
  const [focusFromPointer, setFocusFromPointer] = useState(false)
  const [open, setOpen] = useState(false)
  const typeahead = useRef({ value: '', time: 0 })
  const isStatus = kind
    ? kind === 'status'
    : (customOptions &&
        customOptions.some((o) => o.id.startsWith('status') || o.label === 'Feito')) ||
      !!STATUS_META[value as Status] ||
      (options && options.includes('Feito'))

  const fallbackList = isStatus ? DEFAULT_STATUS_OPTIONS : DEFAULT_PRIORITY_OPTIONS
  const activeOptions = customOptions && customOptions.length ? customOptions : fallbackList

  // Resolve matching label option
  const matched = activeOptions.find((o) => o.label === value || o.id === value)

  const bgColor = matched
    ? matched.color
    : isStatus
      ? STATUS_META[value as Status]?.color || '#798099'
      : PRIORITY_META[value]?.color || '#798099'

  const displayText =
    !value && placeholder
      ? placeholder
      : matched
        ? matched.label
        : isStatus
          ? STATUS_META[value as Status]?.label || value || 'Não iniciado'
          : (PRIORITY_META[value]?.label ??
            (value === 'Sem prioridade' ? 'Sem prioridade' : value || 'Média'))

  const hasWarning =
    matched?.hasWarning ??
    (!isStatus && (PRIORITY_META[value]?.hasWarning || value === 'Crítico' || value === 'Urgente'))

  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={value}
      onValueChange={(next) => {
        if (next === '__quadroos_edit_labels__') onOpenEditLabels?.()
        else if (next === '__quadroos_clear__') onChange('')
        else onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        hideIcon={true}
        data-pointer-focus={focusFromPointer || undefined}
        onPointerDown={() => setFocusFromPointer(true)}
        onKeyDown={(event) => {
          setFocusFromPointer(false)
          if (open || event.ctrlKey || event.metaKey || event.altKey) return
          if (event.key.length !== 1 || event.key === ' ') {
            typeahead.current.value = ''
            return
          }
          event.preventDefault()
          const now = Date.now(),
            typed =
              now - typeahead.current.time < 1000 ? typeahead.current.value + event.key : event.key
          typeahead.current = { value: typed, time: now }
          const query = [...typed].every((character) => character === typed[0]) ? typed[0] : typed
          const current = activeOptions.findIndex((option) => option.label === value)
          const choices =
            query.length === 1
              ? [...activeOptions.slice(current + 1), ...activeOptions.slice(0, current + 1)]
              : activeOptions
          const option = choices.find((option) =>
            option.label.toLocaleLowerCase('pt-BR').startsWith(query.toLocaleLowerCase('pt-BR')),
          )
          if (option) onChange(option.label)
        }}
        onBlur={() => setFocusFromPointer(false)}
        className={`monday-choice-trigger ${className}`}
        style={{ backgroundColor: bgColor, color: '#ffffff' }}
      >
        <span className="monday-choice-text">
          <span className="choice-caption">{displayText}</span>
          {hasWarning && <TriangleAlert size={13} className="monday-warning-icon" />}
        </span>
      </SelectTrigger>
      {open && (
        <SelectContent
          position="popper"
          align="center"
          sideOffset={5}
          className="monday-choice-popover"
          onPointerDownCapture={() => setFocusFromPointer(true)}
          onKeyDownCapture={() => setFocusFromPointer(false)}
          onPointerDownOutside={() => setFocusFromPointer(true)}
        >
          <div className="monday-choice-list">
            {activeOptions.map((opt) => (
              <SelectItem
                key={opt.id || opt.label}
                value={opt.label}
                hideIndicator={true}
                className="monday-choice-option"
                style={{ backgroundColor: opt.color, color: '#ffffff' }}
              >
                <span className="monday-option-content">
                  <span className="choice-caption">{opt.label}</span>
                  {opt.hasWarning && <TriangleAlert size={13} className="monday-warning-icon" />}
                </span>
              </SelectItem>
            ))}
          </div>
          {allowClear && value && (
            <SelectItem value="__quadroos_clear__" hideIndicator className="label-edit-option">
              Limpar seleção
            </SelectItem>
          )}
          {onOpenEditLabels && (
            <>
              <SelectSeparator />
              <SelectItem
                value="__quadroos_edit_labels__"
                hideIndicator
                className="label-edit-option"
              >
                <Pencil size={14} />
                Editar etiquetas
              </SelectItem>
            </>
          )}
        </SelectContent>
      )}
    </Select>
  )
}

export function ChoiceBadge({
  value,
  customOptions,
  className = '',
}: {
  value: string
  customOptions?: LabelOption[]
  className?: string
}) {
  const custom = customOptions?.find((o) => o.label === value || o.id === value)
  const isStatus = !!STATUS_META[value as Status]
  const statusMeta = STATUS_META[value as Status]
  const priorityMeta = PRIORITY_META[value]

  const bgColor = custom
    ? custom.color
    : isStatus
      ? statusMeta?.color || '#798099'
      : priorityMeta?.color || '#798099'

  const label = custom
    ? custom.label
    : isStatus
      ? statusMeta?.label || value
      : (priorityMeta?.label ?? (value === 'Sem prioridade' ? 'Sem prioridade' : value))

  const hasWarning =
    custom?.hasWarning ||
    (!isStatus && (priorityMeta?.hasWarning || value === 'Crítico' || value === 'Urgente'))

  return (
    <Badge
      variant="outline"
      className={`monday-badge ${isStatus ? 'status-badge' : 'priority-badge'} ${className}`}
      style={{ backgroundColor: bgColor, color: '#ffffff' }}
    >
      {label}
      {hasWarning && <TriangleAlert size={12} className="monday-warning-icon" />}
    </Badge>
  )
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}
export function SubmitButton({
  busy,
  children,
  disabled,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <Button
      className={cn('button primary', className)}
      type="submit"
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? (
        <LoaderCircle size={16} className="spin" aria-hidden="true" />
      ) : (
        <Check size={16} aria-hidden="true" />
      )}
      {children}
    </Button>
  )
}
