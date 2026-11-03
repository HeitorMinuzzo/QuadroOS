import { useState, useRef } from 'react'
import {
  CalendarDays,
  Hash,
  ListFilter,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
  Type,
  Users,
  EyeOff,
  Paperclip,
  Sigma,
  CalendarRange,
  SquareCheck,
  Timer,
  History,
  Database,
} from 'lucide-react'
import {
  type Board,
  type CustomColumn,
  type ColumnType,
  type LabelOption,
  COLUMN_TYPES,
  DEFAULT_STATUS_OPTIONS,
} from '../../shared/domain'
import { boardColumns, COLUMN_TYPE_NAMES, SYSTEM_COLUMN_IDS } from '../../shared/columns'
import { compileFormula, displayFormula, formulaReference } from '../../shared/formulas'
import { api, json } from '../api'
import { Modal, SubmitButton } from './ui'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export const COLUMN_ICONS = {
  status: ListTodo,
  text: Type,
  people: Users,
  dropdown: ListFilter,
  date: CalendarDays,
  number: Hash,
  files: Paperclip,
  formula: Sigma,
  timeline: CalendarRange,
  checkbox: SquareCheck,
  time_tracking: Timer,
  last_updated: History,
  external: Database,
}
const typeColors = {
  status: '#00a86b',
  text: '#c58b00',
  people: '#36a9cf',
  dropdown: '#00a86b',
  date: '#9865c9',
  number: '#c58b00',
  files: '#3b78c8',
  formula: '#7456ba',
  timeline: '#00a86b',
  checkbox: '#e49a00',
  time_tracking: '#3b78c8',
  last_updated: '#9865c9',
  external: '#798099',
}
function initialOptions(type: ColumnType): LabelOption[] {
  return type === 'status'
    ? DEFAULT_STATUS_OPTIONS.map((option) => ({ ...option, id: crypto.randomUUID() }))
    : [
        { id: crypto.randomUUID(), label: 'Opção 1', color: '#0073ea' },
        { id: crypto.randomUUID(), label: 'Opção 2', color: '#8b79bd' },
      ]
}
export function ColumnTypeIcon({ type }: { type: ColumnType }) {
  const Icon = COLUMN_ICONS[type]
  return (
    <span className="column-type-icon" style={{ background: typeColors[type] }}>
      <Icon size={14} aria-hidden="true" />
    </span>
  )
}
export function AddColumnMenu({
  onSelect,
  label = 'Adicionar coluna',
}: {
  onSelect: (type: ColumnType) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <Plus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="column-type-popover" aria-label="Tipos de coluna">
        <p>Essenciais</p>
        <div className="column-type-catalog">
          {COLUMN_TYPES.filter((type) => type !== 'external').map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => {
                setOpen(false)
                onSelect(type)
              }}
            >
              <ColumnTypeIcon type={type} />
              <span>{COLUMN_TYPE_NAMES[type]}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ColumnEditor({
  board,
  column,
  initialType = 'text',
  scope = 'tasks',
  onClose,
  onRefresh,
  onEditLabels,
}: {
  board: Board
  column?: CustomColumn
  initialType?: ColumnType
  scope?: 'tasks' | 'subitems'
  onClose: () => void
  onRefresh: () => Promise<void>
  onEditLabels?: (type: 'status' | 'priority') => void
}) {
  const [name, setName] = useState(column?.name || '')
  const [type, setType] = useState<ColumnType>(column?.type || initialType)
  const [options, setOptions] = useState<LabelOption[]>(
    column?.options?.map((option) => ({ ...option })) || initialOptions(initialType),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const formulaInput = useRef<HTMLTextAreaElement>(null)
  const [formula, setFormula] = useState(
    column?.formula ? displayFormula(column.formula, boardColumns(board)) : '',
  )
  const referenceColumns = boardColumns(board).filter(
    (c) => !['files', 'people', 'dropdown'].includes(c.type) && c.id !== column?.id,
  )
  let formulaError = ''
  if (type === 'formula' && formula.trim()) {
    try {
      compileFormula(formula, boardColumns(board))
    } catch (e) {
      formulaError = e instanceof Error ? e.message : 'Confira a fórmula.'
    }
  }
  function insertReference(id: string) {
    const field = referenceColumns.find((c) => c.id === id)!
    const reference = formulaReference(field, boardColumns(board))
    const start = formulaInput.current?.selectionStart ?? formula.length
    const end = formulaInput.current?.selectionEnd ?? start
    setFormula(formula.slice(0, start) + reference + formula.slice(end))
    requestAnimationFrame(() => {
      formulaInput.current?.focus()
      formulaInput.current?.setSelectionRange(start + reference.length, start + reference.length)
    })
  }
  const system = !!column && SYSTEM_COLUMN_IDS.includes(column.id)
  const configurable = !system && (type === 'status' || type === 'dropdown')
  function choose(next: ColumnType) {
    if (next === type) return
    if (!name || name === COLUMN_TYPE_NAMES[type]) setName(COLUMN_TYPE_NAMES[next])
    if (next === 'status' || next === 'dropdown') setOptions(initialOptions(next))
    setType(next)
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      await api(`/boards/${board.id}/columns${column ? `/${column.id}` : ''}`, {
        method: column ? 'PATCH' : 'POST',
        body: json({
          name: name.trim(),
          type,
          ...(!column ? { scope } : {}),
          ...(configurable ? { options } : {}),
          ...(type === 'formula' ? { formula } : {}),
        }),
      })
      await onRefresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a coluna.')
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!column) return
    setBusy(true)
    setError('')
    try {
      await api(
        `/boards/${board.id}/columns/${column.id}`,
        system ? { method: 'PATCH', body: json({ hidden: true, scope }) } : { method: 'DELETE' },
      )
      await onRefresh()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível alterar a coluna.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={column ? 'Editar coluna' : 'Nova coluna'}
      subtitle={
        column
          ? 'Ajuste como esta informação aparece no quadro.'
          : 'Escolha o tipo de informação que faz sentido para o seu trabalho.'
      }
      onClose={onClose}
      className="column-editor-modal"
    >
      <form
        className="column-editor-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="column-editor-section">
          <label htmlFor="column-name">Nome da coluna</label>
          <Input
            id="column-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={COLUMN_TYPE_NAMES[type]}
            maxLength={300}
            required
            autoFocus
            disabled={busy}
          />
        </div>
        <fieldset
          className="column-editor-section"
          disabled={
            busy ||
            system ||
            (!!column && ['files', 'formula', 'external', 'last_updated'].includes(column.type))
          }
        >
          <legend>Tipo de informação</legend>
          <div className="column-type-choices">
            {COLUMN_TYPES.map((kind) => (
              <label key={kind} data-selected={type === kind}>
                <input
                  type="radio"
                  name="column-type"
                  value={kind}
                  checked={type === kind}
                  onChange={() => choose(kind)}
                  aria-label={COLUMN_TYPE_NAMES[kind]}
                />
                <ColumnTypeIcon type={kind} />
                <span>{COLUMN_TYPE_NAMES[kind]}</span>
                <span className="column-type-selected" aria-hidden="true">
                  ✓
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {column && ['files', 'formula'].includes(column.type) && (
          <p className="column-editor-hint">
            Este tipo é fixo para preservar os arquivos e os cálculos. O nome
            {type === 'formula' ? ' e a expressão' : ''} pode ser editado.
          </p>
        )}
        {type === 'formula' && (
          <section className="column-editor-section formula-editor">
            <label htmlFor="column-formula">Expressão da fórmula</label>
            <textarea
              ref={formulaInput}
              id="column-formula"
              aria-describedby="formula-help"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              required
              maxLength={2000}
              rows={3}
              disabled={busy}
              placeholder="{Quantidade} * {Valor unitário}"
              spellCheck={false}
            />
            <p id="formula-help">
              Use <code>{'{Coluna}'}</code> para referenciar um campo desta tarefa. Decimais usam
              ponto; argumentos são separados por ponto e vírgula.
            </p>
            {formulaError && (
              <p role="alert" className="formula-editor-error">
                {formulaError}
              </p>
            )}
            <span className="formula-reference-label">Inserir coluna</span>
            <div className="formula-references">
              {referenceColumns.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => insertReference(c.id)}
                >
                  <ColumnTypeIcon type={c.type} />
                  {c.name}
                </Button>
              ))}
              {!referenceColumns.length && (
                <span>Adicione uma coluna de números para começar.</span>
              )}
            </div>
            <details className="formula-help">
              <summary>Funções e exemplos</summary>
              <p>
                <code>SOMA</code>, <code>MEDIA</code>, <code>MIN</code>, <code>MAX</code>,{' '}
                <code>SE</code>, <code>SEERRO</code>, <code>ARRED</code>, <code>ABS</code>,{' '}
                <code>E</code>, <code>OU</code> e <code>CONCAT</code>. Os nomes em inglês também são
                aceitos.
              </p>
              <code>{'ARRED({Quantidade} * {Preço}; 2)'}</code>
              <code>{'SE({Status} = "Feito"; 100; 0)'}</code>
              <p>
                O resultado é atualizado em cada tarefa e subitem. A fórmula é configurada uma vez
                para a coluna.
              </p>
            </details>
          </section>
        )}
        {type === 'files' && (
          <p className="column-editor-hint">
            Anexe documentos, imagens e outros arquivos em cada tarefa ou subitem. Até 5 MB por
            arquivo e 20 arquivos por célula, com download e exclusão.
          </p>
        )}
        {system && (
          <p className="column-editor-hint">
            Você pode renomear ou ocultar esta coluna. Seu tipo mantém as funções de responsáveis,
            prazos e progresso do quadro.
          </p>
        )}
        {system && (column.id === 'status' || column.id === 'priority') && onEditLabels && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClose()
              onEditLabels(column.id as 'status' | 'priority')
            }}
          >
            <Pencil size={14} />
            Editar etiquetas
          </Button>
        )}
        {configurable && (
          <section className="column-editor-section">
            <div className="column-options-heading">
              <h3>{type === 'status' ? 'Etiquetas do status' : 'Opções da lista'}</h3>
              <span>{options.length} opções</span>
            </div>
            <div className="column-options-editor">
              {options.map((option, index) => (
                <div className="column-option-row" key={option.id}>
                  <input
                    type="color"
                    value={option.color}
                    aria-label={`Cor da opção ${index + 1}`}
                    disabled={busy}
                    onChange={(e) =>
                      setOptions((items) =>
                        items.map((item) =>
                          item.id === option.id ? { ...item, color: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    value={option.label}
                    maxLength={300}
                    required
                    aria-label={`Nome da opção ${index + 1}`}
                    disabled={busy}
                    onChange={(e) =>
                      setOptions((items) =>
                        items.map((item) =>
                          item.id === option.id ? { ...item, label: e.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remover opção ${index + 1}`}
                    disabled={busy || options.length <= 1}
                    onClick={() =>
                      setOptions((items) => items.filter((item) => item.id !== option.id))
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || options.length >= 40}
              onClick={() =>
                setOptions((items) => [
                  ...items,
                  { id: crypto.randomUUID(), label: `Opção ${items.length + 1}`, color: '#0073ea' },
                ])
              }
            >
              <Plus size={14} />
              Adicionar opção
            </Button>
          </section>
        )}
        {type === 'people' && (
          <p className="column-editor-hint">
            Permite selecionar uma ou mais pessoas em cada tarefa.
          </p>
        )}
        {type === 'dropdown' && (
          <p className="column-editor-hint">Cada tarefa pode ter uma ou mais opções da lista.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {confirmDelete && (
          <div
            className="column-delete-confirmation"
            role="group"
            aria-label="Confirmar exclusão da coluna"
          >
            <strong>Excluir “{column?.name}”?</strong>
            <p>
              Os valores desta coluna serão removidos das tarefas e subitens. As tarefas continuam
              no quadro.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                Voltar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                Confirmar exclusão
              </Button>
            </div>
          </div>
        )}
        <footer className="column-editor-footer">
          <div>
            {column && !confirmDelete && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => (system ? void remove() : setConfirmDelete(true))}
              >
                {system ? <EyeOff size={14} /> : <Trash2 size={14} />}
                {system ? 'Ocultar coluna' : 'Excluir coluna'}
              </Button>
            )}
          </div>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <SubmitButton
            busy={busy}
            disabled={
              busy ||
              !name.trim() ||
              (type === 'formula' && (!formula.trim() || !!formulaError)) ||
              confirmDelete ||
              (configurable && options.some((option) => !option.label.trim()))
            }
          >
            {column ? 'Salvar coluna' : 'Criar coluna'}
          </SubmitButton>
        </footer>
      </form>
    </Modal>
  )
}
