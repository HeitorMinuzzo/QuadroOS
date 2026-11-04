import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  PanelLeft,
  ChevronRight,
  Bell,
  Search,
  CircleHelp,
  CloudCheck,
  LoaderCircle,
  TriangleAlert,
  X,
  LayoutGrid,
  Plus,
  FileSpreadsheet,
  CircleCheck,
  Keyboard,
  Trash2,
  ArrowRight,
  Moon,
  Sun,
} from 'lucide-react'
import { api, json } from './api'
import { useEventCallback } from './lib/use-event-callback'
import { shareWorkspace } from './lib/workspace-sharing'
import {
  EMPTY_WORKSPACE,
  type Workspace,
  type Board,
  type Task,
  type Group,
  type TaskPanelTab,
  type Status,
  isOverdue,
} from '../shared/domain'
import { moveAmongSiblings, moveGroupOrder, type TaskPlacement } from '../shared/board-layout'
import { Sidebar } from './components/Sidebar'
import { BoardView, type BoardTab } from './components/BoardView'
import { ImportDialog } from './components/ImportDialog'
import { TaskDrawer } from './components/TaskDrawer'
import { CreateEntity, CreateTask } from './components/Forms'
import { ColumnEditor } from './components/ColumnEditor'
import { WorkspaceView } from './components/WorkspaceView'
import { MyWorkView } from './components/MyWorkView'
import { useTheme, type ThemePreference } from './lib/theme'
import { boardFolders, boardWorkspace, LOCAL_WORKSPACE, listWorkspaces } from './lib/workspaces'
import { Avatar, EmptyState, IconButton, Loading, Modal } from './components/ui'

type ModalName =
  | 'import'
  | 'task'
  | 'board'
  | 'group'
  | 'column'
  | 'help'
  | 'settings'
  | 'notifications'
  | 'delete'
  | null
const WORKSPACE_KEY = 'quadroos:workspace'
type Page = 'board' | 'workspace' | 'mine'
function readRoute() {
  const [, page, boardId = '', view = 'table'] = location.hash.split('/')
  return {
    page: (page === 'workspace' || page === 'mine' ? page : 'board') as Page,
    boardId: decodeURIComponent(boardId),
    tab: (['table', 'kanban', 'calendar', 'overview', 'automations'].includes(view)
      ? view
      : 'table') as BoardTab,
  }
}
export function App() {
  const [data, setData] = useState<Workspace>(EMPTY_WORKSPACE)
  const dataRef = useRef(data)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [route, setRoute] = useState(readRoute)
  const [modal, setModal] = useState<ModalName>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskPanelTab, setTaskPanelTab] = useState<TaskPanelTab>('details')
  const [createGroupId, setCreateGroupId] = useState<string | undefined>()
  const [createStatus, setCreateStatus] = useState<Status | undefined>()
  const [mine, setMine] = useState(false)
  const theme = useTheme()
  const [mobile, setMobile] = useState(false)
  const [saving, setSaving] = useState(0)
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number } | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const transition = useRef<ViewTransition | null>(null)
  const initialLoad = useRef<Promise<void> | null>(null)
  const update = useCallback((next: Workspace) => {
    const shared = shareWorkspace(dataRef.current, next)
    dataRef.current = shared
    setData(shared)
  }, [])
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error, id: Date.now() }),
    [],
  )
  const refresh = useCallback(async () => {
    const value = await api<Workspace>('/workspace')
    update(value)
    setLoadError('')
  }, [update])
  const load = useCallback(() => {
    if (initialLoad.current) return initialLoad.current
    setLoading(true)
    const request = refresh()
      .catch((error) =>
        setLoadError(error instanceof Error ? error.message : 'Não foi possível abrir seu espaço.'),
      )
      .finally(() => {
        setLoading(false)
        initialLoad.current = null
      })
    initialLoad.current = request
    return request
  }, [refresh])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    const handler = () => setRoute(readRoute())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 3500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input,textarea,select,dialog') || document.querySelector('dialog[open]'))
        return
      if (e.key === '?') {
        e.preventDefault()
        setModal('help')
      }
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'k')) {
        e.preventDefault()
        document.getElementById('board-search')?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  const board =
    data.boards.find((b) => b.id === route.boardId) ||
    data.boards.find((b) => b.id === 'board-ti') ||
    data.boards[0]
  const task = data.tasks.find((t) => t.id === taskId)
  const navigate = (id: string, tab: BoardTab = 'table') => {
    setRoute({ page: 'board', boardId: id, tab })
    location.hash = `/board/${encodeURIComponent(id)}/${tab}`
    setMine(false)
    setMobile(false)
  }
  // Workspace pages keep the last board so modals that need one (new task, columns) have a target.
  const navigatePage = (page: Exclude<Page, 'board'>) => {
    setRoute({ page, boardId: board?.id || '', tab: 'table' })
    location.hash = `/${page}`
    setMine(false)
    setMobile(false)
  }
  const navigateWorkspace = () => navigatePage('workspace')
  const [workspaceId, setWorkspaceId] = useState(() => {
    try {
      return localStorage.getItem(WORKSPACE_KEY) || ''
    } catch {
      return ''
    }
  })
  const chooseWorkspace = useCallback((id: string) => {
    setWorkspaceId(id)
    try {
      localStorage.setItem(WORKSPACE_KEY, id)
    } catch {
      // The choice still applies to this visit.
    }
  }, [])
  // Opening a board shows its workspace in the navigation.
  const openBoardWorkspace = route.page === 'board' && board ? boardWorkspace(board).id : ''
  useEffect(() => {
    if (openBoardWorkspace) chooseWorkspace(openBoardWorkspace)
  }, [openBoardWorkspace, chooseWorkspace])
  const workspaces = listWorkspaces(data.boards)
  const currentWorkspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0]
  const workspaceBoardIds = new Set(
    data.boards
      .filter((item) => boardWorkspace(item).id === currentWorkspace.id)
      .map((item) => item.id),
  )
  const workspaceData: Workspace = {
    ...data,
    boards: data.boards.filter((item) => workspaceBoardIds.has(item.id)),
    groups: data.groups.filter((group) => workspaceBoardIds.has(group.boardId)),
    tasks: data.tasks.filter((item) => workspaceBoardIds.has(item.boardId)),
  }
  function patchTask(id: string, changes: Partial<Task>): Promise<boolean> {
    setSaving((count) => count + 1)
    const job = queue.current
      .then(async () => {
        const current = dataRef.current.tasks.find((t) => t.id === id)
        if (!current) return false
        try {
          const updated = await api<Task>(`/tasks/${id}`, {
            method: 'PATCH',
            body: json({ ...changes, version: current.version }),
          })
          if (updated.groupId !== current.groupId) {
            const next = await api<Workspace>('/workspace')
            const destination = next.groups.find((g) => g.id === updated.groupId)
            const commit = () => flushSync(() => update(next))
            if (
              document.startViewTransition &&
              !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ) {
              transition.current?.skipTransition()
              transition.current = document.startViewTransition(commit)
              void transition.current.ready.catch(() => undefined)
              void transition.current.finished.catch(() => undefined)
              await transition.current.updateCallbackDone
            } else commit()
            notify(
              updated.status === 'Feito'
                ? `Tarefa movida para ${destination?.name || 'Concluídas'}.`
                : `Tarefa movida para ${destination?.name || 'seu grupo'}.`,
            )
          } else
            update({
              ...dataRef.current,
              tasks: dataRef.current.tasks.map((t) => (t.id === id ? updated : t)),
            })
          return true
        } catch (e) {
          notify(e instanceof Error ? e.message : 'Não foi possível salvar a tarefa.', true)
          try {
            await refresh()
          } catch {
            /* The error remains visible; local changes are not presented as saved. */
          }
          return false
        }
      })
      .finally(() => setSaving((count) => count - 1))
    queue.current = job.catch(() => undefined)
    return job
  }
  function moveTask(id: string, targetId: string, placement: TaskPlacement): Promise<boolean> {
    setSaving((count) => count + 1)
    const job = queue.current
      .then(async () => {
        const before = dataRef.current
        const task = before.tasks.find((t) => t.id === id)
        if (!task) return false
        const optimistic = moveAmongSiblings(before.tasks, task, targetId, placement)
        update({
          ...before,
          tasks: before.tasks.map((t) => optimistic.find((next) => next.id === t.id) || t),
        })
        try {
          const moved = await api<Task[]>(`/tasks/${id}/move`, {
            method: 'POST',
            body: json({ version: task.version, targetId, placement }),
          })
          update({
            ...dataRef.current,
            tasks: dataRef.current.tasks.map((t) => moved.find((next) => next.id === t.id) || t),
          })
          return true
        } catch (e) {
          update({
            ...dataRef.current,
            tasks: dataRef.current.tasks.map(
              (t) => before.tasks.find((old) => old.id === t.id) || t,
            ),
          })
          notify(e instanceof Error ? e.message : 'Não foi possível mover a tarefa.', true)
          await refresh().catch(() => undefined)
          return false
        }
      })
      .finally(() => setSaving((count) => count - 1))
    queue.current = job.catch(() => undefined)
    return job
  }
  function moveGroup(id: string, targetId: string, placement: TaskPlacement): Promise<boolean> {
    setSaving((count) => count + 1)
    const job = queue.current
      .then(async () => {
        const before = dataRef.current
        const optimistic = moveGroupOrder(before.groups, id, targetId, placement)
        if (!optimistic.length) return false
        update({
          ...before,
          groups: before.groups.map(
            (group) => optimistic.find((next) => next.id === group.id) || group,
          ),
        })
        try {
          const moved = await api<Group[]>(`/groups/${id}/move`, {
            method: 'POST',
            body: json({ targetId, placement }),
          })
          update({
            ...dataRef.current,
            groups: dataRef.current.groups.map((group) => {
              const saved = moved.find((item) => item.id === group.id)
              return saved ? { ...group, position: saved.position } : group
            }),
          })
          return true
        } catch (error) {
          update({
            ...dataRef.current,
            groups: dataRef.current.groups.map((group) => {
              const original = optimistic.some((item) => item.id === group.id)
                ? before.groups.find((item) => item.id === group.id)
                : undefined
              return original ? { ...group, position: original.position } : group
            }),
          })
          notify(error instanceof Error ? error.message : 'Não foi possível mover o grupo.', true)
          await refresh().catch(() => undefined)
          return false
        }
      })
      .finally(() => setSaving((count) => count - 1))
    queue.current = job.catch(() => undefined)
    return job
  }
  function resizeColumns(boardId: string, widths: Record<string, number>): Promise<boolean> {
    setSaving((count) => count + 1)
    const job = queue.current
      .then(async () => {
        try {
          const updated = await api<Board>(`/boards/${boardId}/column-widths`, {
            method: 'PATCH',
            body: json({ widths }),
          })
          update({
            ...dataRef.current,
            boards: dataRef.current.boards.map((b) => (b.id === boardId ? updated : b)),
          })
          return true
        } catch (e) {
          notify(
            e instanceof Error ? e.message : 'Não foi possível salvar a largura das colunas.',
            true,
          )
          return false
        }
      })
      .finally(() => setSaving((count) => count - 1))
    queue.current = job.catch(() => undefined)
    return job
  }
  async function favorite() {
    if (!board) return
    try {
      await api(`/boards/${board.id}`, {
        method: 'PATCH',
        body: json({ favorite: !board.favorite }),
      })
      await refresh()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível atualizar os favoritos.', true)
    }
  }
  const askDelete = (ids: string[]) => {
    setDeleteIds(ids)
    setTaskId(null)
    setModal('delete')
  }
  async function removeTasks() {
    setDeleting(true)
    try {
      await queue.current
      await api('/tasks', { method: 'DELETE', body: json({ ids: deleteIds }) })
      await refresh()
      setModal(null)
      setDeleteIds([])
      notify('Tarefas excluídas.')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Não foi possível excluir.', true)
    } finally {
      setDeleting(false)
    }
  }
  const openTask = (id: string, tab: TaskPanelTab = 'details') => {
    setTaskPanelTab(tab)
    setTaskId(id)
    setModal(null)
  }
  const overdue = data.tasks.filter(
    (t) =>
      !t.parentId &&
      isOverdue(
        t,
        data.boards.find((board) => board.id === t.boardId),
      ),
  )
  const closeModal = () => setModal(null)
  const boardActions = {
    setTab: useEventCallback((tab: BoardTab) => {
      if (board) navigate(board.id, tab)
    }),
    onClearMine: useEventCallback(() => setMine(false)),
    onNewTask: useEventCallback((groupId?: string, status?: Status) => {
      setCreateGroupId(groupId)
      setCreateStatus(status)
      setModal('task')
    }),
    onNewGroup: useEventCallback(() => setModal('group')),
    onNewColumn: useEventCallback(() => setModal('column')),
    onImport: useEventCallback(() => setModal('import')),
    onOpenTask: useEventCallback(openTask),
    onPatch: useEventCallback(patchTask),
    onMoveTask: useEventCallback(moveTask),
    onMoveGroup: useEventCallback(moveGroup),
    onResizeColumns: useEventCallback(resizeColumns),
    onDelete: useEventCallback(askDelete),
    onFavorite: useEventCallback(() => void favorite()),
  }
  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        Pular para o conteúdo
      </a>
      <Sidebar
        data={data}
        activeId={route.page === 'board' ? board?.id || '' : ''}
        page={route.page}
        workspaceId={currentWorkspace.id}
        overdueCount={overdue.length}
        onWorkspace={chooseWorkspace}
        onOverdue={() => setModal('notifications')}
        onBoard={(id) => navigate(id)}
        onOverview={navigateWorkspace}
        onMine={() => navigatePage('mine')}
        onImport={() => setModal('import')}
        onCreate={() => setModal('board')}
        onHelp={() => setModal('help')}
        onSettings={() => setModal('settings')}
        mobile={mobile}
        onClose={() => setMobile(false)}
      />
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <IconButton
              label="Abrir navegação"
              className="icon-button mobile-menu"
              onClick={() => setMobile(true)}
            >
              <PanelLeft size={19} />
            </IconButton>
            {route.page === 'workspace' ? (
              <strong>{currentWorkspace.name}</strong>
            ) : route.page === 'mine' ? (
              <>
                <button className="breadcrumb-link" onClick={navigateWorkspace}>
                  {currentWorkspace.name}
                </button>
                <ChevronRight size={13} />
                <strong>Meu trabalho</strong>
              </>
            ) : (
              <>
                <button className="breadcrumb-link" onClick={navigateWorkspace}>
                  {board ? boardWorkspace(board).name : currentWorkspace.name}
                </button>
                {board && boardFolders(board).length > 0 && (
                  <>
                    <ChevronRight size={13} />
                    <span className="board-folder-breadcrumb">
                      {boardFolders(board)
                        .map((folder) => folder.name)
                        .join(' / ')}
                    </span>
                  </>
                )}
                <ChevronRight size={13} />
                <strong>{board?.name || 'Boas-vindas'}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <span className={`save-state ${saving ? 'saving' : ''}`} role="status">
              {saving ? <LoaderCircle size={14} className="spin" /> : <CloudCheck size={15} />}
              {saving ? 'Salvando…' : 'Tudo salvo'}
            </span>
            <span className="topbar-separator" />
            <IconButton
              label="Buscar tarefas"
              onClick={() => {
                if (board) {
                  navigate(board.id, 'table')
                  setTimeout(() => document.getElementById('board-search')?.focus(), 0)
                }
              }}
            >
              <Search size={18} />
            </IconButton>
            <IconButton
              label={theme.resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              onClick={() => theme.choose(theme.resolved === 'dark' ? 'light' : 'dark')}
            >
              {theme.resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
            <IconButton label="Abrir guia rápido" onClick={() => setModal('help')}>
              <CircleHelp size={18} />
            </IconButton>
            <button
              className="icon-button notification-button"
              aria-label={`Notificações: ${overdue.length} tarefas atrasadas`}
              onClick={() => setModal('notifications')}
            >
              <Bell size={18} />
              {overdue.length > 0 && <i />}
            </button>
            <Avatar person={data.people.find((p) => p.id === 'person-you')} small />
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {loading ? (
            <Loading />
          ) : loadError ? (
            <EmptyState
              icon={<TriangleAlert size={30} />}
              title="Seu espaço está a um passo."
              description={loadError}
              action={
                <button className="button primary" onClick={() => void load()}>
                  Tentar novamente
                </button>
              }
            />
          ) : route.page === 'mine' ? (
            <MyWorkView
              data={data}
              onOpenTask={openTask}
              onOpenBoard={navigateMine}
              onPatch={patchTask}
            />
          ) : route.page === 'workspace' ? (
            <WorkspaceView
              data={workspaceData}
              workspaceName={currentWorkspace.name}
              onOpenBoard={(id) => navigate(id)}
              onOpenTask={openTask}
              onCreateBoard={() => setModal('board')}
              onImport={() => setModal('import')}
            />
          ) : board ? (
            <BoardView
              data={data}
              board={board}
              tab={route.tab}
              onlyMine={mine}
              {...boardActions}
              onRefresh={refresh}
            />
          ) : (
            <EmptyState
              icon={<LayoutGrid size={32} />}
              title="O próximo passo começa aqui."
              description="Crie seu primeiro quadro ou traga os dados que você já tem."
              action={
                <div className="empty-actions">
                  <button className="button primary" onClick={() => setModal('board')}>
                    <Plus size={17} />
                    Criar meu primeiro quadro
                  </button>
                  <button className="button secondary" onClick={() => setModal('import')}>
                    Importar dados
                  </button>
                </div>
              }
            />
          )}
        </main>
      </div>
      {modal === 'import' && (
        <ImportDialog
          data={data}
          activeBoardId={board?.id || ''}
          onClose={closeModal}
          onApplied={refresh}
          onOpenBoard={(id) => navigate(id)}
        />
      )}
      {modal === 'task' && board && (
        <CreateTask
          board={board}
          data={data}
          groupId={createGroupId}
          initialStatus={createStatus}
          onClose={closeModal}
          onCreated={refresh}
        />
      )}
      {modal === 'column' && board && (
        <ColumnEditor board={board} onClose={closeModal} onRefresh={refresh} />
      )}
      {(modal === 'board' || modal === 'group') && (
        <CreateEntity
          kind={modal}
          board={board}
          onClose={closeModal}
          onCreated={async (id) => {
            // A board created here joins the workspace that is open in the navigation.
            if (modal === 'board' && id && currentWorkspace.id !== LOCAL_WORKSPACE.id)
              await api(`/boards/${id}`, {
                method: 'PATCH',
                body: json({
                  settings: {
                    mondayFolderPath: [{ id: currentWorkspace.id, name: currentWorkspace.name }],
                  },
                }),
              }).catch(() => undefined)
            await refresh()
            if (id) navigate(id)
            notify(
              modal === 'board'
                ? 'Seu novo quadro está pronto.'
                : modal === 'group'
                  ? 'Grupo criado. Mais espaço para organizar.'
                  : 'Coluna adicionada ao quadro.',
            )
          }}
        />
      )}
      {task && (
        <TaskDrawer
          key={task.id}
          task={task}
          initialTab={taskPanelTab}
          data={data}
          onClose={() => setTaskId(null)}
          onPatch={patchTask}
          onMoveTask={moveTask}
          onRefresh={refresh}
          onDelete={askDelete}
          onOpenTask={openTask}
        />
      )}
      {modal === 'delete' && (
        <Modal
          title="Excluir estas tarefas?"
          subtitle={`${deleteIds.length} tarefa${deleteIds.length > 1 ? 's' : ''}, seus subitens e comentários serão removidos. Essa ação não pode ser desfeita.`}
          onClose={closeModal}
        >
          <div className="standard-form">
            <footer className="modal-footer">
              <button className="button ghost" disabled={deleting} onClick={closeModal}>
                Manter tarefas
              </button>
              <button
                className="button danger-button"
                disabled={deleting}
                onClick={() => void removeTasks()}
              >
                {deleting ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
                Excluir tarefas
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {modal === 'notifications' && (
        <Modal
          title="Notificações"
          subtitle="Prazos que merecem a sua atenção."
          onClose={closeModal}
        >
          <div className="notification-list">
            {overdue.length ? (
              overdue.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    navigate(t.boardId)
                    openTask(t.id)
                  }}
                >
                  <span className="notification-icon">
                    <Bell size={17} />
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {data.boards.find((b) => b.id === t.boardId)?.name} · Prazo{' '}
                      {new Date(`${t.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <EmptyState
                icon={<CircleCheck size={30} />}
                title="Tudo em dia por aqui."
                description="Nenhuma tarefa com prazo vencido. Um respiro para o próximo passo."
              />
            )}
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal
          title="Guia do QuadroOS"
          subtitle="Um pequeno guia para fazer do QuadroOS o seu espaço."
          onClose={closeModal}
        >
          <div className="guide-content">
            <div>
              <span>
                <LayoutGrid size={20} />
              </span>
              <section>
                <h3>Organize em quadros e grupos</h3>
                <p>
                  Um quadro para cada projeto. Grupos para separar etapas, semanas ou o que fizer
                  sentido para você.
                </p>
              </section>
            </div>
            <div>
              <span>
                <CircleCheck size={20} />
              </span>
              <section>
                <h3>Edite sem sair do lugar</h3>
                <p>
                  Dê dois cliques no título para editar. Segure e arraste o título ou o puxador para
                  mudar a ordem no grupo. Arraste a borda de uma coluna para ajustar a largura. As
                  alterações são salvas automaticamente. Abra a seta de uma tarefa para adicionar
                  contexto e comentários.
                </p>
              </section>
            </div>
            <div>
              <span>
                <FileSpreadsheet size={20} />
              </span>
              <section>
                <h3>Seu trabalho vem junto</h3>
                <p>
                  Importe um CSV, Excel ou conecte seu monday. Confira as colunas antes de trazer os
                  dados.
                </p>
                <button className="text-button" onClick={() => setModal('import')}>
                  Importar meus dados
                  <ArrowRight size={14} />
                </button>
              </section>
            </div>
            <div>
              <span>
                <Keyboard size={20} />
              </span>
              <section>
                <h3>Um atalho para o que importa</h3>
                <p>
                  <kbd>/</kbd> Buscar no quadro <kbd>?</kbd> Abrir este guia <kbd>Esc</kbd> Fechar
                  janelas
                </p>
              </section>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'settings' && (
        <Modal
          title="Configurações do workspace"
          subtitle="QuadroOS · Versão 0.1.0 alpha"
          onClose={closeModal}
        >
          <div className="settings-content">
            <div className="settings-brand">
              <span className="brand-symbol">
                <i />
                <i />
                <i />
              </span>
              <div>
                <strong>QuadroOS</strong>
                <p>Seu espaço de trabalho, aberto e conectado.</p>
              </div>
            </div>
            <dl>
              <div>
                <dt>Ambiente</dt>
                <dd>Workspace local · usuário único</dd>
              </div>
              <div>
                <dt>Persistência</dt>
                <dd>{data.database}</dd>
              </div>
              <div>
                <dt>Idioma</dt>
                <dd>Português do Brasil</dd>
              </div>
            </dl>
            <fieldset className="theme-choice">
              <legend>Aparência</legend>
              <div className="view-tabs" role="radiogroup" aria-label="Tema">
                {(
                  [
                    ['light', 'Claro', Sun],
                    ['dark', 'Escuro', Moon],
                    ['system', 'Automático', null],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme.preference === value}
                    className={theme.preference === value ? 'active' : ''}
                    onClick={() => theme.choose(value as ThemePreference)}
                  >
                    {Icon && <Icon size={15} />}
                    {label}
                  </button>
                ))}
              </div>
              <p>Claro é o padrão. Automático segue o tema do seu sistema.</p>
            </fieldset>
            <div className="notice">
              Esta primeira versão usa um perfil local. Login, convites e permissões por equipe
              estão previstos para a próxima etapa.
            </div>
            <button className="button secondary" onClick={() => setModal('help')}>
              <CircleHelp size={16} />
              Conhecer o QuadroOS
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <TriangleAlert size={18} /> : <CircleCheck size={18} />}
          <span>{toast.message}</span>
          <IconButton label="Dispensar mensagem" onClick={() => setToast(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  )
  function navigateMine(id: string) {
    setRoute({ page: 'board', boardId: id, tab: 'table' })
    location.hash = `/board/${encodeURIComponent(id)}/table`
    setMine(true)
    setMobile(false)
  }
}
