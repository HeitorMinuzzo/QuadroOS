import { useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpRight, CircleCheck } from 'lucide-react'
import {
  isOverdue,
  isTaskDone,
  localDate,
  taskOwnerIds,
  type Status,
  type Task,
  type Workspace,
} from '../../shared/domain'
import { EmptyState, PillSelect } from './ui'

const ME = 'person-you'

type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'undated'
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'overdue', label: 'Atrasadas' },
  { id: 'today', label: 'Hoje' },
  { id: 'week', label: 'Próximos 7 dias' },
  { id: 'later', label: 'Mais adiante' },
  { id: 'undated', label: 'Sem prazo' },
]

function displayDate(value: string | null) {
  return value
    ? new Date(`${value}T12:00:00`)
        .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
        .replace('.', '')
    : 'Sem prazo'
}
function addDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDate(date)
}

export function MyWorkView({
  data,
  onOpenTask,
  onOpenBoard,
  onPatch,
}: {
  data: Workspace
  onOpenTask: (id: string) => void
  /** Opens the board already filtered to the current person's tasks. */
  onOpenBoard: (id: string) => void
  onPatch: (id: string, changes: Partial<Task>) => Promise<boolean>
}) {
  const [showDone, setShowDone] = useState(false)
  const boardById = new Map(data.boards.map((board) => [board.id, board]))
  const groupById = new Map(data.groups.map((group) => [group.id, group]))
  const mine = data.tasks.filter(
    (task) => !task.parentId && boardById.has(task.boardId) && taskOwnerIds(task).includes(ME),
  )
  const done = (task: Task) => isTaskDone(task, boardById.get(task.boardId))
  const open = mine.filter((task) => !done(task))
  const finished = mine.filter(done)
  const today = localDate()
  const weekEnd = addDays(7)
  const bucketOf = (task: Task): Bucket => {
    if (isOverdue(task, boardById.get(task.boardId))) return 'overdue'
    if (!task.dueDate) return 'undated'
    if (task.dueDate === today) return 'today'
    return task.dueDate <= weekEnd ? 'week' : 'later'
  }
  const sorted = [...open].sort(
    (a, b) =>
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
      a.title.localeCompare(b.title, 'pt-BR'),
  )
  const boardsWithMine = data.boards.filter((board) =>
    open.some((task) => task.boardId === board.id),
  )

  const row = (task: Task) => {
    const board = boardById.get(task.boardId)
    const group = groupById.get(task.groupId)
    return (
      <li
        key={task.id}
        className="my-work-task"
        style={{ '--board-color': board?.color } as CSSProperties}
      >
        <button className="my-work-title" onClick={() => onOpenTask(task.id)}>
          <strong>{task.title}</strong>
          <small>
            {board?.name}
            {group && <> · {group.name}</>}
          </small>
        </button>
        <PillSelect
          kind="status"
          label={`Status: ${task.title}`}
          value={task.status}
          customOptions={board?.settings?.statusOptions}
          onChange={(status) => void onPatch(task.id, { status: status as Status })}
          className="my-work-status"
        />
        <span className={`my-work-date ${isOverdue(task, board) ? 'overdue' : ''}`}>
          {displayDate(task.dueDate)}
        </span>
      </li>
    )
  }

  return (
    <div className="my-work-view">
      <section className="board-heading">
        <div className="board-heading-copy">
          <div className="board-title-row">
            <span className="my-work-mark" aria-hidden="true">
              <CircleCheck size={19} />
            </span>
            <h1>Meu trabalho</h1>
          </div>
          <p>
            {open.length
              ? `${open.length} tarefa${open.length === 1 ? '' : 's'} aberta${open.length === 1 ? '' : 's'} com você em ${boardsWithMine.length} quadro${boardsWithMine.length === 1 ? '' : 's'}.`
              : 'Nenhuma tarefa aberta com você no momento.'}
          </p>
        </div>
        <div className="board-heading-actions">
          <label className="my-work-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(event) => setShowDone(event.target.checked)}
            />
            Mostrar concluídas
          </label>
        </div>
      </section>

      {boardsWithMine.length > 0 && (
        <nav className="my-work-boards" aria-label="Abrir minhas tarefas em um quadro">
          {boardsWithMine.map((board) => (
            <button
              key={board.id}
              onClick={() => onOpenBoard(board.id)}
              style={{ '--board-color': board.color } as CSSProperties}
            >
              <span className="my-work-board-dot" />
              {board.name}
              <span className="my-work-board-count">
                {open.filter((task) => task.boardId === board.id).length}
              </span>
              <ArrowUpRight size={13} />
            </button>
          ))}
        </nav>
      )}

      {!open.length && !showDone ? (
        <EmptyState
          icon={<CircleCheck size={30} />}
          title="Tudo em dia por aqui."
          description="Quando alguém atribuir uma tarefa a você, ela aparece nesta lista."
        />
      ) : (
        <div className="my-work-sections">
          {BUCKETS.map(({ id, label }) => {
            const tasks = sorted.filter((task) => bucketOf(task) === id)
            if (!tasks.length) return null
            return (
              <section
                key={id}
                className={`overview-card my-work-section bucket-${id}`}
                aria-labelledby={`my-work-${id}`}
              >
                <div className="section-heading">
                  <h2 id={`my-work-${id}`}>{label}</h2>
                  <span className="workspace-count">{tasks.length}</span>
                </div>
                <ul>{tasks.map(row)}</ul>
              </section>
            )
          })}
          {showDone && (
            <section
              className="overview-card my-work-section bucket-done"
              aria-labelledby="my-work-done"
            >
              <div className="section-heading">
                <h2 id="my-work-done">Concluídas</h2>
                <span className="workspace-count">{finished.length}</span>
              </div>
              {finished.length ? (
                <ul>{finished.map(row)}</ul>
              ) : (
                <p>Nenhuma tarefa concluída ainda.</p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
