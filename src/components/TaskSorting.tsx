import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
  type DropAnimation,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { Task } from '../../shared/domain'
import type { TaskPlacement } from '../../shared/board-layout'
import { OverlayContainer } from '../lib/overlay-container'

export type MoveTask = (id: string, targetId: string, placement: TaskPlacement) => Promise<boolean>
const SortableRow = createContext<ReturnType<typeof useSortable> | null>(null)
const collision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)
const verticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 })
const previewModifiers = [verticalAxis]

function taskTextAnchor(row: Element | null) {
  const input = row?.querySelector<HTMLInputElement>('.sortable-task-name input')
  if (!input) return null
  const rect = input.getBoundingClientRect()
  const style = getComputedStyle(input)
  return {
    left: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
    centerY: rect.top + rect.height / 2,
    font: style.font,
    letterSpacing: style.letterSpacing,
  }
}
type TextAnchor = ReturnType<typeof taskTextAnchor>

const taskDropAnimation: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  keyframes: ({ active, dragOverlay, transform: { initial, final } }) => {
    const anchor = taskTextAnchor(active.node)
    const text = dragOverlay.node.querySelector('.task-drag-preview span')?.getBoundingClientRect()
    // The draggable is an entire table section. Land its preview on the title's
    // text, rather than the section's left edge (which includes other controls).
    const destination =
      anchor && text
        ? {
            ...initial,
            x: initial.x + anchor.left - text.left,
            y: initial.y + anchor.centerY - (text.top + text.height / 2),
          }
        : final
    return [
      { transform: CSS.Transform.toString(initial) },
      { transform: CSS.Transform.toString(destination) },
    ]
  },
}

function TaskDragPreview({ title, anchor }: { title: string; anchor: TextAnchor }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const preview = ref.current
    const text = preview?.querySelector('span')
    const wrapper = preview?.parentElement
    if (!preview || !text || !wrapper || !anchor) return
    preview.style.marginLeft = ''
    preview.style.marginTop = ''
    const rect = text.getBoundingClientRect()
    const transform = new DOMMatrix(getComputedStyle(wrapper).transform)
    // Anchor the preview before its first paint, preserving the pointer delta.
    preview.style.marginLeft = `${anchor.left - (rect.left - transform.m41)}px`
    preview.style.marginTop = `${anchor.centerY - (rect.top + rect.height / 2 - transform.m42)}px`
  }, [anchor])
  return (
    <div ref={ref} className="task-drag-preview">
      <GripVertical size={17} />
      <span style={anchor ? { font: anchor.font, letterSpacing: anchor.letterSpacing } : undefined}>
        {title}
      </span>
    </div>
  )
}

export function TaskSorting({
  tasks,
  onMove,
  disabled = false,
  children,
}: {
  tasks: Task[]
  onMove: MoveTask
  disabled?: boolean
  children: (tasks: Task[]) => ReactNode
}) {
  const id = useId()
  const container = useContext(OverlayContainer)
  const [active, setActive] = useState<string | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<TextAnchor>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const moveRevision = useRef(0)
  const dropPosition = useRef<number | null>(null)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const orderedTasks = pendingOrder
    ? [
        ...pendingOrder.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        ...tasks.filter((task) => !pendingOrder.includes(task.id)),
      ]
    : tasks
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const title = (taskId: string | number) => tasks.find((t) => t.id === taskId)?.title || 'Item'
  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{
        container: container || undefined,
        screenReaderInstructions: {
          draggable:
            'Para mover, pressione Espaço. Use as setas para escolher a posição no grupo. Pressione Espaço para soltar ou Escape para cancelar.',
        },
        announcements: {
          onDragStart: ({ active }) => `Movendo ${title(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${title(active.id)}, posição ${orderedTasks.findIndex((t) => t.id === over.id) + 1} de ${orderedTasks.length}.`
              : 'Fora do grupo. Volte ao grupo para soltar.',
          onDragEnd: ({ active, over }) =>
            over
              ? `${title(active.id)} solto na posição ${dropPosition.current ?? orderedTasks.findIndex((t) => t.id === over.id) + 1}.`
              : 'Movimento cancelado.',
          onDragCancel: () => 'Movimento cancelado.',
        },
      }}
      onDragStart={({ active, activatorEvent }) => {
        dropPosition.current = null
        const target = activatorEvent.target
        setPreviewAnchor(
          taskTextAnchor(target instanceof Element ? target.closest('.sortable-task') : null),
        )
        setActive(String(active.id))
      }}
      onDragCancel={() => setActive(null)}
      onDragEnd={({ active, over }) => {
        const from = orderedTasks.findIndex((t) => t.id === active.id)
        const to = orderedTasks.findIndex((t) => t.id === over?.id)
        dropPosition.current = to >= 0 ? to + 1 : null
        if (disabled || !over || from < 0 || to < 0 || from === to) {
          setActive(null)
          return
        }
        const revision = ++moveRevision.current
        // Commit the destination before DragOverlay measures its landing position.
        // Keep it visible while this move waits for earlier writes in the API queue.
        flushSync(() => {
          setPendingOrder(
            arrayMove(
              orderedTasks.map((t) => t.id),
              from,
              to,
            ),
          )
          setActive(null)
        })
        const settled = () => {
          if (moveRevision.current === revision) setPendingOrder(null)
        }
        void onMove(String(active.id), String(over.id), from < to ? 'after' : 'before').then(
          settled,
          settled,
        )
      }}
    >
      <SortableContext
        items={orderedTasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        {children(orderedTasks)}
      </SortableContext>
      {createPortal(
        <DragOverlay
          modifiers={previewModifiers}
          dropAnimation={
            window.matchMedia('(prefers-reduced-motion: reduce)').matches ? null : taskDropAnimation
          }
        >
          {active ? <TaskDragPreview title={title(active)} anchor={previewAnchor} /> : null}
        </DragOverlay>,
        container || document.body,
      )}
    </DndContext>
  )
}

export function SortableTaskRows({ task, children }: { task: Task; children: ReactNode }) {
  const sortable = useSortable({ id: task.id })
  return (
    <SortableRow value={sortable}>
      <tbody
        ref={sortable.setNodeRef}
        className={`sortable-task ${sortable.isDragging ? 'is-dragging' : ''}`}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }}
      >
        {children}
      </tbody>
    </SortableRow>
  )
}

export function TaskDragHandle({ title }: { title: string }) {
  const sortable = useContext(SortableRow)
  if (!sortable) return null
  const disabled = sortable.attributes['aria-disabled']
  return (
    <button
      type="button"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      className="task-drag-handle"
      aria-label={`Mover tarefa ${title}`}
      title={
        disabled
          ? 'Escolha a ordem manual e o agrupamento por grupos para mover'
          : 'Segure e arraste para mover · Espaço e setas pelo teclado'
      }
    >
      <GripVertical size={14} />
    </button>
  )
}

export function SortableTaskName({ children }: { children: ReactNode }) {
  const sortable = useContext(SortableRow)
  return (
    <div
      className="sortable-task-name"
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('.is-editing')) sortable?.listeners?.onMouseDown?.(e)
      }}
      onTouchStart={(e) => {
        if (!(e.target as HTMLElement).closest('.is-editing'))
          sortable?.listeners?.onTouchStart?.(e)
      }}
    >
      {children}
    </div>
  )
}
