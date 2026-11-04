import type { Board, MondayFolder } from '../../shared/domain'

/** Boards created here, or imported before workspaces were recorded, live in this workspace. */
export const LOCAL_WORKSPACE: MondayFolder = { id: 'local', name: 'Meu espaço' }

const isWorkspace = (folder?: MondayFolder) => !!folder?.id.startsWith('workspace:')

export function boardWorkspace(board: Board): MondayFolder {
  const first = board.settings?.mondayFolderPath?.[0]
  return isWorkspace(first) ? first! : LOCAL_WORKSPACE
}

/** The folder path inside the board's workspace. */
export function boardFolders(board: Board): MondayFolder[] {
  const path = board.settings?.mondayFolderPath ?? []
  return isWorkspace(path[0]) ? path.slice(1) : path
}

export function isArchivedFolder(folder: MondayFolder) {
  return folder.id.startsWith('archived:')
}

/** Workspaces in the order their boards appear; the local one only when it has boards. */
export function listWorkspaces(boards: Board[]) {
  const found = new Map<string, MondayFolder & { boards: number }>()
  for (const board of boards) {
    const workspace = boardWorkspace(board)
    const entry = found.get(workspace.id) ?? { ...workspace, boards: 0 }
    entry.boards++
    found.set(workspace.id, entry)
  }
  const list = [...found.values()].sort(
    (a, b) => Number(a.id === LOCAL_WORKSPACE.id) - Number(b.id === LOCAL_WORKSPACE.id),
  )
  return list.length ? list : [{ ...LOCAL_WORKSPACE, boards: 0 }]
}

export function workspaceInitial(name: string) {
  return (name.trim()[0] || '?').toLocaleUpperCase('pt-BR')
}
