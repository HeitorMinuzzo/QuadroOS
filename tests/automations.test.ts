import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createDatabase, type Database } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { updateTask, workspace } from '../server/repository.ts'
import { applyImport } from '../server/imports.ts'
import type { Task } from '../shared/domain.ts'

let db: Database
let app: FastifyInstance
before(async () => {
  db = await createDatabase({ path: 'memory://' })
  app = await buildApp(db, { demo: false })
})
after(async () => {
  await app.close()
  await db.close()
})
async function fixture() {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Regras explícitas' } })
  ).json()
  const groups = (await workspace(db)).groups.filter((g) => g.boardId === board.id)
  const normal = groups.find((g) => !g.isCompleted)!
  const done = groups.find((g) => g.isCompleted)!
  const path = `/api/boards/${board.id}/automations`
  const task = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: normal.id, title: 'Entrega' },
    })
  ).json<Task>()
  return { board, normal, done, path, task }
}
const patch = (task: Task, payload: Partial<Task>) =>
  app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { version: task.version, ...payload },
  })

test('boards start without rules; creation, completion, reopening and imports preserve the selected group', async () => {
  const { board, normal, done, path, task } = await fixture()
  assert.deepEqual((await app.inject({ method: 'GET', url: path })).json(), [])
  let changed = (await patch(task, { status: 'Feito' })).json<Task>()
  assert.equal(changed.groupId, normal.id)
  changed = (await patch(changed, { groupId: done.id, status: 'Em andamento' })).json<Task>()
  assert.equal(changed.groupId, done.id)
  changed = (await patch(changed, { status: 'Parado' })).json<Task>()
  assert.equal(changed.groupId, done.id)
  const created = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: normal.id, title: 'Já feita', status: 'Feito' },
    })
  ).json<Task>()
  assert.equal(created.groupId, normal.id)
  await applyImport(
    db,
    {
      headers: ['Tarefa', 'Status', 'Grupo'],
      rows: [['Importada', 'Feito', normal.name]],
      name: 'Teste',
      source: 'file',
      warnings: [],
    },
    { Tarefa: 'title', Status: 'status', Grupo: 'group' },
    { boardId: board.id },
  )
  const imported = (await workspace(db)).tasks.find(
    (t) => t.boardId === board.id && t.title === 'Importada',
  )!
  assert.equal(imported.groupId, normal.id)
  assert.equal(imported.status, 'Feito')
  assert.deepEqual((await app.inject({ method: 'GET', url: `${path}/runs` })).json(), [])
})

test('rules only run on actual changes, pause and edit without retroactivity, carry children and retain history', async () => {
  const { board, normal, done, path, task } = await fixture()
  const child = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: normal.id, parentId: task.id, title: 'Subitem' },
    })
  ).json<Task>()
  const rule = (
    await app.inject({
      method: 'POST',
      url: path,
      payload: {
        columnId: 'status',
        optionId: 'status-done',
        groupId: done.id,
        description: 'Organizar entregas',
      },
    })
  ).json()
  assert.equal(rule.enabled, true)
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: path,
        payload: { columnId: 'status', optionId: 'status-done', groupId: normal.id },
      })
    ).statusCode,
    409,
  )
  const childDone = (await patch(child, { status: 'Feito' })).json<Task>()
  assert.equal(childDone.groupId, normal.id)
  let current = (await patch(task, { status: 'Feito' })).json<Task>()
  assert.equal(current.groupId, done.id)
  assert.equal((await workspace(db)).tasks.find((t) => t.id === child.id)?.groupId, done.id)
  current = (await patch(current, { status: 'Em andamento' })).json<Task>()
  assert.equal(current.groupId, done.id)
  current = (await patch(current, { groupId: normal.id })).json<Task>()
  const paused = (
    await app.inject({ method: 'PATCH', url: `${path}/${rule.id}`, payload: { enabled: false } })
  ).json()
  assert.equal(paused.description, 'Organizar entregas')
  current = (await patch(current, { status: 'Feito' })).json<Task>()
  assert.equal(current.groupId, normal.id)
  await app.inject({ method: 'PATCH', url: `${path}/${rule.id}`, payload: { enabled: true } })
  current = (await patch(current, { title: 'Só renomear' })).json<Task>()
  assert.equal(current.groupId, normal.id)
  current = (await patch(current, { status: 'Feito' })).json<Task>()
  assert.equal(current.groupId, normal.id)
  current = (await patch(current, { status: 'Em andamento' })).json<Task>()
  current = (await patch(current, { status: 'Feito' })).json<Task>()
  assert.equal(current.groupId, done.id)
  assert.equal(
    (await patch({ ...current, version: current.version - 1 }, { status: 'Parado' })).statusCode,
    409,
  )
  await app.inject({ method: 'DELETE', url: `${path}/${rule.id}` })
  assert.deepEqual((await app.inject({ method: 'GET', url: path })).json(), [])
  const runs = (await app.inject({ method: 'GET', url: `${path}/runs` })).json()
  assert.equal(runs.length, 2)
  assert.equal(runs[0].automationId, null)
  assert.equal(runs[0].fromGroup, normal.name)
  assert.equal(runs[0].toGroup, done.name)
})

test('validation isolates boards and rules follow stable option IDs in custom columns', async () => {
  const { board, normal, done, path, task } = await fixture()
  const other = await fixture()
  for (const payload of [
    { columnId: 'status', optionId: 'missing', groupId: done.id },
    { columnId: 'owner', optionId: 'status-done', groupId: done.id },
    { columnId: 'status', optionId: 'status-done', groupId: other.done.id },
  ])
    assert.equal((await app.inject({ method: 'POST', url: path, payload })).statusCode, 400)
  const column = (
    await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/columns`,
      payload: {
        name: 'Aprovação',
        type: 'status',
        options: [{ id: 'approved', label: 'Aprovado', color: '#0073ea' }],
      },
    })
  ).json()
  const rule = (
    await app.inject({
      method: 'POST',
      url: path,
      payload: { columnId: column.id, optionId: 'approved', groupId: done.id },
    })
  ).json()
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `${other.path}/${rule.id}`,
        payload: { enabled: false },
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (await app.inject({ method: 'PATCH', url: `${path}/${rule.id}`, payload: {} })).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/boards/${board.id}/columns/${column.id}`,
        payload: { options: [{ id: 'approved', label: 'Liberado', color: '#0073ea' }] },
      })
    ).statusCode,
    200,
  )
  const changed = (await patch(task, { customValues: { [column.id]: 'Liberado' } })).json<Task>()
  assert.equal(changed.groupId, done.id)
  await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}/columns/${column.id}` })
  const latest = (await workspace(db)).tasks.find((t) => t.id === task.id)!
  assert.equal(
    (await patch(latest, { status: 'Parado', groupId: normal.id })).json<Task>().groupId,
    normal.id,
  )
  assert.equal(
    (await app.inject({ method: 'PATCH', url: `${path}/${rule.id}`, payload: { enabled: false } }))
      .statusCode,
    200,
  )
  assert.equal(
    (await app.inject({ method: 'PATCH', url: `${path}/${rule.id}`, payload: { enabled: true } }))
      .statusCode,
    400,
  )
})

test('a failed task transaction rolls back the movement and its execution history together', async () => {
  const { done, path, task } = await fixture()
  await app.inject({
    method: 'POST',
    url: path,
    payload: { columnId: 'status', optionId: 'status-done', groupId: done.id },
  })
  await assert.rejects(
    db.transaction(async (tx) => {
      await updateTask(tx, task.id, task.version, { status: 'Feito' })
      throw new Error('rollback')
    }),
    /rollback/,
  )
  assert.deepEqual(
    (await workspace(db)).tasks.find((t) => t.id === task.id),
    task,
  )
  assert.deepEqual((await app.inject({ method: 'GET', url: `${path}/runs` })).json(), [])
})
