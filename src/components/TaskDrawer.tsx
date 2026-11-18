import { useEffect, useState, type ReactNode } from 'react'
import { FieldSelect } from './FieldSelect'
import {
  CalendarDays,
  Flag,
  Circle,
  UserRound,
  Trash2,
  Clock3,
  AlignLeft,
  ExternalLink,
  Layers3,
  CornerDownRight,
} from 'lucide-react'
import {
  type Task,
  type TaskPanelTab,
  taskUpdateCount,
  type Workspace,
  type CustomColumn,
  type Status,
  type Priority,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_PRIORITY_OPTIONS,
  statusClass,
  priorityClass,
  taskOwnerIds,
  isOverdue,
  isTaskDone,
  localDate,
} from '../../shared/domain'
import { EditableText, Modal, PillSelect } from './ui'
import { ReadOnlyContext } from '../lib/readonly'
import { SubitemsPanel } from './SubitemsPanel'
import { AssigneePicker } from './AssigneePicker'
import { DatePicker } from './DatePicker'
import { TaskCustomCell } from './TaskCustomCell'
import { ColumnEditor, ColumnTypeIcon } from './ColumnEditor'
import { TaskUpdates, TaskFiles } from './TaskUpdates'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import type { MoveTask } from './TaskSorting'

export function TaskDrawer({
  task,
  data,
  onClose,
  onPatch,
  onRefresh,
  onDelete,
  initialTab = 'details',
  onOpenTask,
  onMoveTask,
}: {
  task: Task
  data: Workspace
  onClose: () => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
  onRefresh: () => Promise<void>
  onDelete: (ids: string[]) => void
  initialTab?: TaskPanelTab
  onOpenTask: (id: string, tab?: TaskPanelTab) => void
  onMoveTask: MoveTask
}) {
  const [editingColumn, setEditingColumn] = useState<CustomColumn | null>(null)
  const [tab, setTab] = useState<TaskPanelTab>(initialTab)
  useEffect(() => setTab(initialTab), [initialTab])
  const updateCount = taskUpdateCount(data.comments, task.id)
  const fileCount = (data.attachments || []).filter((file) => file.taskId === task.id).length
  const board = data.boards.find((b) => b.id === task.boardId)
  const group = data.groups.find((g) => g.id === task.groupId)
  const parent = task.parentId ? data.tasks.find((t) => t.id === task.parentId) : undefined
  const statusOptions =
    (task.parentId ? board?.settings?.subitemStatusOptions : undefined) ||
    board?.settings?.statusOptions ||
    DEFAULT_STATUS_OPTIONS
  const priorityOptions =
    (task.parentId ? board?.settings?.subitemPriorityOptions : undefined) ||
    board?.settings?.priorityOptions ||
    DEFAULT_PRIORITY_OPTIONS
  const customColumns = (board?.columns || []).filter((column) =>
    task.parentId && board?.settings?.subitemColumns
      ? board.settings.subitemColumns.includes(column.id)
      : column.source?.scope !== 'subitems',
  )
  // Boards the person may only read keep the panel visible but not editable.
  const readOnly = board?.access?.canEdit === false

  return (
    <ReadOnlyContext.Provider value={readOnly}>
      <Modal
        title={task.title}
        heading={
          <EditableText
            activation="doubleClick"
            readOnly={readOnly}
            value={task.title}
            label="Título da tarefa"
            className="drawer-title"
            onSave={(title) => void onPatch(task.id, { title })}
          />
        }
        subtitle={
          <span className="task-panel-crumbs">
            <span>{board?.name}</span>
            {parent ? (
              <>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  className="task-panel-parent"
                  title="Abrir a tarefa principal"
                  onClick={() => onOpenTask(parent.id)}
                >
                  <CornerDownRight size={13} aria-hidden="true" />
                  {parent.title}
                </button>
              </>
            ) : (
              group && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="task-panel-group">
                    <i style={{ background: group.color }} aria-hidden="true" />
                    {group.name}
                  </span>
                </>
              )
            )}
          </span>
        }
        className="drawer-modal task-panel"
        onClose={onClose}
      >
        <Tabs
          className="task-panel-tabs"
          value={tab}
          onValueChange={(value) => setTab(value as TaskPanelTab)}
        >
          <TabsList variant="line" className="task-panel-tabs-list" aria-label="Seções do item">
            <TabsTrigger value="updates">
              Atualizações <span>{updateCount}</span>
            </TabsTrigger>
            <TabsTrigger value="files">
              Arquivos {fileCount > 0 && <span>{fileCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="details">Detalhes</TabsTrigger>
          </TabsList>
          <TabsContent value="updates">
            <TaskUpdates task={task} data={data} onRefresh={onRefresh} onOpenTask={onOpenTask} />
          </TabsContent>
          <TabsContent value="files">
            <TaskFiles task={task} data={data} />
          </TabsContent>
          <TabsContent value="details">
            <div className="task-drawer">
              <section className="task-section drawer-description">
                <h3>
                  <AlignLeft size={15} aria-hidden="true" />
                  Descrição
                </h3>
                <EditableText
                  readOnly={readOnly}
                  value={task.description}
                  multiline
                  label="Descrição da tarefa"
                  placeholder={
                    readOnly
                      ? 'Sem descrição.'
                      : 'Descreva a entrega, adicione contexto ou liste os próximos passos…'
                  }
                  onSave={(description) => void onPatch(task.id, { description })}
                />
              </section>
              <section className="task-section">
                <h3>Propriedades</h3>
                <div className="task-properties" inert={readOnly}>
                  <Property icon={<Circle size={14} />} label="Status" choice>
                    <PillSelect
                      value={task.status}
                      kind="status"
                      allowClear={!!board?.settings?.monday}
                      placeholder={board?.settings?.monday ? 'Selecionar…' : undefined}
                      customOptions={statusOptions}
                      className={statusClass(task.status)}
                      label="Status da tarefa"
                      onChange={(status) => void onPatch(task.id, { status: status as Status })}
                    />
                  </Property>
                  <Property icon={<Flag size={14} />} label="Prioridade" choice>
                    <PillSelect
                      value={task.priority}
                      kind="priority"
                      allowClear={!!board?.settings?.monday}
                      placeholder={board?.settings?.monday ? 'Selecionar…' : undefined}
                      customOptions={priorityOptions}
                      className={`priority ${priorityClass(task.priority)}`}
                      label="Prioridade da tarefa"
                      onChange={(priority) =>
                        void onPatch(task.id, { priority: priority as Priority })
                      }
                    />
                  </Property>
                  <Property icon={<UserRound size={14} />} label="Responsável">
                    <AssigneePicker
                      people={data.people}
                      value={taskOwnerIds(task)}
                      label="Responsável da tarefa"
                      onChange={(ownerIds) => onPatch(task.id, { ownerIds })}
                    />
                  </Property>
                  <Property icon={<CalendarDays size={14} />} label="Prazo">
                    <DatePicker
                      value={task.dueAt ? localDate(new Date(task.dueAt)) : task.dueDate}
                      dateTime={task.dueAt}
                      onChangeDateTime={(dueDate, dueAt) => onPatch(task.id, { dueDate, dueAt })}
                      label="Prazo da tarefa"
                      overdue={isOverdue(task, board)}
                      done={isTaskDone(task, board)}
                      onChange={(dueDate) => onPatch(task.id, { dueDate })}
                    />
                  </Property>
                  <Property icon={<Layers3 size={14} />} label="Grupo">
                    <FieldSelect
                      label="Grupo da tarefa"
                      value={task.groupId}
                      disabled={!!task.parentId}
                      onChange={(groupId) => void onPatch(task.id, { groupId })}
                      heading="Grupos do quadro"
                      options={data.groups
                        .filter((g) => g.boardId === task.boardId)
                        .map((g) => ({ value: g.id, label: g.name, color: g.color }))}
                    />
                  </Property>
                </div>
              </section>
              {board && customColumns.length > 0 && (
                <section className="task-section drawer-custom-columns">
                  <h3>
                    Campos do quadro <span>{customColumns.length}</span>
                  </h3>
                  <div className="task-properties" inert={readOnly}>
                    {customColumns.map((column) => (
                      <Property
                        key={column.id}
                        icon={<ColumnTypeIcon type={column.type} />}
                        label={column.name}
                        type={column.type}
                        choice={column.type === 'status'}
                      >
                        <TaskCustomCell
                          workspace={data}
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
                      </Property>
                    ))}
                  </div>
                </section>
              )}
              {board && editingColumn && (
                <ColumnEditor
                  board={board}
                  column={editingColumn}
                  onRefresh={onRefresh}
                  onClose={() => setEditingColumn(null)}
                />
              )}
              <section className="task-section task-subitems-section">
                <h3>Subitens</h3>
                <SubitemsPanel
                  parent={task}
                  data={data}
                  statusOptions={statusOptions}
                  priorityOptions={priorityOptions}
                  onPatch={onPatch}
                  onMoveTask={onMoveTask}
                  onRefresh={onRefresh}
                  onOpenTask={onOpenTask}
                  onDelete={onDelete}
                />
              </section>
              <footer className="drawer-footer">
                <span>
                  <span>
                    <Clock3 size={13} aria-hidden="true" />
                    Atualizada em{' '}
                    {new Date(task.updatedAt).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {task.source && (
                    <span className="origin-note">
                      <ExternalLink size={13} aria-hidden="true" />
                      Importada de {task.source.startsWith('monday') ? 'monday.com' : 'arquivo'}
                      {task.externalId && task.source.startsWith('monday') && (
                        <> · ID {task.externalId}</>
                      )}
                    </span>
                  )}
                </span>
                {!readOnly && (
                  <button className="text-button danger" onClick={() => onDelete([task.id])}>
                    <Trash2 size={14} aria-hidden="true" />
                    {task.parentId ? 'Excluir subitem' : 'Excluir tarefa'}
                  </button>
                )}
              </footer>
            </div>
          </TabsContent>
        </Tabs>
      </Modal>
    </ReadOnlyContext.Provider>
  )
}

/** One field of the details grid: label above, value inside a 40 px field shell. */
function Property({
  icon,
  label,
  type,
  choice = false,
  children,
}: {
  icon: ReactNode
  label: string
  type?: string
  /** Status-like pickers sit as a pill inside the shell; a click on the shell opens them. */
  choice?: boolean
  children: ReactNode
}) {
  return (
    <div className={`task-property${choice ? ' is-choice' : ''}`} data-type={type}>
      <span className="task-property-label">
        {icon}
        {label}
      </span>
      <div
        className="task-property-control"
        onClick={
          choice
            ? (event) => {
                if (event.target !== event.currentTarget) return
                event.currentTarget.querySelector<HTMLElement>('button')?.click()
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}
