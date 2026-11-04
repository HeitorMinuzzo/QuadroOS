import { memo, useCallback, useDeferredValue, useMemo, useState, useEffect, useRef } from 'react'
import {
  Plus,
  Search,
  SlidersHorizontal,
  ArrowDownUp,
  Columns3,
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Flag,
  Check,
  ListTodo,
  ChartNoAxesCombined,
  Download,
  Upload,
  Star,
  CircleCheck,
  CircleDashed,
  X,
  Trash2,
  Circle,
  Rows3,
  Users,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Bot,
} from 'lucide-react'
import {
  type Workspace,
  type Board,
  type Task,
  type Status,
  type Priority,
  type Group,
  type CustomColumn,
  type ColumnType,
  isOverdue,
  isTaskDone,
  localDate,
  statusClass,
  priorityClass,
  taskOwnerIds,
  taskAncestorIds,
  type TaskPanelTab,
  taskUpdateCounts,
} from '../../shared/domain'
import { Avatar, EmptyState, IconButton, PillSelect, ChoiceBadge } from './ui'
import { BoardIcon } from './Sidebar'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import { BoardTaskRow } from './BoardTaskRow'
import { EditGroupDialog } from './EditGroupDialog'
import { EditLabelsDialog } from './EditLabelsDialog'
import {
  type LabelOption,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
} from '../../shared/domain'
import { api, json } from '../api'
import { accentInk, accentInkOnDark } from '../lib/color'
import { TaskSorting, type MoveTask } from './TaskSorting'
import {
  GroupSorting,
  SortableGroup,
  GroupDragSurface,
  GroupDragHandle,
  type MoveGroup,
} from './GroupSorting'
import { GroupName } from './GroupName'
import { ColumnResizeHandle, useColumnWidths } from './ColumnResizing'
import { TaskCustomCell } from './TaskCustomCell'
import { AssigneePicker, AssigneeAvatars } from './AssigneePicker'
import { DatePicker } from './DatePicker'
import { ColumnHeading, useColumnOrder } from './ColumnOrdering'
import { boardColumns } from '../../shared/columns'
import { AddColumnMenu, ColumnEditor, COLUMN_ICONS } from './ColumnEditor'
import { AutomationsPanel } from './AutomationsPanel'
import { FieldSelect } from './FieldSelect'
import { GroupColumnSummary } from './GroupColumnSummary'
import { taskDescendantCounts } from '../../shared/group-summary'
import { BoardCalendar } from './BoardCalendar'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'

export type BoardTab = 'table' | 'kanban' | 'calendar' | 'overview' | 'automations'
const columns = [
  { key: 'owner', label: 'Responsável' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Prioridade' },
  { key: 'date', label: 'Prazo' },
]
function displayDate(value: string | null) {
  return value
    ? new Date(`${value}T12:00:00`)
        .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
        .replace('.', '')
    : 'Sem prazo'
}
function BoardViewContent({
  data,
  board,
  tab,
  setTab,
  onlyMine,
  onClearMine,
  onNewTask,
  onNewGroup,
  onNewColumn,
  onImport,
  onOpenTask,
  onPatch,
  onDelete,
  onFavorite,
  onRefresh,
  onMoveTask,
  onMoveGroup,
  onResizeColumns,
}: {
  data: Workspace
  board: Board
  tab: BoardTab
  setTab: (tab: BoardTab) => void
  onlyMine: boolean
  onClearMine: () => void
  onNewTask: (groupId?: string, status?: Status) => void
  onNewGroup: () => void
  onNewColumn: () => void
  onImport: () => void
  onOpenTask: (id: string, tab?: TaskPanelTab) => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
  onDelete: (ids: string[]) => void
  onFavorite: () => void
  onRefresh: () => Promise<void>
  onMoveTask: MoveTask
  onMoveGroup: MoveGroup
  onResizeColumns: (boardId: string, widths: Record<string, number>) => Promise<boolean>
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState('manual')
  const [groupBy, setGroupBy] = useState('group')
  const [hidden, setHidden] = useState<string[] | null>(null)
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [columnError, setColumnError] = useState('')
  const [editingColumn, setEditingColumn] = useState<CustomColumn | null>(null)
  const [creatingType, setCreatingType] = useState<ColumnType | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const groupToggleFocus = useRef<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [compactTable, setCompactTable] = useState(
    () => window.matchMedia('(max-width: 760px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const sync = () => setCompactTable(media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  const [expanded, setExpanded] = useState<string[]>([])
  const updateCounts = useMemo(() => taskUpdateCounts(data.comments), [data.comments])
  const subitemCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of data.tasks)
      if (task.parentId) counts.set(task.parentId, (counts.get(task.parentId) || 0) + 1)
    return counts
  }, [data.tasks])
  const descendantCounts = useMemo(() => taskDescendantCounts(data.tasks), [data.tasks])
  const previousGroups = useRef(new Map<string, string>())
  const [editingGroup, setEditingGroup] = useState<Group | null>(null)
  const [editingLabels, setEditingLabels] = useState<'status' | 'priority' | null>(null)
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)

  const statusOptions = useMemo(
    () =>
      board.settings?.statusOptions && board.settings.statusOptions.length
        ? board.settings.statusOptions
        : DEFAULT_STATUS_OPTIONS,
    [board.settings?.statusOptions],
  )
  const priorityOptions = useMemo(
    () =>
      board.settings?.priorityOptions && board.settings.priorityOptions.length
        ? board.settings.priorityOptions
        : DEFAULT_PRIORITY_OPTIONS,
    [board.settings?.priorityOptions],
  )

  async function handleSaveLabels(type: 'status' | 'priority', updatedLabels: LabelOption[]) {
    const nextSettings = {
      [type === 'status' ? 'statusOptions' : 'priorityOptions']: updatedLabels,
    }
    await api(`/boards/${board.id}`, {
      method: 'PATCH',
      body: json({ settings: nextSettings }),
    })
    await onRefresh()
  }

  const [quickTitles, setQuickTitles] = useState<Record<string, string>>({})
  const [quickSaving, setQuickSaving] = useState<string | null>(null)
  const [quickError, setQuickError] = useState<{ groupId: string; message: string } | null>(null)

  async function handleQuickAdd(groupId: string) {
    const title = (quickTitles[groupId] || '').trim()
    if (!title || quickSaving) return
    setQuickSaving(groupId)
    setQuickError(null)
    try {
      await api<Task>('/tasks', {
        method: 'POST',
        body: json({
          boardId: board.id,
          groupId,
          title,
          status: board.settings?.monday ? '' : 'Não iniciado',
        }),
      })
      await onRefresh()
      setQuickTitles((prev) => ({ ...prev, [groupId]: '' }))
    } catch (e) {
      setQuickError({
        groupId,
        message: e instanceof Error ? e.message : 'Não foi possível criar o item.',
      })
    } finally {
      setQuickSaving(null)
    }
  }

  useEffect(() => {
    setSelected([])
    setSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setOwnerFilter('all')
    setHidden(null)
    setCollapsed([])
    setExpanded([])
  }, [board.id])
  const allTasks = useMemo(
    () => data.tasks.filter((t) => t.boardId === board.id && !t.parentId),
    [data.tasks, board.id],
  )
  useEffect(() => {
    const moved = allTasks.filter(
      (t) => previousGroups.current.has(t.id) && previousGroups.current.get(t.id) !== t.groupId,
    )
    if (moved.length)
      setCollapsed((prev) =>
        prev.filter((id) => !moved.some((t) => t.groupId === id || t.status === id)),
      )
    previousGroups.current = new Map(allTasks.map((t) => [t.id, t.groupId]))
  }, [allTasks])
  useEffect(() => {
    if (
      !deferredSearch &&
      !onlyMine &&
      statusFilter === 'all' &&
      priorityFilter === 'all' &&
      ownerFilter === 'all'
    )
      return
    const parents = data.tasks.filter(
      (t) =>
        t.boardId === board.id &&
        t.parentId &&
        (!deferredSearch ||
          `${t.title} ${t.description}`
            .toLocaleLowerCase('pt-BR')
            .includes(deferredSearch.toLocaleLowerCase('pt-BR'))) &&
        (!onlyMine || taskOwnerIds(t).includes('person-you')) &&
        (statusFilter === 'all' || t.status === statusFilter) &&
        (priorityFilter === 'all' || t.priority === priorityFilter) &&
        (ownerFilter === 'all' ||
          (ownerFilter === 'none'
            ? !taskOwnerIds(t).length
            : taskOwnerIds(t).includes(ownerFilter))),
    )
    const ancestors = taskAncestorIds(
      data.tasks,
      parents.map((task) => task.id),
    )
    setExpanded((previous) =>
      ancestors.every((id) => previous.includes(id))
        ? previous
        : [...new Set([...previous, ...ancestors])],
    )
  }, [deferredSearch, onlyMine, statusFilter, priorityFilter, ownerFilter, data.tasks, board.id])
  const tasks = useMemo(() => {
    const matches = (t: Task) =>
      (!onlyMine || taskOwnerIds(t).includes('person-you')) &&
      (!deferredSearch ||
        `${t.title} ${t.description}`
          .toLocaleLowerCase('pt-BR')
          .includes(deferredSearch.toLocaleLowerCase('pt-BR'))) &&
      (statusFilter === 'all' || t.status === statusFilter) &&
      (priorityFilter === 'all' || t.priority === priorityFilter) &&
      (ownerFilter === 'all' ||
        (ownerFilter === 'none' ? !taskOwnerIds(t).length : taskOwnerIds(t).includes(ownerFilter)))
    const ancestors = new Set(
      taskAncestorIds(
        data.tasks,
        data.tasks
          .filter((task) => task.boardId === board.id && matches(task))
          .map((task) => task.id),
      ),
    )
    const visible = allTasks.filter((task) => matches(task) || ancestors.has(task.id))
    return visible.sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'pt-BR')
        : sort === 'due'
          ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
          : sort === 'priority'
            ? priorityOptions.findIndex((p) => p.label === a.priority) -
              priorityOptions.findIndex((p) => p.label === b.priority)
            : a.position - b.position,
    )
  }, [
    allTasks,
    data.tasks,
    onlyMine,
    deferredSearch,
    statusFilter,
    priorityFilter,
    ownerFilter,
    sort,
    priorityOptions,
  ])
  const completed = allTasks.filter((t) => isTaskDone(t, board)).length
  const ongoing = allTasks.filter(
    (t) => t.status === 'Em andamento' || t.status === 'Contínuo',
  ).length
  const overdue = allTasks.filter((task) => isOverdue(task, board)).length
  const progress = allTasks.length ? Math.round((completed / allTasks.length) * 100) : 0
  const filterCount =
    [statusFilter, priorityFilter, ownerFilter].filter((f) => f !== 'all').length + Number(onlyMine)
  const groups =
    groupBy === 'status'
      ? statusOptions.map((option) => ({
          id: option.label,
          name: option.label,
          color: option.color,
          isCompleted: option.isDone ?? option.label === 'Feito',
        }))
      : data.groups.filter((g) => g.boardId === board.id).sort((a, b) => a.position - b.position)
  const visibleColumn = useCallback(
    (key: string) => !(hidden ?? board.settings?.hiddenColumns ?? []).includes(key),
    [hidden, board.settings?.hiddenColumns],
  )
  const columnOrder = useColumnOrder(board, 'tasks', onRefresh)
  const definitions = useMemo(() => boardColumns(board), [board])
  const cellWorkspace = useMemo(
    () => ({ tasks: data.tasks, boards: data.boards }),
    [data.tasks, data.boards],
  )
  const allColumns = useMemo(
    () => definitions.map((c) => ({ key: c.id, label: c.name })),
    [definitions],
  )
  const orderedColumns = useMemo(
    () =>
      columnOrder.keys.filter(visibleColumn).map((key) => allColumns.find((c) => c.key === key)!),
    [columnOrder.keys, visibleColumn, allColumns],
  )
  const layoutKeys = ['title', ...orderedColumns.map((c) => c.key)]
  const columnClass = (key: string) =>
    columns.some((c) => c.key === key) ? `${key}-cell` : 'custom-cell'
  const columnIcons: Record<string, typeof Users> = {
    owner: Users,
    status: Circle,
    priority: Flag,
    date: CalendarDays,
  }
  const columnWidths = useColumnWidths(board, layoutKeys, tab === 'table', onResizeColumns)
  const resizeHandle = (key: string, label: string) =>
    !compactTable && (
      <ColumnResizeHandle
        columnKey={key}
        label={label}
        widths={columnWidths.widths}
        onPreview={columnWidths.preview}
        onSave={columnWidths.save}
      />
    )
  async function toggleColumn(key: string) {
    if (visibilitySaving) return
    const next = [...(hidden ?? board.settings?.hiddenColumns ?? [])]
    const hide = !next.includes(key)
    setHidden(hide ? [...next, key] : next.filter((id) => id !== key))
    setVisibilitySaving(true)
    setColumnError('')
    try {
      await api(`/boards/${board.id}/columns/${key}`, {
        method: 'PATCH',
        body: json({ hidden: hide, scope: 'tasks' }),
      })
      await onRefresh()
    } catch (e) {
      setColumnError(e instanceof Error ? e.message : 'Não foi possível alterar a coluna.')
    } finally {
      setHidden(null)
      setVisibilitySaving(false)
    }
  }
  const toggleSelection = useCallback(
    (ids: string[], checked: boolean) =>
      setSelected((prev) =>
        checked ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.includes(id)),
      ),
    [],
  )
  const toggleTaskSelection = useCallback(
    (id: string, checked: boolean) => toggleSelection([id], checked),
    [toggleSelection],
  )
  const toggleExpanded = useCallback(
    (id: string) =>
      setExpanded((previous) =>
        previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id],
      ),
    [],
  )
  const field = useCallback(
    (task: Task, key: string) => {
      if (key === 'owner')
        return (
          <AssigneePicker
            people={data.people}
            value={taskOwnerIds(task)}
            label={`Responsável: ${task.title}`}
            onChange={(ownerIds) => onPatch(task.id, { ownerIds })}
          />
        )
      if (key === 'status' || key === 'priority')
        return (
          <PillSelect
            kind={key === 'status' ? 'status' : 'priority'}
            allowClear={!!board.settings?.monday}
            placeholder={board.settings?.monday ? 'Selecionar…' : undefined}
            value={key === 'status' ? task.status : task.priority}
            customOptions={key === 'status' ? statusOptions : priorityOptions}
            onOpenEditLabels={() => setEditingLabels(key)}
            label={`${key === 'status' ? 'Status' : 'Prioridade'}: ${task.title}`}
            className={
              key === 'status'
                ? statusClass(task.status)
                : `priority ${priorityClass(task.priority)}`
            }
            onChange={(value) =>
              void onPatch(
                task.id,
                key === 'status' ? { status: value as Status } : { priority: value as Priority },
              )
            }
          />
        )
      if (key === 'date')
        return (
          <DatePicker
            value={task.dueAt ? localDate(new Date(task.dueAt)) : task.dueDate}
            dateTime={task.dueAt}
            onChangeDateTime={(dueDate, dueAt) => onPatch(task.id, { dueDate, dueAt })}
            label={`Prazo: ${task.title}`}
            overdue={isOverdue(task, board)}
            onChange={(dueDate) => onPatch(task.id, { dueDate })}
          />
        )
      const column = board.columns.find((c) => c.id === key)
      return column ? (
        <TaskCustomCell
          workspace={cellWorkspace}
          onOpenTask={onOpenTask}
          board={board}
          attachments={data.attachments}
          onRefresh={onRefresh}
          task={task}
          column={column}
          people={data.people}
          onPatch={onPatch}
          onEditColumn={() => setEditingColumn(column)}
        />
      ) : null
    },
    [
      board,
      data.people,
      data.attachments,
      cellWorkspace,
      statusOptions,
      priorityOptions,
      onPatch,
      onRefresh,
      onOpenTask,
    ],
  )
  function summary(key: string, groupTasks: Task[], overview = false) {
    const column = definitions.find((c) => c.id === key)
    return column ? (
      <GroupColumnSummary
        column={
          key === 'status'
            ? { ...column, options: statusOptions }
            : key === 'priority'
              ? { ...column, options: priorityOptions }
              : column
        }
        tasks={groupTasks}
        board={board}
        people={data.people}
        attachments={data.attachments}
        overview={overview}
      />
    ) : null
  }
  const reset = () => {
    setSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setOwnerFilter('all')
    onClearMine()
  }
  const boardPeople = data.people.filter((p) =>
    allTasks.some((t) => taskOwnerIds(t).includes(p.id)),
  )
  async function bulkStatus(status: string) {
    setSaving(true)
    for (const id of selected) if (!(await onPatch(id, { status: status as Status }))) break
    setSelected([])
    setSaving(false)
  }
  return (
    <>
      <section className="board-heading">
        <div className="board-heading-copy">
          <div className="board-title-row">
            <span className="board-title-icon" style={{ color: board.color }}>
              <BoardIcon icon={board.icon} size={25} />
            </span>
            <h1>{board.name}</h1>
            <button
              className={`favorite-button ${board.favorite ? 'is-favorite' : ''}`}
              aria-label={board.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              aria-pressed={board.favorite}
              onClick={onFavorite}
            >
              <Star size={19} />
            </button>
          </div>
          <p>{board.description || 'Ideias organizadas. Próximos passos mais claros.'}</p>
        </div>
        <div className="board-heading-actions">
          <div
            className="team-members"
            role="group"
            aria-label={`${boardPeople.length} pessoa${boardPeople.length === 1 ? '' : 's'} neste quadro`}
          >
            {boardPeople.slice(0, 4).map((person) => (
              <Avatar key={person.id} person={person} small />
            ))}
            {boardPeople.length > 4 && (
              <span className="avatar small extra">+{boardPeople.length - 4}</span>
            )}
          </div>
          <button className="button secondary" onClick={onImport}>
            <Upload size={16} />
            Importar
          </button>
          <Button
            variant="outline"
            onClick={() => setTab('automations')}
            aria-pressed={tab === 'automations'}
          >
            <Bot />
            Automação
          </Button>
          {tab === 'overview' && (
            <Button onClick={() => onNewTask()}>
              <Plus />
              Novo item
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mais opções do quadro">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onNewGroup}>
                <Rows3 />
                Adicionar grupo
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNewColumn}>
                <Columns3 />
                Adicionar coluna
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onImport}>
                <Upload />
                Importar dados
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/boards/${board.id}/export`} download>
                  <Download />
                  Exportar CSV
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
      <div className="board-tabs-row">
        <div className="board-tabs view-tabs" role="tablist" aria-label="Visualização do quadro">
          {(
            [
              { id: 'table', label: 'Tabela principal', icon: Rows3 },
              { id: 'kanban', label: 'Kanban', icon: Columns3 },
              { id: 'overview', label: 'Visão geral', icon: ChartNoAxesCombined },
              { id: 'calendar', label: 'Calendário', icon: CalendarDays },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
              {label}
              {id === 'table' && <span>{allTasks.length}</span>}
            </button>
          ))}
        </div>
        <Button
          className="mobile-automation"
          variant="ghost"
          size="icon-sm"
          aria-label="Automação"
          title="Automação"
          aria-pressed={tab === 'automations'}
          onClick={() => setTab('automations')}
        >
          <Bot />
        </Button>
        <span className="board-scope">
          <span className="board-completion-track">
            <i style={{ width: `${progress}%` }} />
          </span>
          <strong>{completed}</strong> de {allTasks.length} concluídos
        </span>
      </div>
      {tab === 'overview' && (
        <section className="board-pulse" aria-label="Resumo do quadro">
          <div className="pulse-item">
            <span className="stat-icon neutral">
              <ListTodo size={19} />
            </span>
            <div>
              <span>Total de tarefas</span>
              <strong>
                {String(allTasks.length).padStart(2, '0')}
                <small>no quadro</small>
              </strong>
            </div>
          </div>
          <div className="pulse-item">
            <span className="stat-icon blue">
              <CircleDashed size={19} />
            </span>
            <div>
              <span>Em movimento</span>
              <strong>
                {String(ongoing).padStart(2, '0')}
                <small>em andamento ou contínuas</small>
              </strong>
            </div>
          </div>
          <div className="pulse-item">
            <span className="stat-icon green">
              <CircleCheck size={19} />
            </span>
            <div>
              <span>Entregas concluídas</span>
              <strong>
                {String(completed).padStart(2, '0')}
                <small>bom trabalho!</small>
              </strong>
            </div>
          </div>
          <div className="pulse-progress">
            <div>
              <span>Progresso do quadro</span>
              <strong>{progress}%</strong>
            </div>
            <div className="progress-track">
              <i style={{ width: `${progress}%` }} />
            </div>
            <span>
              {completed} de {allTasks.length} tarefas concluídas
            </span>
          </div>
        </section>
      )}
      {tab === 'automations' && (
        <AutomationsPanel
          key={board.id}
          board={board}
          groups={data.groups.filter((g) => g.boardId === board.id)}
        />
      )}
      {(tab === 'table' || tab === 'kanban' || tab === 'calendar') && (
        <>
          <div className="board-toolbar">
            <div className="create-item-control" role="group" aria-label="Criação de itens">
              <Button className="create-item-button" onClick={() => onNewTask()}>
                <Plus />
                Novo item
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="create-item-more" aria-label="Mais opções de criação">
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => onNewTask()}>
                    <Plus />
                    Nova tarefa
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onNewGroup}>
                    <Rows3 />
                    Novo grupo
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onNewColumn}>
                    <Columns3 />
                    Nova coluna
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <label className="board-search">
              <Search size={16} />
              <input
                id="board-search"
                aria-label="Buscar neste quadro"
                placeholder="Pesquisar"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <IconButton label="Limpar busca" onClick={() => setSearch('')}>
                  <X size={14} />
                </IconButton>
              )}
            </label>
            <div className="toolbar-controls">
              <button
                className={`button toolbar-button ${showFilters || filterCount ? 'is-active' : ''}`}
                aria-expanded={showFilters}
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal size={15} />
                Filtrar{filterCount > 0 && <span className="filter-count">{filterCount}</span>}
              </button>
              <label className="toolbar-select">
                <ArrowDownUp size={15} />
                <FieldSelect
                  label="Ordenar tarefas"
                  value={sort}
                  onChange={setSort}
                  variant="toolbar"
                  options={[
                    { value: 'manual', label: 'Ordem manual' },
                    { value: 'title', label: 'Título: A–Z' },
                    { value: 'due', label: 'Prazo mais próximo' },
                    { value: 'priority', label: 'Maior prioridade' },
                  ]}
                />
              </label>
              {tab === 'table' && (
                <>
                  <span className="toolbar-divider" />
                  <label className="toolbar-select grouping-select">
                    <LayersIcon />
                    <FieldSelect
                      label="Agrupar tarefas"
                      value={groupBy}
                      onChange={setGroupBy}
                      variant="toolbar"
                      options={[
                        { value: 'group', label: 'Por grupo' },
                        { value: 'status', label: 'Por status' },
                      ]}
                    />
                  </label>
                  <Popover open={columnMenuOpen} onOpenChange={setColumnMenuOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" className="columns-trigger" aria-label="Colunas">
                        <Columns3 size={15} />
                        <span>Colunas</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      sideOffset={8}
                      className="columns-popover"
                      aria-label="Visibilidade das colunas"
                    >
                      <div className="picker-heading">
                        <Columns3 size={16} />
                        <strong>Mostrar colunas</strong>
                        <span>{allColumns.filter((c) => visibleColumn(c.key)).length}</span>
                      </div>
                      <p className="picker-description">Escolha o que aparece no quadro.</p>
                      <div className="column-visibility-options">
                        {allColumns.map((column) => (
                          <label key={column.key}>
                            <input
                              type="checkbox"
                              checked={visibleColumn(column.key)}
                              disabled={visibilitySaving}
                              onChange={() => void toggleColumn(column.key)}
                            />
                            {column.label}
                          </label>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        className="column-visibility-add"
                        onClick={() => {
                          setColumnMenuOpen(false)
                          onNewColumn()
                        }}
                      >
                        <Plus size={15} />
                        Adicionar coluna
                      </Button>
                    </PopoverContent>
                  </Popover>
                </>
              )}
              <a
                className="icon-button export-button"
                href={`/api/boards/${board.id}/export`}
                download
                aria-label="Exportar quadro em CSV"
                title="Exportar CSV"
              >
                <Download size={16} />
              </a>
            </div>
          </div>
          {(showFilters || onlyMine) && (
            <div className="filter-panel">
              {onlyMine && (
                <button className="filter-chip" onClick={onClearMine}>
                  Minhas tarefas
                  <X size={13} />
                </button>
              )}
              <label>
                Status
                <FieldSelect
                  label="Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'all', label: 'Todos os status' },
                    ...statusOptions.map((s) => ({
                      value: s.label,
                      label: s.label,
                      color: s.color,
                    })),
                  ]}
                />
              </label>
              <label>
                Prioridade
                <FieldSelect
                  label="Prioridade"
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  options={[
                    { value: 'all', label: 'Todas as prioridades' },
                    ...priorityOptions.map((p) => ({
                      value: p.label,
                      label: p.label,
                      color: p.color,
                    })),
                  ]}
                />
              </label>
              <label>
                Responsável
                <FieldSelect
                  label="Responsável"
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  options={[
                    { value: 'all', label: 'Todas as pessoas' },
                    { value: 'none', label: 'Sem responsável' },
                    ...data.people.map((p) => ({ value: p.id, label: p.name, color: p.color })),
                  ]}
                />
              </label>
              {filterCount > 0 && (
                <button className="text-button" onClick={reset}>
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </>
      )}
      {selected.length > 0 && tab === 'table' && (
        <div className="selection-bar">
          <span>
            <Check size={16} />
            {selected.length} selecionada{selected.length > 1 ? 's' : ''}
          </span>
          <FieldSelect
            label="Alterar status das tarefas selecionadas"
            value=""
            placeholder="Alterar status"
            disabled={saving}
            onChange={(value) => void bulkStatus(value)}
            options={statusOptions.map((s) => ({ value: s.label, label: s.label, color: s.color }))}
          />
          <button
            className="text-button danger"
            onClick={() => onDelete(selected)}
            disabled={saving}
          >
            <Trash2 size={15} />
            Excluir
          </button>
          <IconButton label="Limpar seleção" onClick={() => setSelected([])}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {tab === 'table' && (
        <div className="table-view" ref={columnWidths.ref} aria-busy={search !== deferredSearch}>
          {columnError && (
            <p className="form-error" role="alert">
              {columnError}
            </p>
          )}
          {columnOrder.error && (
            <p className="form-error" role="alert">
              {columnOrder.error}
            </p>
          )}
          {tasks.length === 0 && (search || filterCount > 0) ? (
            <EmptyState
              icon={<ListFilter size={28} />}
              title="Nenhuma tarefa por aqui."
              description="Experimente outra busca ou ajuste os filtros."
              action={
                <button className="button secondary" onClick={reset}>
                  Limpar busca e filtros
                </button>
              }
            />
          ) : (
            <GroupSorting
              key={`${board.id}:${groupBy}`}
              groups={groups}
              enabled={groupBy === 'group'}
              onMove={onMoveGroup}
            >
              {(orderedGroups) =>
                orderedGroups.map((group) => {
                  const groupTasks = tasks.filter((t) =>
                    groupBy === 'status' ? t.status === group.id : t.groupId === group.id,
                  )
                  const groupDone = groupTasks.filter((t) => isTaskDone(t, board)).length
                  const isCollapsed = collapsed.includes(group.id)
                  const allSelected =
                    groupTasks.length > 0 && groupTasks.every((t) => selected.includes(t.id))
                  if (!groupTasks.length && (search || filterCount > 0)) return null
                  const groupSubitems = groupTasks.reduce(
                    (sum, task) => sum + (descendantCounts.get(task.id) || 0),
                    0,
                  )
                  const heading = (
                    <header
                      className={`group-heading ${isCollapsed ? 'collapsed-group-heading' : ''}`}
                    >
                      <GroupDragSurface>
                        <button
                          className="group-toggle"
                          ref={(element) => {
                            if (element && groupToggleFocus.current === group.id) {
                              element.focus({ preventScroll: true })
                              groupToggleFocus.current = null
                            }
                          }}
                          onClick={() => {
                            groupToggleFocus.current = group.id
                            setCollapsed((prev) =>
                              isCollapsed
                                ? prev.filter((id) => id !== group.id)
                                : [...prev, group.id],
                            )
                          }}
                          aria-label={`${isCollapsed ? 'Expandir' : 'Recolher'} grupo ${group.name}`}
                          aria-expanded={!isCollapsed}
                        >
                          {isCollapsed ? (
                            <ChevronRight size={17} style={{ color: group.color }} />
                          ) : (
                            <ChevronDown size={17} style={{ color: group.color }} />
                          )}
                        </button>
                        <div className="group-heading-copy">
                          <h2
                            aria-label={group.name}
                            className="group-heading-title"
                            style={
                              {
                                '--group-ink': accentInk(group.color),
                                '--group-ink-dark': accentInkOnDark(group.color),
                              } as React.CSSProperties
                            }
                          >
                            <GroupName
                              id={group.id}
                              name={group.name}
                              editable={groupBy === 'group'}
                              onRefresh={onRefresh}
                            />
                          </h2>
                          <span className="group-count">
                            {isCollapsed
                              ? `${groupTasks.length} ${groupTasks.length === 1 ? 'Tarefa' : 'Tarefas'} / ${groupSubitems} ${groupSubitems === 1 ? 'Subitem' : 'Subitens'}`
                              : `${groupTasks.length} ${groupTasks.length === 1 ? 'item' : 'itens'}`}
                          </span>
                        </div>
                      </GroupDragSurface>
                      <div className="group-heading-meta">
                        {isCollapsed && <GroupDragHandle name={group.name} />}
                        {!isCollapsed && (
                          <span>
                            {groupDone}/{groupTasks.length} concluídas
                          </span>
                        )}
                        {!isCollapsed && (
                          <span className="mini-progress">
                            <i
                              style={{
                                width: `${groupTasks.length ? (groupDone / groupTasks.length) * 100 : 0}%`,
                              }}
                            />
                          </span>
                        )}
                        {groupBy === 'group' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                id={`group-menu-${group.id}`}
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Opções do grupo ${group.name}`}
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() =>
                                  setEditingGroup(data.groups.find((g) => g.id === group.id)!)
                                }
                              >
                                <Pencil />
                                Editar grupo
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {groupBy === 'group' && (
                          <IconButton
                            label={`Adicionar tarefa em ${group.name}`}
                            onClick={() => onNewTask(group.id)}
                          >
                            <Plus size={17} />
                          </IconButton>
                        )}
                      </div>
                    </header>
                  )
                  return (
                    <SortableGroup key={group.id} group={group} collapsed={isCollapsed}>
                      {isCollapsed ? (
                        <div className="group-table-wrap collapsed-group-wrap">
                          <table
                            className={`task-table group-overview-table ${compactTable ? '' : 'resizable-table'}`}
                            style={
                              compactTable
                                ? undefined
                                : { width: '100%', minWidth: columnWidths.total }
                            }
                          >
                            <caption className="sr-only">Resumo do grupo: {group.name}</caption>
                            {compactTable ? (
                              <colgroup>
                                <col />
                                {orderedColumns.some((column) => column.key === 'status') && (
                                  <col style={{ width: 108 }} />
                                )}
                                <col style={{ width: 25 }} />
                              </colgroup>
                            ) : (
                              <colgroup>
                                <col style={{ width: 36 }} />
                                {layoutKeys.map((key) => (
                                  <col key={key} style={{ width: columnWidths.widths[key] }} />
                                ))}
                                <col />
                              </colgroup>
                            )}
                            <tbody>
                              <tr>
                                <td
                                  colSpan={compactTable ? 1 : 2}
                                  className="title-cell group-overview-title"
                                >
                                  {heading}
                                </td>
                                {orderedColumns
                                  .filter((column) => !compactTable || column.key === 'status')
                                  .map((column) => (
                                    <td
                                      key={column.key}
                                      className={`group-overview-cell ${columnClass(column.key)}`}
                                      data-column-key={column.key}
                                      aria-label={`Resumo de ${column.label}`}
                                    >
                                      <span className="group-overview-label">{column.label}</span>
                                      <div className="group-overview-value">
                                        {summary(column.key, groupTasks, true)}
                                      </div>
                                    </td>
                                  ))}
                                <td className="detail-cell" />
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        heading
                      )}
                      {!isCollapsed && (
                        <TaskSorting
                          tasks={groupTasks}
                          onMove={onMoveTask}
                          disabled={sort !== 'manual' || groupBy !== 'group'}
                        >
                          {(orderedTasks) => (
                            <div className="group-table-wrap">
                              <table
                                className={`task-table ${compactTable ? '' : 'resizable-table'}`}
                                style={
                                  compactTable
                                    ? undefined
                                    : { width: '100%', minWidth: columnWidths.total }
                                }
                              >
                                <caption className="sr-only">Tarefas: {group.name}</caption>
                                {!compactTable && (
                                  <colgroup>
                                    <col style={{ width: 36 }} />
                                    {layoutKeys.map((key) => (
                                      <col key={key} style={{ width: columnWidths.widths[key] }} />
                                    ))}
                                    <col />
                                  </colgroup>
                                )}
                                <thead>
                                  <tr>
                                    <th className="check-cell">
                                      <label className="checkbox-target">
                                        <input
                                          type="checkbox"
                                          aria-label={`Selecionar tarefas de ${group.name}`}
                                          checked={allSelected}
                                          onChange={(e) =>
                                            toggleSelection(
                                              groupTasks.map((t) => t.id),
                                              e.target.checked,
                                            )
                                          }
                                        />
                                      </label>
                                    </th>
                                    <th className="title-cell">
                                      {board.settings?.columnNames?.title || 'Tarefa'}
                                      {resizeHandle(
                                        'title',
                                        board.settings?.columnNames?.title || 'Tarefa',
                                      )}
                                    </th>
                                    {orderedColumns.map((column) => {
                                      const Icon =
                                        columnIcons[column.key] ||
                                        COLUMN_ICONS[
                                          definitions.find((c) => c.id === column.key)!.type
                                        ]
                                      return (
                                        <ColumnHeading
                                          key={column.key}
                                          columnKey={column.key}
                                          label={column.label}
                                          className={columnClass(column.key)}
                                          icon={Icon ? <Icon size={13} /> : undefined}
                                          onEdit={() =>
                                            setEditingColumn(
                                              definitions.find((c) => c.id === column.key)!,
                                            )
                                          }
                                          order={columnOrder}
                                          visibleKeys={orderedColumns.map((c) => c.key)}
                                        >
                                          {resizeHandle(column.key, column.label)}
                                        </ColumnHeading>
                                      )
                                    })}
                                    <th className="detail-cell">
                                      <AddColumnMenu
                                        label={`Adicionar coluna em ${group.name}`}
                                        onSelect={setCreatingType}
                                      />
                                    </th>
                                  </tr>
                                </thead>
                                {orderedTasks.map((task) => (
                                  <BoardTaskRow
                                    key={task.id}
                                    task={task}
                                    board={board}
                                    data={expanded.includes(task.id) ? data : undefined}
                                    selected={selected.includes(task.id)}
                                    expanded={expanded.includes(task.id)}
                                    revealIds={expanded.includes(task.id) ? expanded : undefined}
                                    childCount={subitemCounts.get(task.id) || 0}
                                    updateCount={updateCounts.get(task.id) || 0}
                                    subitemsColSpan={
                                      compactTable
                                        ? 3 + Number(visibleColumn('status'))
                                        : orderedColumns.length + 3
                                    }
                                    orderedColumns={orderedColumns}
                                    statusOptions={statusOptions}
                                    priorityOptions={priorityOptions}
                                    renderField={field}
                                    onToggleSelected={toggleTaskSelection}
                                    onToggleExpanded={toggleExpanded}
                                    onOpenEditLabels={setEditingLabels}
                                    onPatch={onPatch}
                                    onMoveTask={onMoveTask}
                                    onRefresh={onRefresh}
                                    onOpenTask={onOpenTask}
                                    onDelete={onDelete}
                                  />
                                ))}
                                <tfoot className="monday-table-footer">
                                  {groupBy === 'group' && (
                                    <tr className="monday-create-row">
                                      <td
                                        colSpan={
                                          compactTable
                                            ? 3 +
                                              orderedColumns.filter((c) => c.key === 'status')
                                                .length
                                            : orderedColumns.length + 3
                                        }
                                      >
                                        <div className="monday-add-row">
                                          <Plus size={16} className="text-[#0073ea] shrink-0" />
                                          <input
                                            type="text"
                                            aria-label={`Novo item em ${group.name}`}
                                            placeholder="Adicionar item…"
                                            disabled={quickSaving === group.id}
                                            value={quickTitles[group.id] || ''}
                                            onChange={(e) =>
                                              setQuickTitles((prev) => ({
                                                ...prev,
                                                [group.id]: e.target.value,
                                              }))
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                void handleQuickAdd(group.id)
                                              }
                                            }}
                                          />
                                          {(quickTitles[group.id] || '').trim() ? (
                                            <button
                                              type="button"
                                              className="monday-quick-submit"
                                              disabled={!!quickSaving}
                                              onClick={() => void handleQuickAdd(group.id)}
                                            >
                                              {quickSaving === group.id ? 'Salvando…' : 'Adicionar'}
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              className="monday-open-modal-btn"
                                              title="Criar com mais detalhes"
                                              onClick={() => onNewTask(group.id)}
                                            >
                                              Abrir formulário
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                  {quickError?.groupId === group.id && (
                                    <tr className="monday-create-error">
                                      <td
                                        colSpan={
                                          compactTable
                                            ? 3 +
                                              orderedColumns.filter((c) => c.key === 'status')
                                                .length
                                            : orderedColumns.length + 3
                                        }
                                      >
                                        <p className="quick-add-error" role="alert">
                                          {quickError.message}
                                        </p>
                                      </td>
                                    </tr>
                                  )}
                                  {groupTasks.length > 0 && (
                                    <tr className="monday-summary-row">
                                      <td className="check-cell" />
                                      <td className="title-cell text-xs text-slate-500 font-medium">
                                        {groupTasks.length}{' '}
                                        {groupTasks.length === 1 ? 'item' : 'itens'}
                                      </td>
                                      {orderedColumns.map((column) => (
                                        <td key={column.key} className={columnClass(column.key)}>
                                          {summary(column.key, groupTasks)}
                                        </td>
                                      ))}
                                      <td className="detail-cell" />
                                    </tr>
                                  )}
                                </tfoot>
                              </table>
                              {groupTasks.length === 0 && groupBy === 'status' && (
                                <p className="empty-group">Nenhuma tarefa com este status.</p>
                              )}
                            </div>
                          )}
                        </TaskSorting>
                      )}
                    </SortableGroup>
                  )
                })
              }
            </GroupSorting>
          )}
          {groupBy === 'group' && (
            <button className="button add-group-button" onClick={onNewGroup}>
              <Plus size={16} />
              Adicionar grupo
            </button>
          )}
        </div>
      )}
      {tab === 'kanban' && (
        <div className="kanban-view">
          {statusOptions.map((opt) => {
            const status = opt.label
            const colTasks = tasks.filter((t) => t.status === status)
            return (
              <section
                className="kanban-column"
                key={opt.id || status}
                style={{ '--column-accent': opt.color } as React.CSSProperties}
              >
                <header>
                  <span className="kanban-status-dot" style={{ backgroundColor: opt.color }} />
                  <h2>{status}</h2>
                  <span>{colTasks.length}</span>
                </header>
                {colTasks.map((task) => (
                  <article
                    className="kanban-card"
                    key={task.id}
                    style={{ viewTransitionName: `task-${task.id}` }}
                  >
                    <ChoiceBadge value={task.priority} customOptions={priorityOptions} />
                    <button className="kanban-task-title" onClick={() => onOpenTask(task.id)}>
                      {task.title}
                    </button>
                    <span className="kanban-group">
                      {data.groups.find((g) => g.id === task.groupId)?.name}
                      {!!subitemCounts.get(task.id) &&
                        ` · ${subitemCounts.get(task.id) || 0} subitens`}
                    </span>
                    <div className="kanban-card-bottom">
                      <AssigneeAvatars people={data.people} ids={taskOwnerIds(task)} />
                      <span className={isOverdue(task, board) ? 'overdue' : ''}>
                        <CalendarDays size={12} />
                        {displayDate(task.dueDate)}
                      </span>
                    </div>
                    <PillSelect
                      kind="status"
                      allowClear={!!board.settings?.monday}
                      placeholder={board.settings?.monday ? 'Selecionar…' : undefined}
                      value={task.status}
                      customOptions={statusOptions}
                      onOpenEditLabels={() => setEditingLabels('status')}
                      label={`Mover ${task.title} para status`}
                      className={statusClass(task.status)}
                      onChange={(next) => void onPatch(task.id, { status: next as Status })}
                    />
                  </article>
                ))}
                <button
                  className="kanban-add"
                  onClick={() => onNewTask(undefined, status as Status)}
                >
                  <Plus size={15} />
                  Nova tarefa
                </button>
              </section>
            )
          })}
        </div>
      )}
      {tab === 'calendar' && (
        <BoardCalendar board={board} tasks={tasks} onOpenTask={onOpenTask} onPatch={onPatch} />
      )}
      {tab === 'overview' && (
        <div className="overview-grid">
          <section className="overview-card status-overview">
            <div className="section-heading">
              <h2>Progresso do quadro</h2>
              <CircleCheck size={19} />
            </div>
            <p>Uma visão do que o time está construindo.</p>
            <div className="status-chart">
              <div
                className="donut"
                style={{ '--progress': `${progress}%` } as React.CSSProperties}
              >
                <div>
                  <strong>{progress}%</strong>
                  <span>concluído</span>
                </div>
              </div>
              <div className="status-legend">
                {statusOptions.map((option) => (
                  <div key={option.id}>
                    <span className="legend-dot" style={{ backgroundColor: option.color }} />
                    <span>{option.label}</span>
                    <strong>{allTasks.filter((t) => t.status === option.label).length}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="overview-card">
            <div className="section-heading">
              <h2>No radar</h2>
              <CalendarDays size={19} />
            </div>
            <p>
              {overdue > 0
                ? `${overdue} tarefa${overdue > 1 ? 's precisam' : ' precisa'} de um novo olhar para o prazo.`
                : 'Tudo em dia. Que venham as próximas entregas.'}
            </p>
            <div className="upcoming-list">
              {allTasks
                .filter((t) => !isTaskDone(t, board) && t.dueDate)
                .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
                .slice(0, 5)
                .map((task) => (
                  <button key={task.id} onClick={() => onOpenTask(task.id)}>
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {data.people
                          .filter((p) => taskOwnerIds(task).includes(p.id))
                          .map((p) => p.name)
                          .join(', ') || 'Sem responsável'}
                      </small>
                    </span>
                    <span className={isOverdue(task, board) ? 'overdue' : ''}>
                      {displayDate(task.dueDate)}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
            </div>
          </section>
          <section className="overview-card team-overview">
            <div className="section-heading">
              <h2>Carga de trabalho</h2>
              <Users size={19} />
            </div>
            <p>Distribuição das tarefas por pessoa.</p>
            <div className="team-chart">
              {data.people.map((person) => {
                const count = allTasks.filter((t) => taskOwnerIds(t).includes(person.id)).length
                return (
                  <div key={person.id}>
                    <Avatar person={person} small />
                    <span>{person.name}</span>
                    <div className="team-bar">
                      <i
                        style={{
                          width: `${allTasks.length ? (count / allTasks.length) * 100 : 0}%`,
                          backgroundColor: person.color,
                        }}
                      />
                    </div>
                    <strong>{count}</strong>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
      {(editingColumn || creatingType) && (
        <ColumnEditor
          key={editingColumn?.id || creatingType!}
          board={board}
          column={editingColumn || undefined}
          initialType={creatingType || undefined}
          onClose={() => {
            setEditingColumn(null)
            setCreatingType(null)
          }}
          onRefresh={onRefresh}
          onEditLabels={setEditingLabels}
        />
      )}
      {editingGroup && (
        <EditGroupDialog
          key={editingGroup.id}
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSaved={onRefresh}
        />
      )}
      {editingLabels && (
        <EditLabelsDialog
          key={editingLabels}
          type={editingLabels}
          currentLabels={editingLabels === 'status' ? statusOptions : priorityOptions}
          onClose={() => setEditingLabels(null)}
          onSave={handleSaveLabels}
        />
      )}
    </>
  )
}
export const BoardView = memo(BoardViewContent)

function LayersIcon() {
  return <Rows3 size={15} aria-hidden="true" />
}
