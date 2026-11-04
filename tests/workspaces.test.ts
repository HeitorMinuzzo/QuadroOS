import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Board, MondayFolder } from '../shared/domain.ts'
import {
  boardFolders,
  boardWorkspace,
  isArchivedFolder,
  listWorkspaces,
  LOCAL_WORKSPACE,
} from '../src/lib/workspaces.ts'

const board = (id: string, path?: MondayFolder[]) =>
  ({ id, name: id, settings: path ? { mondayFolderPath: path } : {} }) as unknown as Board
const main = { id: 'workspace:1', name: 'Área de trabalho principal' }
const plans = { id: 'workspace:2', name: 'Cronogramas' }

test('workspaces come from the first path segment and local boards share one workspace', () => {
  const boards = [
    board('local'),
    board('ti', [main, { id: '10', name: 'Controladoria' }, { id: '11', name: 'TI' }]),
    board('old-import', [{ id: '20', name: 'Industrial' }]),
    board('archived', [main, { id: 'archived:1', name: 'Arquivados' }]),
    board('cronograma', [plans]),
  ]
  assert.deepEqual(
    listWorkspaces(boards).map((workspace) => [workspace.name, workspace.boards]),
    [
      ['Área de trabalho principal', 2],
      ['Cronogramas', 1],
      [LOCAL_WORKSPACE.name, 2],
    ],
  )
  assert.equal(boardWorkspace(boards[2]).id, LOCAL_WORKSPACE.id)
  assert.deepEqual(
    boardFolders(boards[1]).map((folder) => folder.name),
    ['Controladoria', 'TI'],
  )
  assert.deepEqual(
    boardFolders(boards[2]).map((folder) => folder.name),
    ['Industrial'],
  )
  assert.ok(isArchivedFolder(boardFolders(boards[3])[0]))
})

test('an empty workspace list still offers the local workspace', () => {
  assert.deepEqual(listWorkspaces([]), [{ ...LOCAL_WORKSPACE, boards: 0 }])
})
