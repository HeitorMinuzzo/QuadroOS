import { useEffect, useState } from 'react'
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
  localDate,
} from '../../shared/domain'
import { EditableText, Modal, PillSelect } from './ui'
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
  const statusOptions =
    (task.parentId ? board?.settings?.subitemStatusOptions : undefined) ||
    board?.settings?.statusOptions ||
    DEFAULT_STATUS_OPTIONS
  const priorityOptions =
    (task.parentId ? board?.settings?.subitemPriorityOptions : undefined) ||
    board?.settings?.priorityOptions ||
    DEFAULT_PRIORITY_OPTIONS

  return (
    <Modal
      title={
        tab === 'details'
          ? task.parentId
            ? 'Detalhes do subitem'
            : 'Detalhes da tarefa'
          : task.title
      }
      subtitle={board?.name}
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
            <span className="drawer-eyebrow">
              {task.parentId ? 'DETALHES DO SUBITEM' : 'DETALHES DA TAREFA'}
            </span>
            {task.parentId && (
              <button className="text-button" onClick={() => onOpenTask(task.parentId!)}>
                ↳ {data.tasks.find((t) => t.id === task.parentId)?.title}
              </button>
            )}
            <EditableText
              activation="doubleClick"
              value={task.title}
              label="Título da tarefa"
              className="drawer-title"
              onSave={(title) => void onPatch(task.id, { title })}
            />
            <div className="task-properties">
              <div>
                <span>
                  <Circle size={16} />
                  Status
                </span>
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
              </div>
              <div>
                <span>
                  <Flag size={16} />
                  Prioridade
                </span>
                <PillSelect
                  value={task.priority}
                  kind="priority"
                  allowClear={!!board?.settings?.monday}
                  placeholder={board?.settings?.monday ? 'Selecionar…' : undefined}
                  customOptions={priorityOptions}
                  className={`priority ${priorityClass(task.priority)}`}
                  label="Prioridade da tarefa"
                  onChange={(priority) => void onPatch(task.id, { priority: priority as Priority })}
                />
              </div>
              <div>
                <span>
                  <UserRound size={16} />
                  Responsável
                </span>
                <AssigneePicker
                  people={data.people}
                  value={taskOwnerIds(task)}
                  label="Responsável da tarefa"
                  onChange={(ownerIds) => onPatch(task.id, { ownerIds })}
                />
              </div>
              <div>
                <span>
                  <CalendarDays size={16} />
                  Prazo
                </span>
                <DatePicker
                  value={task.dueAt ? localDate(new Date(task.dueAt)) : task.dueDate}
                  dateTime={task.dueAt}
                  onChangeDateTime={(dueDate, dueAt) => onPatch(task.id, { dueDate, dueAt })}
                  label="Prazo da tarefa"
                  overdue={isOverdue(task, board)}
                  onChange={(dueDate) => onPatch(task.id, { dueDate })}
                />
              </div>
              <div>
                <span>
                  <Layers3 size={16} />
                  Grupo
                </span>
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
              </div>
            </div>
            {!!board?.columns.length && (
              <section className="drawer-custom-columns">
                <h3>Colunas do quadro</h3>
                <div className="task-properties">
                  {board.columns
                    .filter((column) =>
                      task.parentId && board.settings?.subitemColumns
                        ? board.settings.subitemColumns.includes(column.id)
                        : column.source?.scope !== 'subitems',
                    )
                    .map((column) => (
                      <div key={column.id}>
                        <span>
                          <ColumnTypeIcon type={column.type} />
                          {column.name}
                        </span>
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
                      </div>
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
            <section className="drawer-description">
              <h3>
                <AlignLeft size={17} />
                Descrição
              </h3>
              <EditableText
                value={task.description}
                multiline
                label="Descrição da tarefa"
                placeholder="Descreva a entrega, adicione contexto ou liste os próximos passos…"
                onSave={(description) => void onPatch(task.id, { description })}
              />
            </section>
            {
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
            }
            {task.source && (
              <div className="origin-note">
                <ExternalLink size={14} />
                Importada de {task.source.startsWith('monday') ? 'monday.com' : 'arquivo'}
                {task.externalId && task.source.startsWith('monday') && (
                  <span>· ID {task.externalId}</span>
                )}
              </div>
            )}
            <footer className="drawer-footer">
              <span>
                <Clock3 size={13} />
                Atualizada em{' '}
                {new Date(task.updatedAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <button className="text-button danger" onClick={() => onDelete([task.id])}>
                <Trash2 size={14} />
                Excluir tarefa
              </button>
            </footer>
          </div>
        </TabsContent>
      </Tabs>
    </Modal>
  )
}
