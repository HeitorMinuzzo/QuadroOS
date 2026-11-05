import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowUpRight,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
  ChevronRight,
} from 'lucide-react'
import {
  type Task,
  type Workspace,
  type Status,
  type Priority,
  type LabelOption,
  type CustomColumn,
  type ColumnType,
  COLUMN_TYPES,
  DEFAULT_STATUS_OPTIONS,
  isOverdue,
  isTaskDone,
  taskOwnerIds,
  type TaskPanelTab,
  taskUpdateCount,
  localDate,
} from '../../shared/domain'
import { api, json } from '../api'
import { EditableText, PillSelect } from './ui'
import { justCreated } from '../lib/motion'
import { FieldSelect } from './FieldSelect'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu'
import { TaskCustomCell } from './TaskCustomCell'
import { AssigneePicker } from './AssigneePicker'
import { DatePicker } from './DatePicker'
import { ColumnHeading, useColumnOrder } from './ColumnOrdering'
import { boardColumns, COLUMN_TYPE_NAMES } from '../../shared/columns'
import { ColumnEditor, ColumnTypeIcon } from './ColumnEditor'
import { EditLabelsDialog } from './EditLabelsDialog'
import {
  TaskSorting,
  SortableTaskRows,
  TaskDragHandle,
  SortableTaskName,
  type MoveTask,
} from './TaskSorting'

const standardColumns = [
  { key: 'owner', label: 'Responsável', width: 108 },
  { key: 'status', label: 'Status', width: 136 },
  { key: 'priority', label: 'Prioridade', width: 125 },
  { key: 'date', label: 'Prazo', width: 140 },
]
const defaultColumns = ['owner', 'status', 'date']

export function SubitemsPanel({
  parent,
  data,
  onPatch,
  onRefresh,
  onOpenTask,
  onDelete,
  statusOptions: parentStatusOptions,
  priorityOptions: parentPriorityOptions,
  onOpenEditLabels,
  onMoveTask,
  revealIds,
}: {
  parent: Task
  data: Workspace
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
  onRefresh: () => Promise<void>
  onOpenTask: (id: string, tab?: TaskPanelTab) => void
  onDelete: (ids: string[]) => void
  statusOptions?: LabelOption[]
  priorityOptions?: LabelOption[]
  onOpenEditLabels?: (type: 'status' | 'priority') => void
  onMoveTask: MoveTask
  revealIds?: string[]
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string[]>([])
  useEffect(() => {
    if (revealIds?.length)
      setExpanded((previous) => {
        const next = revealIds.filter(
          (id) =>
            data.tasks.some((task) => task.id === id && task.parentId === parent.id) &&
            !previous.includes(id),
        )
        return next.length ? [...previous, ...next] : previous
      })
  }, [revealIds, data.tasks, parent.id])
  const [editingSystemLabels, setEditingSystemLabels] = useState<'status' | 'priority' | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [columnsSaving, setColumnsSaving] = useState(false)
  const [editingColumn, setEditingColumn] = useState<CustomColumn | null>(null)
  const [creatingType, setCreatingType] = useState<ColumnType | null>(null)
  const [draftColumns, setDraftColumns] = useState<string[] | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const selectAll = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(false)
  const id = useId()
  const board = data.boards.find((b) => b.id === parent.boardId)
  const statusOptions = board?.settings?.subitemStatusOptions || parentStatusOptions
  const priorityOptions = board?.settings?.subitemPriorityOptions || parentPriorityOptions
  const group = data.groups.find((g) => g.id === parent.groupId)
  const columnOrder = useColumnOrder(board, 'subitems', onRefresh)
  const children = data.tasks
    .filter((t) => t.parentId === parent.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const childIds = new Set(children.map((t) => t.id))
  const withSubitems = new Set(
    data.tasks.filter((t) => t.parentId && childIds.has(t.parentId)).map((t) => t.parentId),
  )
  const done = children.filter((t) => isTaskDone(t, board)).length
  const allSelected = children.length > 0 && children.every((t) => selected.includes(t.id))
  const definitions = board ? boardColumns(board, 'subitems') : []
  const allColumns = definitions.map((c) => ({
    key: c.id,
    label: c.name,
    width:
      board?.settings?.subitemColumnWidths?.[c.id] ||
      standardColumns.find((column) => column.key === c.id)?.width ||
      135,
  }))
  const columnKeys =
    draftColumns ??
    (Array.isArray(board?.settings?.subitemColumns)
      ? board.settings.subitemColumns
      : defaultColumns)
  const visibleColumns = columnOrder.keys
    .filter((key) => columnKeys.includes(key))
    .map((key) => allColumns.find((c) => c.key === key)!)
  const statusChoices = statusOptions?.length ? statusOptions : DEFAULT_STATUS_OPTIONS
  useEffect(() => {
    setSelected((prev) =>
      prev.filter((id) => data.tasks.some((t) => t.id === id && t.parentId === parent.id)),
    )
  }, [data.tasks, parent.id])
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !allSelected
  }, [selected.length, allSelected])
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      // The field spans the whole subitem table, often wider than the group; a scrolling focus
      // would push the group table sideways after every new subitem.
      input.current?.focus({ preventScroll: true })
      restoreFocus.current = false
    }
  }, [busy])

  async function add() {
    if (!title.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await api('/tasks', {
        method: 'POST',
        body: json({
          boardId: parent.boardId,
          groupId: parent.groupId,
          parentId: parent.id,
          title: title.trim(),
          status: board?.settings?.monday ? '' : 'Não iniciado',
          priority: board?.settings?.monday ? '' : 'Média',
          ownerIds: taskOwnerIds(parent),
        }),
      })
      await onRefresh()
      setTitle('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar o subitem.')
    } finally {
      restoreFocus.current = true
      setBusy(false)
    }
  }
  async function toggleColumn(key: string, show: boolean) {
    if (!board || columnsSaving) return
    const next = show ? [...new Set([...columnKeys, key])] : columnKeys.filter((c) => c !== key)
    setDraftColumns(next)
    setColumnsSaving(true)
    setError('')
    try {
      await api(`/boards/${board.id}`, {
        method: 'PATCH',
        body: json({ settings: { subitemColumns: next } }),
      })
      await onRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar as colunas dos subitens.')
    } finally {
      setDraftColumns(null)
      setColumnsSaving(false)
    }
  }
  async function updateSelected(status: string) {
    if (bulkSaving) return
    setBulkSaving(true)
    setError('')
    try {
      for (const taskId of selected) {
        if (!(await onPatch(taskId, { status }))) {
          setError('Alguns subitens não foram atualizados. Confira os dados e tente novamente.')
          return
        }
      }
      setSelected([])
    } finally {
      setBulkSaving(false)
    }
  }
  function field(child: Task, key: string) {
    if (key === 'owner')
      return (
        <AssigneePicker
          people={data.people}
          value={taskOwnerIds(child)}
          compact
          label={`Responsável: ${child.title}`}
          onChange={(ownerIds) => onPatch(child.id, { ownerIds })}
        />
      )
    if (key === 'status' || key === 'priority')
      return (
        <PillSelect
          kind={key === 'status' ? 'status' : 'priority'}
          allowClear={!!board?.settings?.monday}
          placeholder={board?.settings?.monday ? 'Selecionar…' : undefined}
          value={key === 'status' ? child.status : child.priority}
          customOptions={key === 'status' ? statusOptions : priorityOptions}
          onOpenEditLabels={() => setEditingSystemLabels(key)}
          label={`${key === 'status' ? 'Status' : 'Prioridade'}: ${child.title}`}
          onChange={(value) =>
            void onPatch(
              child.id,
              key === 'status' ? { status: value as Status } : { priority: value as Priority },
            )
          }
        />
      )
    if (key === 'date')
      return (
        <DatePicker
          value={child.dueAt ? localDate(new Date(child.dueAt)) : child.dueDate}
          dateTime={child.dueAt}
          onChangeDateTime={(dueDate, dueAt) => onPatch(child.id, { dueDate, dueAt })}
          label={`Prazo: ${child.title}`}
          overdue={isOverdue(child, board)}
          onChange={(dueDate) => onPatch(child.id, { dueDate })}
        />
      )
    const column = board?.columns.find((c) => c.id === key)
    return column && board ? (
      <TaskCustomCell
        workspace={data}
        onOpenTask={onOpenTask}
        board={board}
        attachments={data.attachments}
        onRefresh={onRefresh}
        task={child}
        column={column}
        people={data.people}
        onPatch={onPatch}
        onEditColumn={() => setEditingColumn(column)}
      />
    ) : null
  }
  return (
    <section
      className="subitems-panel"
      aria-label={`Subitens de ${parent.title}`}
      style={
        {
          '--subitem-color': group?.color || board?.color || '#0073ea',
          '--subitem-toolbar-height': selected.length ? '40px' : '0px',
        } as CSSProperties
      }
    >
      <div
        className="subitems-connectors"
        aria-hidden="true"
        style={{
          height: `calc(14px + var(--subitem-toolbar-height) + 34px + ${children.length * 36 + 6}px)`,
        }}
      >
        {children.map((child, index) => (
          <i
            key={child.id}
            style={{
              top: `calc(14px + var(--subitem-toolbar-height) + 34px + ${(index + 1) * 36 - 12}px)`,
            }}
          />
        ))}
        <i className="subitem-create-connector" style={{ top: '100%' }} />
      </div>
      {!!selected.length && (
        <div
          className="subitem-selection-bar"
          role="toolbar"
          aria-label="Ações dos subitens selecionados"
        >
          <strong>
            {selected.length}{' '}
            {selected.length === 1 ? 'subitem selecionado' : 'subitens selecionados'}
          </strong>
          <FieldSelect
            label="Alterar status dos subitens selecionados"
            value=""
            placeholder="Alterar status"
            disabled={bulkSaving}
            onChange={(value) => void updateSelected(value)}
            options={statusChoices.map((option) => ({
              value: option.label,
              label: option.label,
              color: option.color,
            }))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={bulkSaving}
            onClick={() => onDelete(selected)}
          >
            <Trash2 />
            Excluir
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Limpar seleção de subitens"
            disabled={bulkSaving}
            onClick={() => setSelected([])}
          >
            <X />
          </Button>
        </div>
      )}
      <TaskSorting tasks={children} onMove={onMoveTask}>
        {(orderedTasks) => (
          <div
            className="subitems-scroll"
            tabIndex={0}
            role="region"
            aria-label={`Tabela de subitens de ${parent.title}`}
          >
            <table
              className="subitems-table"
              style={{ minWidth: 394 + visibleColumns.reduce((sum, c) => sum + c.width, 0) }}
            >
              <caption className="sr-only">Subitens de {parent.title}</caption>
              <colgroup>
                <col style={{ width: 32 }} />
                <col />
                <col style={{ width: 42 }} />
                {visibleColumns.map((c) => (
                  <col key={c.key} style={{ width: c.width }} />
                ))}
                <col style={{ width: 40 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="subitem-check-cell">
                    <label className="checkbox-target">
                      <input
                        ref={selectAll}
                        type="checkbox"
                        aria-label={`Selecionar todos os subitens de ${parent.title}`}
                        checked={allSelected}
                        disabled={!children.length || bulkSaving}
                        onChange={(e) =>
                          setSelected(e.target.checked ? children.map((t) => t.id) : [])
                        }
                      />
                    </label>
                  </th>
                  <th scope="col" className="subitem-name-cell">
                    <div className="subitem-name-heading">
                      <span>Subitem</span>
                      <small>
                        {done} de {children.length} feitos
                      </small>
                      <progress
                        className="sr-only"
                        value={done}
                        max={Math.max(1, children.length)}
                        aria-label="Progresso dos subitens"
                      />
                    </div>
                  </th>
                  <th scope="col" className="subitem-comments-cell">
                    <span className="sr-only">Comentários</span>
                  </th>
                  {visibleColumns.map((c) => (
                    <ColumnHeading
                      key={c.key}
                      columnKey={c.key}
                      label={c.label}
                      className={`subitem-${c.key}-cell`}
                      onEdit={() =>
                        setEditingColumn(definitions.find((column) => column.id === c.key)!)
                      }
                      order={columnOrder}
                      visibleKeys={visibleColumns.map((column) => column.key)}
                    />
                  ))}
                  <th scope="col" className="subitem-add-column">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Colunas dos subitens"
                          title="Mostrar colunas dos subitens"
                        >
                          <Plus />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="subitem-columns-menu">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Mostrar colunas</DropdownMenuLabel>
                          {allColumns.map((c) => (
                            <DropdownMenuCheckboxItem
                              key={c.key}
                              checked={columnKeys.includes(c.key)}
                              disabled={columnsSaving}
                              onSelect={(e) => e.preventDefault()}
                              onCheckedChange={(show) => void toggleColumn(c.key, show)}
                            >
                              {c.label}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Adicionar coluna</DropdownMenuLabel>
                          <div className="column-type-catalog">
                            {COLUMN_TYPES.filter((type) => type !== 'external').map((type) => (
                              <DropdownMenuItem key={type} onSelect={() => setCreatingType(type)}>
                                <ColumnTypeIcon type={type} />
                                {COLUMN_TYPE_NAMES[type]}
                              </DropdownMenuItem>
                            ))}
                          </div>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                </tr>
              </thead>
              {orderedTasks.map((child) => {
                const commentCount = taskUpdateCount(data.comments, child.id)
                return (
                  <SortableTaskRows key={child.id} task={child}>
                    <tr
                      data-task-id={child.id}
                      data-selected={selected.includes(child.id)}
                      className={`${isTaskDone(child, board) ? 'subitem-done' : ''} ${justCreated(child.createdAt) ? 'row-new' : ''}`}
                    >
                      <td className="subitem-check-cell">
                        <label className="checkbox-target">
                          <input
                            type="checkbox"
                            aria-label={`Selecionar subitem ${child.title}`}
                            checked={selected.includes(child.id)}
                            disabled={bulkSaving}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, child.id])]
                                  : prev.filter((id) => id !== child.id),
                              )
                            }
                          />
                        </label>
                      </td>
                      <td className="subitem-name-cell">
                        <div className="subitem-title">
                          <TaskDragHandle title={child.title} />
                          <button
                            type="button"
                            className="subitem-expand-button"
                            data-has-subitems={withSubitems.has(child.id)}
                            aria-label={`Expandir subitens de ${child.title}`}
                            aria-expanded={expanded.includes(child.id)}
                            onClick={() =>
                              setExpanded((previous) =>
                                previous.includes(child.id)
                                  ? previous.filter((id) => id !== child.id)
                                  : [...previous, child.id],
                              )
                            }
                          >
                            <ChevronRight
                              size={13}
                              style={{
                                transform: expanded.includes(child.id)
                                  ? 'rotate(90deg)'
                                  : undefined,
                              }}
                            />
                          </button>
                          <SortableTaskName>
                            <EditableText
                              activation="doubleClick"
                              value={child.title}
                              label={`Título: ${child.title}`}
                              onSave={(title) => void onPatch(child.id, { title })}
                            />
                          </SortableTaskName>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="subitem-row-menu"
                                aria-label={`Opções do subitem ${child.title}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={() => onOpenTask(child.id)}>
                                  <ArrowUpRight />
                                  Abrir detalhes
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => onDelete([child.id])}
                                >
                                  <Trash2 />
                                  Excluir subitem
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                      <td className="subitem-comments-cell">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="subitem-comments-button"
                          aria-label={`Abrir atualizações de ${child.title}`}
                          title={
                            commentCount
                              ? `${commentCount} ${commentCount === 1 ? 'comentário' : 'comentários'}`
                              : 'Adicionar comentário'
                          }
                          onClick={() => onOpenTask(child.id, 'updates')}
                        >
                          <MessageSquare />
                          {commentCount > 0 && <small>{commentCount}</small>}
                        </Button>
                      </td>
                      {visibleColumns.map((c) => (
                        <td key={c.key} className={`subitem-field-cell subitem-${c.key}-cell`}>
                          {field(child, c.key)}
                        </td>
                      ))}
                      <td className="subitem-add-column" />
                    </tr>
                    {expanded.includes(child.id) && (
                      <tr className="nested-subitems-row">
                        <td colSpan={visibleColumns.length + 4}>
                          <SubitemsPanel
                            revealIds={revealIds}
                            parent={child}
                            data={data}
                            onPatch={onPatch}
                            onRefresh={onRefresh}
                            onOpenTask={onOpenTask}
                            onDelete={onDelete}
                            onMoveTask={onMoveTask}
                            statusOptions={statusOptions}
                            priorityOptions={priorityOptions}
                            onOpenEditLabels={onOpenEditLabels}
                          />
                        </td>
                      </tr>
                    )}
                  </SortableTaskRows>
                )
              })}
              <tfoot>
                <tr>
                  <td className="subitem-check-cell" />
                  <td colSpan={visibleColumns.length + 3} className="subitem-add-cell">
                    <form
                      className="subitem-create"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void add()
                      }}
                    >
                      <Plus size={14} aria-hidden="true" />
                      <label className="sr-only" htmlFor={id}>
                        Nome do novo subitem
                      </label>
                      <Input
                        ref={input}
                        id={id}
                        placeholder="Adicionar subitem…"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={300}
                        required
                        disabled={busy}
                      />
                      {(title.trim() || busy) && (
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={busy || !title.trim()}
                        >
                          {busy ? <LoaderCircle className="spin" /> : <Plus />}Adicionar subitem
                        </Button>
                      )}
                    </form>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </TaskSorting>
      {editingSystemLabels && board && (
        <EditLabelsDialog
          type={editingSystemLabels}
          currentLabels={(editingSystemLabels === 'status' ? statusOptions : priorityOptions) || []}
          onClose={() => setEditingSystemLabels(null)}
          onSave={async (type, labels) => {
            await api(`/boards/${board.id}`, {
              method: 'PATCH',
              body: json({
                settings: {
                  [type === 'status' ? 'subitemStatusOptions' : 'subitemPriorityOptions']: labels,
                },
              }),
            })
            await onRefresh()
            setEditingSystemLabels(null)
          }}
        />
      )}
      {board && (editingColumn || creatingType) && (
        <ColumnEditor
          key={editingColumn?.id || creatingType!}
          board={board}
          column={editingColumn || undefined}
          initialType={creatingType || undefined}
          scope="subitems"
          onClose={() => {
            setEditingColumn(null)
            setCreatingType(null)
          }}
          onRefresh={onRefresh}
          onEditLabels={onOpenEditLabels}
        />
      )}
      {columnOrder.error && (
        <p className="form-error" role="alert">
          {columnOrder.error}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  )
}
