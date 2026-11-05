import { memo, useState, type ReactNode } from 'react'
import { ChevronRight, MessageSquare, ArrowUpRight } from 'lucide-react'
import type { Task, Board, Workspace, TaskPanelTab, LabelOption } from '../../shared/domain'
import { isTaskDone } from '../../shared/domain'
import { SortableTaskRows, TaskDragHandle, SortableTaskName, type MoveTask } from './TaskSorting'
import { Button } from './ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import { EditableText, IconButton } from './ui'
import { SubitemsPanel } from './SubitemsPanel'
import { justCreated } from '../lib/motion'
interface Props {
  task: Task
  board: Board
  data?: Workspace
  selected: boolean
  expanded: boolean
  revealIds?: string[]
  childCount: number
  updateCount: number
  /** Changes when the task's files change, so the memoised row re-renders its file cells. */
  attachmentKey?: string
  subitemsColSpan: number
  orderedColumns: { key: string; label: string }[]
  statusOptions: LabelOption[]
  priorityOptions: LabelOption[]
  renderField: (task: Task, key: string) => ReactNode
  onToggleSelected: (id: string, checked: boolean) => void
  onToggleExpanded: (id: string) => void
  onOpenEditLabels: (kind: 'status' | 'priority') => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
  onMoveTask: MoveTask
  onRefresh: () => Promise<void>
  onOpenTask: (id: string, tab?: TaskPanelTab) => void
  onDelete: (ids: string[]) => void
}
export const BoardTaskRow = memo(function BoardTaskRow({
  task,
  board,
  data,
  selected,
  expanded,
  revealIds,
  childCount,
  updateCount,
  subitemsColSpan,
  orderedColumns,
  statusOptions,
  priorityOptions,
  renderField,
  onToggleSelected,
  onToggleExpanded,
  onOpenEditLabels,
  onPatch,
  onMoveTask,
  onRefresh,
  onOpenTask,
  onDelete,
}: Props) {
  // A task created a moment ago (quick add, new item) lights up once when its row appears.
  const [fresh] = useState(() => justCreated(task.createdAt))
  return (
    <SortableTaskRows task={task}>
      <tr
        data-task-id={task.id}
        style={{ viewTransitionName: `task-${task.id}` }}
        className={`${selected ? 'selected-row' : ''} ${expanded ? 'expanded-row' : ''} ${isTaskDone(task, board) ? 'completed-row' : ''} ${fresh ? 'row-new' : ''}`}
      >
        <td className="check-cell">
          <label className="checkbox-target">
            <input
              type="checkbox"
              aria-label={`Selecionar ${task.title}`}
              checked={selected}
              onChange={(e) => onToggleSelected(task.id, e.target.checked)}
            />
          </label>
        </td>
        <td className="title-cell">
          <div className="task-title">
            <TaskDragHandle title={task.title} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="expand-subitems"
                  data-has-subitems={childCount > 0}
                  aria-label={`${expanded ? 'Recolher' : 'Expandir'} subitens de ${task.title}`}
                  aria-expanded={expanded}
                  aria-controls={`subitems-${task.id}`}
                  onClick={() => onToggleExpanded(task.id)}
                >
                  <ChevronRight className={expanded ? 'rotate-90' : ''} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {expanded ? 'Recolher subitens' : 'Expandir subitens'}
              </TooltipContent>
            </Tooltip>
            <SortableTaskName>
              <EditableText
                activation="doubleClick"
                value={task.title}
                label={`Título: ${task.title}`}
                onSave={(title) => void onPatch(task.id, { title })}
              />
            </SortableTaskName>
            {childCount > 0 && (
              <span className="subitem-count" aria-label={`${childCount} subitens`}>
                {childCount}
              </span>
            )}
            <button
              className="task-comments"
              data-has-comments={updateCount > 0}
              aria-label={`Abrir atualizações de ${task.title}`}
              title={`${updateCount} atualizações`}
              onClick={() => onOpenTask(task.id, 'updates')}
            >
              <MessageSquare size={18} />
              {updateCount > 0 && <span className="task-comments-count">{updateCount}</span>}
            </button>
          </div>
        </td>
        {orderedColumns.map((column) => (
          <td
            key={column.key}
            className={
              ['owner', 'status', 'priority', 'date'].includes(column.key)
                ? `${column.key}-cell`
                : 'custom-cell'
            }
          >
            {renderField(task, column.key)}
          </td>
        ))}
        <td className="detail-cell">
          <IconButton label={`Mais detalhes: ${task.title}`} onClick={() => onOpenTask(task.id)}>
            <ArrowUpRight size={15} />
          </IconButton>
        </td>
      </tr>
      {expanded && (
        <tr className="subitems-row" id={`subitems-${task.id}`}>
          <td colSpan={subitemsColSpan}>
            <SubitemsPanel
              revealIds={revealIds}
              parent={task}
              data={data!}
              statusOptions={statusOptions}
              priorityOptions={priorityOptions}
              onOpenEditLabels={onOpenEditLabels}
              onPatch={onPatch}
              onMoveTask={onMoveTask}
              onRefresh={onRefresh}
              onOpenTask={onOpenTask}
              onDelete={onDelete}
            />
          </td>
        </tr>
      )}
    </SortableTaskRows>
  )
})
