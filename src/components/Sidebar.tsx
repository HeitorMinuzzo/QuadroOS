import { taskOwnerIds, isTaskDone } from '../../shared/domain'
import {
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Plus,
  House,
  CircleCheck,
  FolderClosed,
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  CircleHelp,
  Paintbrush,
  Megaphone,
  Settings2,
  Star,
  Search,
  X,
  AlarmClock,
  Check,
  History,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { type Board, type MondayFolder, type Workspace } from '../../shared/domain'
import { Avatar, IconButton } from './ui'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  boardFolders,
  boardWorkspace,
  isArchivedFolder,
  listWorkspaces,
  workspaceInitial,
} from '../lib/workspaces'

export function BoardIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const Icon = icon === 'design' ? Paintbrush : icon === 'marketing' ? Megaphone : LayoutGrid
  return <Icon size={size} aria-hidden="true" />
}

interface BoardFolder {
  folder: MondayFolder
  boards: Board[]
  children: Map<string, BoardFolder>
}

const RECENT_KEY = 'quadroos:recent-boards'
function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}
// Rail swatches for workspaces, picked by position so neighbours never share a colour.
const WORKSPACE_COLORS = ['#5a63e0', '#0f8a6a', '#c2621c', '#a53d78', '#2f6fb3', '#6b7287']

function countBoards(branch: BoardFolder): number {
  let total = branch.boards.length
  for (const child of branch.children.values()) total += countBoards(child)
  return total
}

function FolderBranch({
  branch,
  open,
  onToggle,
  renderBoard,
}: {
  branch: BoardFolder
  open: (id: string) => boolean
  onToggle: (id: string) => void
  renderBoard: (board: Board) => ReactNode
}) {
  const expanded = open(branch.folder.id)
  const archived = isArchivedFolder(branch.folder)
  return (
    <div>
      <button
        type="button"
        className={`folder-item imported-folder-item ${archived ? 'archived-folder' : ''}`}
        onClick={() => onToggle(branch.folder.id)}
        aria-expanded={expanded}
        title={branch.folder.name}
      >
        <ChevronRight size={14} className="folder-chevron" />
        {archived ? <Archive size={16} /> : <FolderClosed size={16} />}
        <span className="imported-folder-name">{branch.folder.name}</span>
        <span className="folder-count" aria-hidden="true">
          {countBoards(branch)}
        </span>
      </button>
      {expanded && (
        <div className="board-nav">
          {sortedChildren(branch).map((child) => (
            <FolderBranch
              key={child.folder.id}
              branch={child}
              open={open}
              onToggle={onToggle}
              renderBoard={renderBoard}
            />
          ))}
          {branch.boards.map(renderBoard)}
        </div>
      )}
    </div>
  )
}
// Archived boards always come after the active folders.
function sortedChildren(branch: BoardFolder) {
  return [...branch.children.values()].sort(
    (a, b) => Number(isArchivedFolder(a.folder)) - Number(isArchivedFolder(b.folder)),
  )
}

export function Sidebar({
  data,
  activeId,
  page,
  workspaceId,
  overdueCount,
  onWorkspace,
  onBoard,
  onOverview,
  onMine,
  onOverdue,
  onImport,
  onCreate,
  onHelp,
  onSettings,
  mobile,
  onClose,
}: {
  data: Workspace
  activeId: string
  page: 'board' | 'workspace' | 'mine'
  workspaceId: string
  overdueCount: number
  onWorkspace: (id: string) => void
  onBoard: (id: string) => void
  onOverview: () => void
  onMine: () => void
  onOverdue: () => void
  onImport: () => void
  onCreate: () => void
  onHelp: () => void
  onSettings: () => void
  mobile: boolean
  onClose: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState(readRecent)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (mobile) setCollapsed(false)
  }, [mobile])
  useEffect(() => {
    if (!activeId) return
    setRecent((previous) => {
      const next = [activeId, ...previous.filter((id) => id !== activeId)].slice(0, 8)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // Recents are a convenience; the list still works for this session.
      }
      return next
    })
  }, [activeId])

  const workspaces = listWorkspaces(data.boards)
  const current = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0]
  const inWorkspace = data.boards.filter((board) => boardWorkspace(board).id === current.id)
  const query = search.trim().toLocaleLowerCase('pt-BR')
  const boards = inWorkspace.filter((board) =>
    [board.name, ...boardFolders(board).map((folder) => folder.name)].some((name) =>
      name.toLocaleLowerCase('pt-BR').includes(query),
    ),
  )
  const root: BoardFolder = { folder: current, boards: [], children: new Map() }
  for (const board of boards) {
    let branch = root
    for (const folder of boardFolders(board)) {
      let child = branch.children.get(folder.id)
      if (!child) {
        child = { folder, boards: [], children: new Map() }
        branch.children.set(folder.id, child)
      }
      branch = child
    }
    branch.boards.push(board)
  }
  // Folders start closed, except the ones leading to the open board; a search opens all.
  const activeBoard = data.boards.find((board) => board.id === activeId)
  const activePath = new Set(
    activeBoard ? boardFolders(activeBoard).map((folder) => folder.id) : [],
  )
  const isOpen = (id: string) => (query ? true : (toggled[id] ?? activePath.has(id)))
  const toggle = (id: string) => setToggled((previous) => ({ ...previous, [id]: !isOpen(id) }))

  const go = (action: () => void) => () => {
    action()
    onClose()
  }
  const renderBoard = (board: Board, className = '') => (
    <button
      key={board.id}
      className={`nav-item board-nav-item ${className} ${activeId === board.id ? 'selected' : ''}`}
      aria-current={activeId === board.id ? 'page' : undefined}
      onClick={go(() => onBoard(board.id))}
    >
      <span className="board-dot" style={{ background: board.color }} />
      <span className="board-nav-title">{board.name}</span>
    </button>
  )
  const favorites = inWorkspace.filter((board) => board.favorite)
  const recentBoards = recent
    .map((id) => inWorkspace.find((board) => board.id === id))
    .filter((board): board is Board => !!board && !board.favorite && board.id !== activeId)
    .slice(0, 4)
  const boardById = new Map(data.boards.map((board) => [board.id, board]))
  // Same scope as the Meu trabalho page: open main tasks assigned to you on every board.
  const mineCount = data.tasks.filter(
    (t) =>
      !t.parentId &&
      boardById.has(t.boardId) &&
      taskOwnerIds(t).includes('person-you') &&
      !isTaskDone(t, boardById.get(t.boardId)),
  ).length

  return (
    <>
      <div className={`sidebar-scrim ${mobile ? 'visible' : ''}`} onClick={onClose} />
      <aside
        className={`sidebar ${mobile ? 'mobile-open' : ''} ${collapsed ? 'is-compact' : ''}`}
        aria-label="Navegação principal"
      >
        <nav className="app-rail" aria-label="Workspaces">
          <button className="rail-brand" onClick={go(onOverview)} aria-label="QuadroOS — início">
            <span />
            <span />
            <span />
            <span />
          </button>
          <div className="rail-workspaces">
            {workspaces.map((workspace, index) => (
              <Tooltip key={workspace.id}>
                <TooltipTrigger asChild>
                  <button
                    className={`rail-workspace ${workspace.id === current.id ? 'active' : ''}`}
                    aria-label={`Workspace ${workspace.name}`}
                    aria-pressed={workspace.id === current.id}
                    style={{ background: WORKSPACE_COLORS[index % WORKSPACE_COLORS.length] }}
                    onClick={() => {
                      onWorkspace(workspace.id)
                      setCollapsed(false)
                    }}
                  >
                    {workspaceInitial(workspace.name)}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {workspace.name} · {workspace.boards}{' '}
                  {workspace.boards === 1 ? 'quadro' : 'quadros'}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="rail-bottom">
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="rail-button" aria-label="Ajuda do QuadroOS" onClick={onHelp}>
                  <CircleHelp size={21} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Ajuda e atalhos</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rail-profile"
                  aria-label="Configurações do workspace"
                  onClick={onSettings}
                >
                  <Avatar person={data.people.find((p) => p.id === 'person-you')} small />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Preferências</TooltipContent>
            </Tooltip>
          </div>
        </nav>
        <div className="workspace-panel">
          <header className="workspace-panel-header">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="workspace-title" aria-label={`Workspace: ${current.name}`}>
                  <span>{current.name}</span>
                  <ChevronDown size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="workspace-menu">
                <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                {workspaces.map((workspace) => (
                  <DropdownMenuItem key={workspace.id} onSelect={() => onWorkspace(workspace.id)}>
                    <span className="workspace-menu-name">{workspace.name}</span>
                    <span className="workspace-menu-count">{workspace.boards}</span>
                    {workspace.id === current.id && <Check />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSettings}>
                  <Settings2 />
                  Preferências do workspace
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              label="Recolher lista de quadros"
              className="icon-button desktop-collapse"
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose size={18} />
            </IconButton>
            <IconButton
              label="Fechar navegação"
              className="icon-button sidebar-close"
              onClick={onClose}
            >
              <X size={20} />
            </IconButton>
          </header>
          <div className="sidebar-scroll">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="sidebar-new">
                  <Plus size={16} />
                  Novo
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="sidebar-new-menu">
                <DropdownMenuItem onSelect={go(onCreate)}>
                  <LayoutGrid />
                  Criar novo quadro
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={go(onImport)}>
                  <Download />
                  Importar dados
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <nav className="main-nav" aria-label="Meu workspace">
              <button
                className={`nav-item ${page === 'workspace' ? 'active' : ''}`}
                aria-current={page === 'workspace' ? 'page' : undefined}
                onClick={go(onOverview)}
              >
                <House size={17} />
                Início
              </button>
              <button
                className={`nav-item ${page === 'mine' ? 'active' : ''}`}
                aria-current={page === 'mine' ? 'page' : undefined}
                onClick={go(onMine)}
              >
                <CircleCheck size={17} />
                Meu trabalho<span className="nav-count">{mineCount}</span>
              </button>
              <button className="nav-item" onClick={go(onOverdue)}>
                <AlarmClock size={17} />
                Atrasadas
                <span className={`nav-count ${overdueCount ? 'is-alert' : ''}`}>
                  {overdueCount}
                </span>
              </button>
            </nav>
            <label className="sidebar-search">
              <Search size={15} />
              <input
                aria-label="Buscar quadros"
                placeholder="Buscar quadros"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="Limpar busca de quadros" onClick={() => setSearch('')}>
                  <X size={13} />
                </button>
              )}
            </label>
            {!query && favorites.length > 0 && (
              <section className="sidebar-section" aria-label="Quadros favoritos">
                <div className="sidebar-label">
                  <span>
                    <Star size={13} />
                    Favoritos
                  </span>
                </div>
                {favorites.map((board) => renderBoard(board, 'favorite-item'))}
              </section>
            )}
            {!query && recentBoards.length > 0 && (
              <section className="sidebar-section" aria-label="Quadros recentes">
                <div className="sidebar-label">
                  <span>
                    <History size={13} />
                    Recentes
                  </span>
                </div>
                {recentBoards.map((board) => renderBoard(board))}
              </section>
            )}
            <div className="sidebar-label boards-label">
              <span>Quadros</span>
              <IconButton label="Criar quadro" onClick={go(onCreate)}>
                <Plus size={16} />
              </IconButton>
            </div>
            {root.boards.length > 0 && (
              <nav className="root-boards" aria-label="Quadros">
                {root.boards.map((board) => renderBoard(board))}
              </nav>
            )}
            {root.children.size > 0 && (
              <nav aria-label="Pastas importadas do Monday">
                {sortedChildren(root).map((child) => (
                  <FolderBranch
                    key={child.folder.id}
                    branch={child}
                    open={isOpen}
                    onToggle={toggle}
                    renderBoard={(board) => renderBoard(board)}
                  />
                ))}
              </nav>
            )}
            {!boards.length && (
              <p className="sidebar-empty">
                {query ? 'Nenhum quadro encontrado.' : 'Nenhum quadro neste workspace ainda.'}
              </p>
            )}
          </div>
        </div>
        {collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="expand-workspace"
                aria-label="Expandir lista de quadros"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen size={19} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expandir navegação</TooltipContent>
          </Tooltip>
        )}
      </aside>
    </>
  )
}
