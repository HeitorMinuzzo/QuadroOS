import {
  AlarmClock,
  ArrowRight,
  CircleCheck,
  CircleDashed,
  ListTodo,
  Plus,
  Star,
  Upload,
  UserRound,
} from 'lucide-react'
import {
  isOverdue,
  isTaskDone,
  taskOwnerIds,
  type Board,
  type Task,
  type Workspace,
} from '../../shared/domain'
import type { CSSProperties } from 'react'
import { BoardIcon } from './Sidebar'
import { workspaceInitial } from '../lib/workspaces'
import { ChoiceBadge } from './ui'

const ME = 'person-you'

function displayDate(value: string | null) {
  return value
    ? new Date(`${value}T12:00:00`)
        .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
        .replace('.', '')
    : 'Sem prazo'
}
function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}
/** Open tasks first by due date, undated ones last. */
function byDueDate(a: Task, b: Task) {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
  return a.dueDate ? -1 : b.dueDate ? 1 : a.title.localeCompare(b.title, 'pt-BR')
}

export function WorkspaceView({
  data,
  workspaceName,
  onOpenBoard,
  onOpenTask,
  onCreateBoard,
  onImport,
}: {
  data: Workspace
  workspaceName: string
  onOpenBoard: (id: string) => void
  onOpenTask: (id: string) => void
  onCreateBoard: () => void
  onImport: () => void
}) {
  const boardById = new Map(data.boards.map((board) => [board.id, board]))
  // Indicators count main tasks only, as the board overview does.
  const tasks = data.tasks.filter((task) => !task.parentId && boardById.has(task.boardId))
  const done = (task: Task) => isTaskDone(task, boardById.get(task.boardId))
  const open = tasks.filter((task) => !done(task))
  const overdue = open.filter((task) => isOverdue(task, boardById.get(task.boardId)))
  const mine = open.filter((task) => taskOwnerIds(task).includes(ME)).sort(byDueDate)
  const completed = tasks.length - open.length
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0
  const boards = [...data.boards].sort(
    (a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'pt-BR'),
  )
  const boardStats = (board: Board) => {
    const own = tasks.filter((task) => task.boardId === board.id)
    const finished = own.filter(done).length
    return {
      total: own.length,
      finished,
      late: own.filter((task) => isOverdue(task, board)).length,
      percent: own.length ? Math.round((finished / own.length) * 100) : 0,
    }
  }
  const taskRow = (task: Task) => {
    const board = boardById.get(task.boardId)
    return (
      <button key={task.id} className="workspace-task" onClick={() => onOpenTask(task.id)}>
        <span className="workspace-task-board" style={{ background: board?.color }} />
        <span className="workspace-task-copy">
          <strong>{task.title}</strong>
          <small>{board?.name}</small>
        </span>
        {task.status ? (
          <ChoiceBadge
            value={task.status}
            customOptions={board?.settings?.statusOptions}
            className="workspace-task-status"
          />
        ) : (
          <span />
        )}
        <span className={`workspace-task-date ${isOverdue(task, board) ? 'overdue' : ''}`}>
          {displayDate(task.dueDate)}
        </span>
      </button>
    )
  }

  return (
    <div className="workspace-view">
      <section className="board-heading workspace-heading">
        <div className="board-heading-copy">
          <div className="board-title-row">
            <span className="workspace-heading-mark" aria-hidden="true">
              {workspaceInitial(workspaceName)}
            </span>
            <h1>{workspaceName}</h1>
          </div>
          <p>Tudo o que está acontecendo nos seus quadros, em um só lugar.</p>
        </div>
        <div className="board-heading-actions">
          <button className="button secondary" onClick={onImport}>
            <Upload size={16} />
            Importar
          </button>
          <button className="button primary" onClick={onCreateBoard}>
            <Plus size={16} />
            Novo quadro
          </button>
        </div>
      </section>

      <section className="board-pulse workspace-pulse" aria-label="Resumo do espaço">
        <div className="pulse-item">
          <span className="stat-icon neutral">
            <ListTodo size={19} />
          </span>
          <div>
            <span>Tarefas abertas</span>
            <strong>
              {String(open.length).padStart(2, '0')}
              <small>em {plural(data.boards.length, 'quadro', 'quadros')}</small>
            </strong>
          </div>
        </div>
        <div className="pulse-item">
          <span className="stat-icon blue">
            <UserRound size={19} />
          </span>
          <div>
            <span>Com você</span>
            <strong>
              {String(mine.length).padStart(2, '0')}
              <small>atribuídas a você</small>
            </strong>
          </div>
        </div>
        <div className="pulse-item">
          <span className="stat-icon red">
            <AlarmClock size={19} />
          </span>
          <div>
            <span>Atrasadas</span>
            <strong>
              {String(overdue.length).padStart(2, '0')}
              <small>{overdue.length ? 'pedem atenção' : 'tudo em dia'}</small>
            </strong>
          </div>
        </div>
        <div className="pulse-progress">
          <div>
            <span>Progresso geral</span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
          <span>
            {completed} de {plural(tasks.length, 'tarefa concluída', 'tarefas concluídas')}
          </span>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="overview-card workspace-boards" aria-labelledby="workspace-boards">
          <div className="section-heading">
            <h2 id="workspace-boards">Quadros</h2>
            <span className="workspace-count">{data.boards.length}</span>
          </div>
          <div className="workspace-board-list">
            {boards.map((board) => {
              const stats = boardStats(board)
              return (
                <button
                  key={board.id}
                  className="workspace-board"
                  onClick={() => onOpenBoard(board.id)}
                  style={{ '--board-color': board.color } as CSSProperties}
                >
                  <span className="workspace-board-top">
                    <span className="workspace-board-icon">
                      <BoardIcon icon={board.icon} size={18} />
                    </span>
                    <strong>{board.name}</strong>
                    {board.favorite && (
                      <Star size={14} className="workspace-board-favorite" aria-label="Favorito" />
                    )}
                  </span>
                  <span className="workspace-board-meta">
                    {plural(stats.total, 'tarefa', 'tarefas')}
                    {stats.late > 0 && <em>{plural(stats.late, 'atrasada', 'atrasadas')}</em>}
                  </span>
                  <span className="workspace-board-progress">
                    <span className="board-completion-track">
                      <i style={{ width: `${stats.percent}%` }} />
                    </span>
                    <small>{stats.percent}%</small>
                  </span>
                </button>
              )
            })}
            <button className="workspace-board workspace-board-new" onClick={onCreateBoard}>
              <Plus size={18} />
              Criar quadro
            </button>
          </div>
        </section>

        <div className="workspace-side">
          <section className="overview-card" aria-labelledby="workspace-mine">
            <div className="section-heading">
              <h2 id="workspace-mine">Minhas tarefas</h2>
              <CircleDashed size={18} />
            </div>
            <p>
              {mine.length
                ? `${plural(mine.length, 'tarefa aberta', 'tarefas abertas')} com você, em todos os quadros.`
                : 'Nenhuma tarefa aberta com você. Aproveite o respiro.'}
            </p>
            {mine.length > 0 && (
              <div className="workspace-task-list">{mine.slice(0, 6).map(taskRow)}</div>
            )}
            {mine.length > 6 && (
              <p className="workspace-more">
                e mais {plural(mine.length - 6, 'tarefa', 'tarefas')}
                <ArrowRight size={13} />
              </p>
            )}
          </section>

          <section className="overview-card" aria-labelledby="workspace-overdue">
            <div className="section-heading">
              <h2 id="workspace-overdue">Atrasadas</h2>
              {overdue.length ? <AlarmClock size={18} /> : <CircleCheck size={18} />}
            </div>
            <p>
              {overdue.length
                ? `${plural(overdue.length, 'tarefa passou', 'tarefas passaram')} do prazo.`
                : 'Nenhum prazo vencido em nenhum quadro.'}
            </p>
            {overdue.length > 0 && (
              <div className="workspace-task-list">
                {[...overdue].sort(byDueDate).slice(0, 6).map(taskRow)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
