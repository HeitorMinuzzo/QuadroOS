import { taskOwnerIds, isTaskDone } from '../../shared/domain'
import {
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  Plus,
  House,
  CircleCheck,
  FolderClosed,
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
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Board, type Workspace } from '../../shared/domain'
import type { ReactNode } from 'react'
import { Avatar, IconButton } from './ui'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip'

export function BoardIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const Icon = icon === 'design' ? Paintbrush : icon === 'marketing' ? Megaphone : LayoutGrid
  return <Icon size={size} aria-hidden="true" />
}

interface BoardFolder {
  name: string
  boards: Board[]
  children: Map<string, BoardFolder>
}

function FolderBranch({
  folder,
  renderBoard,
}: {
  folder: BoardFolder
  renderBoard: (board: Board) => ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        className="folder-item imported-folder-item"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={folder.name}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FolderClosed size={16} />
        <span className="imported-folder-name">{folder.name}</span>
      </button>
      {open && (
        <div className="board-nav">
          {[...folder.children].map(([id, child]) => (
            <FolderBranch key={id} folder={child} renderBoard={renderBoard} />
          ))}
          {folder.boards.map(renderBoard)}
        </div>
      )}
    </div>
  )
}

export function Sidebar({
  data,
  activeId,
  lastBoardId,
  page,
  onBoard,
  onOverview,
  onMine,
  onImport,
  onCreate,
  onHelp,
  onSettings,
  mobile,
  onClose,
}: {
  data: Workspace
  activeId: string
  lastBoardId: string
  page: 'board' | 'workspace' | 'mine'
  onBoard: (id: string) => void
  onOverview: () => void
  onMine: () => void
  onImport: () => void
  onCreate: () => void
  onHelp: () => void
  onSettings: () => void
  mobile: boolean
  onClose: () => void
}) {
  const [folderOpen, setFolderOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (mobile) setCollapsed(false)
  }, [mobile])
  const query = search.trim().toLocaleLowerCase('pt-BR')
  const boards = data.boards.filter((board) =>
    [board.name, ...(board.settings?.mondayFolderPath ?? []).map((folder) => folder.name)].some(
      (name) => name.toLocaleLowerCase('pt-BR').includes(query),
    ),
  )
  const root: BoardFolder = { name: '', boards: [], children: new Map() }
  for (const board of boards) {
    let branch = root
    for (const folder of board.settings?.mondayFolderPath ?? []) {
      let child = branch.children.get(folder.id)
      if (!child) {
        child = { name: folder.name, boards: [], children: new Map() }
        branch.children.set(folder.id, child)
      }
      branch = child
    }
    branch.boards.push(board)
  }
  const renderBoard = (board: Board) => (
    <button
      key={board.id}
      className={`nav-item board-nav-item ${activeId === board.id ? 'selected' : ''}`}
      aria-current={activeId === board.id ? 'page' : undefined}
      onClick={() => {
        onBoard(board.id)
        onClose()
      }}
    >
      <BoardIcon icon={board.icon} />
      <span className="board-nav-title">{board.name}</span>
      <span className="board-nav-color" style={{ background: board.color }} />
    </button>
  )
  const favorites = boards.filter((b) => b.favorite)
  const boardById = new Map(data.boards.map((board) => [board.id, board]))
  // Same scope as the Meu trabalho page: open main tasks assigned to you on every board.
  const mineCount = data.tasks.filter(
    (t) =>
      !t.parentId &&
      boardById.has(t.boardId) &&
      taskOwnerIds(t).includes('person-you') &&
      !isTaskDone(
        t,
        data.boards.find((board) => board.id === t.boardId),
      ),
  ).length
  const railActions = [
    { label: 'Resumo do workspace', icon: House, action: onOverview, active: page === 'workspace' },
    {
      label: 'Abrir quadro atual',
      icon: LayoutGrid,
      action: () => {
        if (lastBoardId) onBoard(lastBoardId)
      },
      active: page === 'board',
    },
    { label: 'Abrir minhas tarefas', icon: CircleCheck, action: onMine, active: page === 'mine' },
    { label: 'Trazer dados', icon: Download, action: onImport, active: false },
  ]
  return (
    <>
      <div className={`sidebar-scrim ${mobile ? 'visible' : ''}`} onClick={onClose} />
      <aside
        className={`sidebar ${mobile ? 'mobile-open' : ''} ${collapsed ? 'is-compact' : ''}`}
        aria-label="Navegação principal"
      >
        <nav className="app-rail" aria-label="Aplicativo">
          <button className="rail-brand" onClick={onOverview} aria-label="QuadroOS — início">
            <span />
            <span />
            <span />
            <span />
          </button>
          <div className="rail-actions">
            {railActions.map(({ label, icon: Icon, action, active }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <button
                    className={`rail-button ${active ? 'active' : ''}`}
                    aria-label={label}
                    onClick={() => {
                      action()
                      onClose()
                    }}
                  >
                    <Icon size={21} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {label}
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
            <button
              className="rail-profile"
              aria-label="Configurações do workspace"
              onClick={onSettings}
            >
              <Avatar person={data.people.find((p) => p.id === 'person-you')} small />
            </button>
          </div>
        </nav>
        <div className="workspace-panel">
          <header className="workspace-panel-header">
            <div className="brand">
              quadro<span className="brand-os">OS</span>
              <span className="alpha-tag">alpha</span>
            </div>
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
            <nav className="main-nav" aria-label="Meu workspace">
              <button
                className={`nav-item ${page === 'workspace' ? 'active' : ''}`}
                aria-current={page === 'workspace' ? 'page' : undefined}
                onClick={() => {
                  onOverview()
                  onClose()
                }}
              >
                <House size={17} />
                Visão do espaço
              </button>
              <button
                className={`nav-item ${page === 'mine' ? 'active' : ''}`}
                aria-current={page === 'mine' ? 'page' : undefined}
                onClick={() => {
                  onMine()
                  onClose()
                }}
              >
                <CircleCheck size={17} />
                Meu trabalho<span className="nav-count">{mineCount}</span>
              </button>
              <button className="nav-item" onClick={onImport}>
                <Download size={17} />
                Importações
              </button>
            </nav>
            {favorites.length > 0 && (
              <>
                <div className="sidebar-label favorites-label">
                  <span>
                    <Star size={14} />
                    Favoritos
                  </span>
                </div>
                <nav aria-label="Quadros favoritos">
                  {favorites.map((board) => (
                    <button
                      key={board.id}
                      className="nav-item favorite-item"
                      onClick={() => {
                        onBoard(board.id)
                        onClose()
                      }}
                    >
                      <span className="board-dot" style={{ background: board.color }} />
                      <span className="board-nav-title">{board.name}</span>
                    </button>
                  ))}
                </nav>
              </>
            )}
            <div className="sidebar-section-divider" />
            <div className="sidebar-label boards-label">
              <span>Área de trabalho</span>
              <IconButton label="Criar quadro" onClick={onCreate}>
                <Plus size={16} />
              </IconButton>
            </div>
            <div className="workspace-switch">
              <span className="workspace-avatar">Q</span>
              <div className="workspace-switch-copy">
                <strong>Meu espaço</strong>
                <span>{data.boards.length} quadros · pessoal</span>
              </div>
            </div>
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
            <button
              className="folder-item"
              onClick={() => setFolderOpen(!folderOpen)}
              aria-expanded={folderOpen}
            >
              {folderOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <FolderClosed size={16} />
              Projetos da equipe<span>{root.boards.length}</span>
            </button>
            {folderOpen && (
              <nav className="board-nav" aria-label="Quadros">
                {root.boards.map(renderBoard)}
              </nav>
            )}
            {root.children.size > 0 && (
              <nav aria-label="Pastas importadas do Monday" key={query ? 'search' : 'browse'}>
                {[...root.children].map(([id, folder]) => (
                  <FolderBranch key={id} folder={folder} renderBoard={renderBoard} />
                ))}
              </nav>
            )}
            {search && !boards.length && <p className="sidebar-empty">Nenhum quadro encontrado.</p>}
            <button className="add-board" onClick={onCreate}>
              <Plus size={16} />
              Criar novo quadro
            </button>
          </div>
          <footer className="sidebar-bottom">
            <button className="sidebar-settings" onClick={onSettings}>
              <Settings2 size={15} />
              <span>Preferências do workspace</span>
            </button>
          </footer>
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
