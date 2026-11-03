import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { flushSync } from 'react-dom'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  MeasuringStrategy,
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
import type { TaskPlacement } from '../../shared/board-layout'

type GroupIdentity = { id: string; name: string; color: string }
export type MoveGroup = (id: string, targetId: string, placement: TaskPlacement) => Promise<boolean>
const GroupSortable = createContext<ReturnType<typeof useSortable> | null>(null)
const Enabled = createContext(false)
const verticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0, scaleX: 1, scaleY: 1 })
const modifiers = [verticalAxis]
const measuring = { droppable: { strategy: MeasuringStrategy.Always } }

export function GroupSorting<T extends GroupIdentity>({
  groups,
  enabled,
  onMove,
  children,
}: {
  groups: T[]
  enabled: boolean
  onMove: MoveGroup
  children: (groups: T[]) => ReactNode
}) {
  const id = useId()
  const [pending, setPending] = useState<string[] | null>(null)
  const revision = useRef(0)
  const ordered = pending
    ? [
        ...pending.flatMap((id) => {
          const item = groups.find((group) => group.id === id)
          return item ? [item] : []
        }),
        ...groups.filter((group) => !pending.includes(group.id)),
      ]
    : groups
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const title = (id: string | number) => groups.find((group) => group.id === id)?.name || 'Grupo'
  return (
    <Enabled value={enabled}>
      <DndContext
        id={id}
        sensors={sensors}
        modifiers={modifiers}
        measuring={measuring}
        collisionDetection={(args) => {
          const within = args.pointerCoordinates ? pointerWithin(args) : []
          return within.length ? within : closestCenter(args)
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Para mover o grupo recolhido, pressione Espaço, escolha a posição com as setas e pressione Espaço para soltar. Escape cancela.',
          },
          announcements: {
            onDragStart: ({ active }) => `Movendo grupo ${title(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over
                ? `${title(active.id)}, posição ${ordered.findIndex((group) => group.id === over.id) + 1} de ${ordered.length}.`
                : 'Fora da lista de grupos.',
            onDragEnd: ({ active, over }) =>
              over ? `Grupo ${title(active.id)} reposicionado.` : 'Movimento cancelado.',
            onDragCancel: () => 'Movimento do grupo cancelado.',
          },
        }}
        onDragEnd={({ active, over }) => {
          const from = ordered.findIndex((group) => group.id === active.id)
          const to = ordered.findIndex((group) => group.id === over?.id)
          if (!enabled || !over || from < 0 || to < 0 || from === to) return
          const current = ++revision.current
          flushSync(() =>
            setPending(
              arrayMove(
                ordered.map((group) => group.id),
                from,
                to,
              ),
            ),
          )
          const settle = () => {
            if (revision.current === current) setPending(null)
          }
          void onMove(String(active.id), String(over.id), from < to ? 'after' : 'before').then(
            settle,
            settle,
          )
        }}
      >
        <SortableContext
          items={ordered.map((group) => group.id)}
          strategy={verticalListSortingStrategy}
          disabled={!enabled}
        >
          {children(ordered)}
        </SortableContext>
      </DndContext>
    </Enabled>
  )
}

export function SortableGroup({
  group,
  collapsed,
  children,
}: {
  group: GroupIdentity
  collapsed: boolean
  children: ReactNode
}) {
  const enabled = useContext(Enabled)
  const sortable = useSortable({
    id: group.id,
    disabled: { draggable: !enabled || !collapsed, droppable: !enabled },
    animateLayoutChanges: () => false,
  })
  const style = {
    '--group-color': group.color,
    // dnd-kit scales the active transform to the hovered target after modifiers.
    // Groups have different heights; move the original section without resizing it.
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.isDragging ? undefined : sortable.transition,
  } as CSSProperties
  return (
    <GroupSortable value={sortable}>
      <section
        ref={sortable.setNodeRef}
        className={`task-group sortable-group ${collapsed ? 'is-collapsed' : ''} ${sortable.isDragging ? 'is-dragging' : ''}`}
        data-group-id={group.id}
        style={style}
      >
        {children}
      </section>
    </GroupSortable>
  )
}

export function GroupDragSurface({ children }: { children: ReactNode }) {
  const sortable = useContext(GroupSortable)
  const disabled = sortable?.attributes['aria-disabled']
  return (
    <div
      className={`group-leading ${disabled ? '' : 'group-drag-surface'}`}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement
        if (!disabled && !target.closest('input, button:not(.group-name-button)'))
          sortable?.listeners?.onMouseDown?.(event)
      }}
      onTouchStart={(event) => {
        const target = event.target as HTMLElement
        if (!disabled && !target.closest('input, button:not(.group-name-button)'))
          sortable?.listeners?.onTouchStart?.(event)
      }}
    >
      {children}
    </div>
  )
}

export function GroupDragHandle({ name }: { name: string }) {
  const sortable = useContext(GroupSortable)
  if (!sortable || sortable.attributes['aria-disabled']) return null
  return (
    <button
      type="button"
      ref={sortable.setActivatorNodeRef}
      {...sortable.attributes}
      {...sortable.listeners}
      className="group-drag-handle"
      aria-label={`Mover grupo ${name}`}
      title="Arraste para mudar a ordem · Espaço e setas pelo teclado"
    >
      <GripVertical size={15} />
    </button>
  )
}
