import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_WORKSPACE, type Workspace, type Task } from '../shared/domain.ts'
import { shareWorkspace } from '../src/lib/workspace-sharing.ts'

function fixture(): Workspace {
  const task: Task = {
    id: 'task',
    boardId: 'board',
    groupId: 'group',
    parentId: null,
    previousGroupId: null,
    title: 'Tarefa local',
    description: '',
    status: 'Não iniciado',
    priority: 'Média',
    dueDate: null,
    dueAt: null,
    ownerId: null,
    ownerIds: [],
    position: 0,
    version: 1,
    source: null,
    externalId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    customValues: { number: '10' },
  }
  return {
    ...EMPTY_WORKSPACE,
    tasks: [task],
    comments: [
      {
        id: 'comment',
        taskId: task.id,
        authorId: 'person',
        body: 'Conferido.',
        createdAt: task.createdAt,
        metadata: { localLikes: [] },
      },
    ],
    attachments: [
      {
        id: 'file',
        taskId: task.id,
        columnId: 'files',
        name: 'anexo.txt',
        size: 10,
        createdAt: task.createdAt,
      },
    ],
  }
}
test('an unchanged workspace response reuses the existing snapshot and every collection', () => {
  const previous = fixture(),
    next = structuredClone(previous)
  assert.equal(shareWorkspace(previous, next), previous)
})
test('conversation refresh changes only the affected records and never hides task versions or edited values', () => {
  const previous = fixture(),
    next = structuredClone(previous)
  next.comments[0].metadata!.localLikes = ['person-you']
  const shared = shareWorkspace(previous, next)
  assert.notEqual(shared, previous)
  assert.equal(shared.tasks, previous.tasks)
  assert.equal(shared.attachments, previous.attachments)
  assert.notEqual(shared.comments[0], previous.comments[0])
  assert.deepEqual(previous.comments[0].metadata!.localLikes, [])
  const patched = structuredClone(shared)
  patched.tasks[0].version = 2
  patched.tasks[0].customValues.number = '20'
  const updated = shareWorkspace(shared, patched)
  assert.notEqual(updated.tasks[0], shared.tasks[0])
  assert.equal(updated.tasks[0].version, 2)
  assert.equal(updated.tasks[0].customValues.number, '20')
  assert.equal(updated.comments, shared.comments)
  assert.equal(shared.tasks[0].customValues.number, '10')
})
test('added, deleted and reordered records and removed optional collections follow the new response exactly', () => {
  const previous = fixture(),
    next = structuredClone(previous)
  next.tasks.unshift({ ...next.tasks[0], id: 'new-task', title: 'Nova tarefa' })
  const added = shareWorkspace(previous, next)
  assert.equal(added.tasks[1], previous.tasks[0])
  assert.deepEqual(
    added.tasks.map((task) => task.id),
    ['new-task', 'task'],
  )
  const reordered = shareWorkspace(added, { ...added, tasks: [...added.tasks].reverse() })
  assert.deepEqual(
    reordered.tasks.map((task) => task.id),
    ['task', 'new-task'],
  )
  const removed = shareWorkspace(reordered, { ...reordered, tasks: [], attachments: undefined })
  assert.deepEqual(removed.tasks, [])
  assert.equal(removed.attachments, undefined)
})
