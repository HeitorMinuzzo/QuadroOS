import { useMemo, useState } from 'react'
import {
  AlarmClock,
  ArrowRight,
  CircleCheck,
  Clock3,
  Plus,
  Search,
  Star,
  Upload,
} from 'lucide-react'
import {
  isOverdue,
  isTaskDone,
  localDate,
  taskOwnerIds,
  type Board,
  type Task,
  type Workspace,
} from '../../shared/domain'
import { BoardIcon, readRecent } from './Sidebar'
import { boardFolders, workspaceInitial } from '../lib/workspaces'
import { useMe } from '../lib/session'

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
function addDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDate(date)
}
function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
}

type BoardTab = 'favorites' | 'recent' | 'all'
const TAB_KEY = 'quadroos:home-boards-tab'
const MINE_LIMIT = 6
const ATTENTION_LIMIT = 5
const ALL_LIMIT = 12

/**
 * The workspace home: what is yours, what needs attention, and a way back to your boards.
 * Kept deliberately short; the full lists live in Meu trabalho, the notifications and the
 * sidebar tree.
 */
export function WorkspaceView({
  data,
  workspaceName,
  onOpenBoard,
  onOpenTask,
  onCreateBoard,
  onImport,
  onOpenMine,
  onOpenOverdue,
}: {
  data: Workspace
  workspaceName: string
  onOpenBoard: (id: string) => void
  onOpenTask: (id: string) => void
  onCreateBoard: () => void
  onImport: () => void
  onOpenMine: () => void
  onOpenOverdue: () => void
}) {
  const me = useMe()
  const boardById = useMemo(() => new Map(data.boards.map((board) => [board.id, board])), [data])
  // Indicators count main tasks only, as the board overview does.
  const tasks = data.tasks.filter((task) => !task.parentId && boardById.has(task.boardId))
  const done = (task: Task) => isTaskDone(task, boardById.get(task.boardId))
  const open = tasks.filter((task) => !done(task))
  const overdue = open
    .filter((task) => isOverdue(task, boardById.get(task.boardId)))
    // The most recently missed first: those are the ones still worth chasing.
    .sort((a, b) => byDueDate(b, a))
  const mine = open.filter((task) => taskOwnerIds(task).includes(me)).sort(byDueDate)
  const progress = tasks.length
    ? Math.round(((tasks.length - open.length) / tasks.length) * 100)
    : 0

  const firstName = data.people.find((person) => person.id === me)?.name.split(' ')[0]
  const today = localDate()
  const week = addDays(7)
  const mineGroups = [
    {
      label: 'Atrasadas',
      tasks: mine.filter((task) => isOverdue(task, boardById.get(task.boardId))),
    },
    {
      label: 'Hoje',
      tasks: mine.filter(
        (task) => task.dueDate === today && !isOverdue(task, boardById.get(task.boardId)),
      ),
    },
    {
      label: 'Próximos 7 dias',
      tasks: mine.filter((task) => !!task.dueDate && task.dueDate > today && task.dueDate <= week),
    },
    {
      label: 'Mais adiante',
      tasks: mine.filter((task) => !task.dueDate || task.dueDate > week),
    },
  ]
  // Only the first few rows, in group order, so the card stays short.
  let budget = MINE_LIMIT
  const visibleGroups = mineGroups
    .map((group) => {
      const shown = group.tasks.slice(0, Math.max(budget, 0))
      budget -= shown.length
      return { ...group, shown }
    })
    .filter((group) => group.shown.length)

  const favorites = data.boards
    .filter((board) => board.favorite)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const recent = readRecent()
    .map((id) => boardById.get(id))
    .filter((board): board is Board => !!board)
    .slice(0, 8)
  const [tab, setTab] = useState<BoardTab>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as BoardTab | null
      if (saved === 'favorites' || saved === 'recent' || saved === 'all') return saved
    } catch {
      // Storage may be blocked; fall back to the natural default.
    }
    return favorites.length ? 'favorites' : recent.length ? 'recent' : 'all'
  })
  const chooseTab = (next: BoardTab) => {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // Only a convenience.
    }
  }
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const everyBoard = [...data.boards].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const matching = query.trim()
    ? everyBoard.filter((board) =>
        [board.name, ...boardFolders(board).map((folder) => folder.name)]
          .join(' ')
          .toLocaleLowerCase('pt-BR')
          .includes(query.trim().toLocaleLowerCase('pt-BR')),
      )
    : everyBoard
  const listed =
    tab === 'favorites'
      ? favorites
      : tab === 'recent'
        ? recent
        : showAll || query.trim()
          ? matching
          : matching.slice(0, ALL_LIMIT)

  const counts = useMemo(() => {
    const result = new Map<string, { open: number; late: number }>()
    for (const task of open) {
      const entry = result.get(task.boardId) ?? { open: 0, late: 0 }
      entry.open++
      if (isOverdue(task, boardById.get(task.boardId))) entry.late++
      result.set(task.boardId, entry)
    }
    return result
  }, [open, boardById])

  const taskRow = (task: Task) => {
    const board = boardById.get(task.boardId)
    const late = isOverdue(task, board)
    return (
      <li key={task.id}>
        <button className="home-task" onClick={() => onOpenTask(task.id)}>
          <span className="home-task-dot" style={{ background: board?.color }} />
          <span className="home-task-copy">
            <strong>{task.title}</strong>
            <small>{board?.name}</small>
          </span>
          <span className={`home-task-date ${late ? 'overdue' : ''}`}>
            {displayDate(task.dueDate)}
          </span>
        </button>
      </li>
    )
  }

  const boardRow = (board: Board) => {
    const count = counts.get(board.id) ?? { open: 0, late: 0 }
    const path = boardFolders(board)
      .map((folder) => folder.name)
      .join(' / ')
    return (
      <li key={board.id}>
        <button className="home-board" onClick={() => onOpenBoard(board.id)}>
          <span className="home-board-icon" style={{ color: board.color }}>
            <BoardIcon icon={board.icon} size={16} />
          </span>
          <span className="home-board-copy">
            <strong>{board.name}</strong>
            {path && <small>{path}</small>}
          </span>
          <span className="home-board-meta">
            {count.late > 0 && (
              <em aria-label={plural(count.late, 'tarefa atrasada', 'tarefas atrasadas')}>
                {count.late}
              </em>
            )}
            <span>{count.open ? plural(count.open, 'aberta', 'abertas') : 'Em dia'}</span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="workspace-view home">
      <section className="board-heading workspace-heading">
        <div className="board-heading-copy">
          <div className="board-title-row">
            <span className="workspace-heading-mark" aria-hidden="true">
              {workspaceInitial(workspaceName)}
            </span>
            <h1>{workspaceName}</h1>
          </div>
          <p>
            {greeting()}
            {firstName && firstName !== 'Você' ? `, ${firstName}` : ''} ·{' '}
            {new Date().toLocaleDateString('pt-BR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
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

      <section className="home-summary" aria-label="Resumo do espaço">
        <span>
          <strong>{open.length}</strong> {open.length === 1 ? 'tarefa aberta' : 'tarefas abertas'}{' '}
          em {plural(data.boards.length, 'quadro', 'quadros')}
        </span>
        <button
          type="button"
          className={`home-summary-late ${overdue.length ? '' : 'clear'}`}
          onClick={onOpenOverdue}
          disabled={!overdue.length}
        >
          <strong>{overdue.length}</strong> {overdue.length === 1 ? 'atrasada' : 'atrasadas'}
        </button>
        <span className="home-summary-progress">
          <span className="progress-track" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </span>
          <strong>{progress}%</strong> concluído
        </span>
      </section>

      <div className="home-grid">
        <section className="home-card" aria-labelledby="home-mine">
          <header className="home-card-heading">
            <h2 id="home-mine">Para você</h2>
            <button type="button" className="text-button" onClick={onOpenMine}>
              Meu trabalho
              <ArrowRight size={14} />
            </button>
          </header>
          {mine.length ? (
            <>
              {visibleGroups.map((group) => (
                <div key={group.label} className="home-group">
                  <h3>
                    {group.label} <span>{group.tasks.length}</span>
                  </h3>
                  <ul className="home-list">{group.shown.map(taskRow)}</ul>
                </div>
              ))}
              {mine.length > MINE_LIMIT && (
                <button type="button" className="home-more" onClick={onOpenMine}>
                  Ver as {mine.length} tarefas com você
                </button>
              )}
            </>
          ) : (
            <p className="home-empty">
              <CircleCheck size={18} />
              Nenhuma tarefa aberta com você.
            </p>
          )}
        </section>

        <section className="home-card" aria-labelledby="home-attention">
          <header className="home-card-heading">
            <h2 id="home-attention">Precisa de atenção</h2>
            {overdue.length > 0 && <AlarmClock size={17} className="home-attention-icon" />}
          </header>
          {overdue.length ? (
            <>
              <p className="home-card-note">Prazos vencidos mais recentes, em todos os quadros.</p>
              <ul className="home-list">{overdue.slice(0, ATTENTION_LIMIT).map(taskRow)}</ul>
              {overdue.length > ATTENTION_LIMIT && (
                <button type="button" className="home-more" onClick={onOpenOverdue}>
                  Ver todas as {overdue.length} atrasadas
                </button>
              )}
            </>
          ) : (
            <p className="home-empty">
              <CircleCheck size={18} />
              Nenhum prazo vencido. Tudo em dia.
            </p>
          )}
        </section>
      </div>

      <section className="home-card home-boards" aria-labelledby="home-boards">
        <header className="home-card-heading">
          <h2 id="home-boards">Quadros</h2>
          <div className="home-tabs" role="tablist" aria-label="Quais quadros mostrar">
            {(
              [
                ['favorites', 'Favoritos', favorites.length],
                ['recent', 'Recentes', recent.length],
                ['all', 'Todos', data.boards.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={tab === value ? 'active' : ''}
                onClick={() => chooseTab(value)}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
        </header>
        {tab === 'all' && (
          <label className="home-search">
            <Search size={15} />
            <input
              type="search"
              value={query}
              placeholder="Buscar quadro ou pasta…"
              aria-label="Buscar quadro ou pasta"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {listed.length ? (
          <ul className="home-board-list">{listed.map(boardRow)}</ul>
        ) : (
          <p className="home-empty">
            {tab === 'favorites' ? (
              <>
                <Star size={18} />
                Marque a estrela de um quadro para ele aparecer aqui.
              </>
            ) : tab === 'recent' ? (
              <>
                <Clock3 size={18} />
                Os quadros que você abrir aparecem aqui.
              </>
            ) : query.trim() ? (
              'Nenhum quadro com esse nome.'
            ) : (
              'Nenhum quadro neste espaço ainda.'
            )}
          </p>
        )}
        {tab === 'all' && (
          <div className="home-board-footer">
            {!query.trim() && !showAll && matching.length > ALL_LIMIT && (
              <button type="button" className="home-more" onClick={() => setShowAll(true)}>
                Mostrar todos os {matching.length} quadros
              </button>
            )}
            <button type="button" className="home-new-board" onClick={onCreateBoard}>
              <Plus size={16} />
              Criar quadro
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
