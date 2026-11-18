import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createDatabase, type Database } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { workspace } from '../server/repository.ts'
import { addDays, dayOf, nextOccurrence, runScheduledAutomations } from '../server/automations.ts'
import type { AppNotification, BoardAutomation, Group, Task } from '../shared/domain.ts'

let db: Database
let app: FastifyInstance
before(async () => {
  db = await createDatabase({ path: 'memory://' })
  app = await buildApp(db, { demo: false })
  await db.query(
    `INSERT INTO people (id,name,initials,color,email) VALUES
     ('person-ana','Ana','AN','#0073ea','ana@empresa.com'),
     ('person-bia','Bia','BI','#0073ea','bia@empresa.com')`,
  )
})
after(async () => {
  await app.close()
  await db.close()
})

async function board(name: string) {
  const created = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name } })
  ).json<{ id: string }>()
  const groups = (await workspace(db)).groups.filter((g) => g.boardId === created.id)
  const extra = (
    await app.inject({
      method: 'POST',
      url: `/api/boards/${created.id}/groups`,
      payload: { name: 'Revisão' },
    })
  ).json<Group>()
  return {
    id: created.id,
    open: groups.find((g) => !g.isCompleted)!,
    done: groups.find((g) => g.isCompleted)!,
    review: extra,
  }
}
async function rule(boardId: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/boards/${boardId}/automations`,
    payload,
  })
  assert.equal(response.statusCode, 201, response.body)
  return response.json<BoardAutomation>()
}
async function task(boardId: string, groupId: string, extra: Partial<Task> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { boardId, groupId, title: 'Tarefa', ...extra },
  })
  assert.equal(response.statusCode, 201, response.body)
  return response.json<Task>()
}
async function load(id: string) {
  return (await workspace(db)).tasks.find((t) => t.id === id)!
}
async function patch(current: Task, changes: Partial<Task>) {
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${current.id}`,
    payload: { version: current.version, ...changes },
  })
  assert.equal(response.statusCode, 200, response.body)
  return response.json<Task>()
}
const notificationsOf = async (personId: string) =>
  (
    await db.query('SELECT * FROM notifications WHERE person_id=$1 ORDER BY created_at, id', [
      personId,
    ])
  ).rows as { kind: string; title: string; task_id: string }[]

test('classic rules keep their shape and gain trigger and actions', async () => {
  const b = await board('Clássico')
  const saved = await rule(b.id, {
    columnId: 'status',
    optionId: 'status-done',
    groupId: b.done.id,
  })
  assert.deepEqual(saved.trigger, {
    type: 'status_changed',
    columnId: 'status',
    optionId: 'status-done',
  })
  assert.deepEqual(saved.actions, [{ type: 'move_group', groupId: b.done.id }])
  assert.equal(saved.groupId, b.done.id)
})

test('status changes run several actions and can chain into other rules', async () => {
  const b = await board('Ações')
  // Any change of Status → priority Alta, deadline today + 2, add Ana, tell the owners.
  await rule(b.id, {
    trigger: { type: 'status_changed', columnId: 'status', optionId: null },
    actions: [
      { type: 'set_status', columnId: 'priority', optionId: 'priority-high' },
      { type: 'set_date', columnId: 'date', mode: 'offset', days: 2 },
      { type: 'assign', mode: 'add', personIds: ['person-ana'] },
      { type: 'notify', to: 'owners', personIds: [], message: 'Status atualizado' },
    ],
  })
  // …and Prioridade becoming Alta moves the item to Revisão (a second rule, chained).
  await rule(b.id, {
    trigger: { type: 'status_changed', columnId: 'priority', optionId: 'priority-high' },
    actions: [{ type: 'move_group', groupId: b.review.id }],
  })
  const created = await task(b.id, b.open.id, { priority: 'Baixa' })
  const changed = await patch(created, { status: 'Em andamento' })
  assert.equal(changed.priority, 'Alta')
  assert.equal(changed.dueDate, addDays(dayOf(new Date()), 2))
  assert.deepEqual(changed.ownerIds, ['person-ana'])
  assert.equal(changed.groupId, b.review.id)
  assert.ok(
    (await notificationsOf('person-ana')).some(
      (n) => n.kind === 'automation' && n.title === 'Status atualizado',
    ),
  )
  const runs = (
    await app.inject({ method: 'GET', url: `/api/boards/${b.id}/automations/runs` })
  ).json<{ ruleDescription: string; toGroup: string }[]>()
  assert.equal(runs.length, 2)
  assert.ok(runs.some((run) => run.toGroup === b.review.name))
  // A change that does not touch Status runs nothing.
  const renamed = await patch(changed, { title: 'Só o nome' })
  assert.equal(renamed.version, changed.version + 1)
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/boards/${b.id}/automations/runs` })).json()
      .length,
    2,
  )
})

test('item created, moved to a group and all subitems done', async () => {
  const b = await board('Gatilhos')
  await rule(b.id, {
    trigger: { type: 'item_created' },
    actions: [
      { type: 'set_status', columnId: 'status', optionId: 'status-progress' },
      { type: 'assign', mode: 'set', personIds: ['person-bia'] },
    ],
  })
  await rule(b.id, {
    trigger: { type: 'moved_to_group', groupId: b.review.id },
    actions: [{ type: 'set_status', columnId: 'status', optionId: 'status-waiting' }],
  })
  await rule(b.id, {
    trigger: { type: 'subitems_done' },
    actions: [{ type: 'set_status', columnId: 'status', optionId: 'status-done' }],
  })
  const parent = await task(b.id, b.open.id, { title: 'Principal' })
  assert.equal(parent.status, 'Em andamento')
  assert.deepEqual(parent.ownerIds, ['person-bia'])
  assert.ok((await notificationsOf('person-bia')).some((n) => n.kind === 'assigned'))
  // Subitems are not "items created" for the rules.
  const first = await task(b.id, b.open.id, { title: 'Sub 1', parentId: parent.id })
  const second = await task(b.id, b.open.id, { title: 'Sub 2', parentId: parent.id })
  assert.notEqual(first.status, 'Em andamento')
  const moved = await patch(await load(parent.id), { groupId: b.review.id })
  assert.equal(moved.status, 'Aguardando')
  await patch(await load(first.id), { status: 'Feito' })
  assert.equal((await load(parent.id)).status, 'Aguardando')
  await patch(await load(second.id), { status: 'Feito' })
  assert.equal((await load(parent.id)).status, 'Feito')
})

test('date rules fire once per task and date, skip finished tasks and catch up after downtime', async () => {
  const b = await board('Prazos')
  const today = '2026-11-20'
  const now = new Date('2026-11-20T12:00:00-03:00')
  assert.equal(dayOf(now), today)
  await rule(b.id, {
    trigger: { type: 'date_arrives', columnId: 'date', offsetDays: -1 },
    actions: [
      { type: 'set_status', columnId: 'priority', optionId: 'priority-critical' },
      { type: 'notify', to: 'people', personIds: ['person-ana'], message: 'Vence amanhã' },
    ],
  })
  const tomorrow = await task(b.id, b.open.id, { title: 'Amanhã', dueDate: '2026-11-21' })
  const later = await task(b.id, b.open.id, { title: 'Depois', dueDate: '2026-11-25' })
  const finished = await task(b.id, b.open.id, {
    title: 'Pronta',
    dueDate: '2026-11-21',
    status: 'Feito',
  })
  const missed = await task(b.id, b.open.id, { title: 'Atrasada', dueDate: '2026-11-20' })
  assert.equal(await runScheduledAutomations(db, now), 2)
  assert.equal((await load(tomorrow.id)).priority, 'Crítico')
  assert.equal((await load(missed.id)).priority, 'Crítico')
  assert.notEqual((await load(later.id)).priority, 'Crítico')
  assert.notEqual((await load(finished.id)).priority, 'Crítico')
  assert.equal(
    (await notificationsOf('person-ana')).filter((n) => n.title === 'Vence amanhã').length,
    2,
  )
  // The next run (minutes later, or after a restart) does nothing again.
  assert.equal(await runScheduledAutomations(db, now), 0)
  // A new date fires again.
  await patch(await load(tomorrow.id), { dueDate: '2026-11-27', priority: 'Baixa' })
  assert.equal(await runScheduledAutomations(db, new Date('2026-11-26T09:00:00-03:00')), 2)
  assert.equal((await load(tomorrow.id)).priority, 'Crítico')
})

test('recurring rules create one item per occurrence with the date in the title', async () => {
  const b = await board('Rotinas')
  assert.equal(
    nextOccurrence({ type: 'recurring', every: 'week', weekday: 1 }, '2026-11-20'),
    '2026-11-23',
  )
  assert.equal(
    nextOccurrence({ type: 'recurring', every: 'month', monthDay: 31 }, '2026-11-20'),
    '2026-11-30',
  )
  const saved = await rule(b.id, {
    trigger: { type: 'recurring', every: 'week', weekday: 1 },
    actions: [
      { type: 'create_item', groupId: b.open.id, title: 'Reunião semanal {data}' },
      { type: 'notify', to: 'people', personIds: ['person-bia'], message: 'Nova reunião criada' },
    ],
  })
  // Pretend the rule was created earlier, so its first Monday is the 23rd.
  await db.query(`UPDATE board_automations SET state='{"nextRun":"2026-11-23"}' WHERE id=$1`, [
    saved.id,
  ])
  const titles = async () =>
    (await workspace(db)).tasks.filter((t) => t.boardId === b.id).map((t) => t.title)
  await runScheduledAutomations(db, new Date('2026-11-22T10:00:00-03:00'))
  assert.deepEqual(await titles(), [])
  await runScheduledAutomations(db, new Date('2026-11-23T08:00:00-03:00'))
  await runScheduledAutomations(db, new Date('2026-11-23T18:00:00-03:00'))
  assert.deepEqual(await titles(), ['Reunião semanal 23/11/2026'])
  await runScheduledAutomations(db, new Date('2026-11-30T08:00:00-03:00'))
  assert.deepEqual((await titles()).sort(), [
    'Reunião semanal 23/11/2026',
    'Reunião semanal 30/11/2026',
  ])
  assert.ok((await notificationsOf('person-bia')).some((n) => n.title === 'Nova reunião criada'))
})

test('rules are validated against the board', async () => {
  const b = await board('Validação')
  const other = await board('Outro')
  const bad = [
    {
      trigger: { type: 'item_created' },
      actions: [{ type: 'create_item', groupId: b.open.id, title: 'X' }],
    },
    {
      trigger: { type: 'recurring', every: 'day' },
      actions: [{ type: 'move_group', groupId: b.open.id }],
    },
    {
      trigger: { type: 'recurring', every: 'week' },
      actions: [{ type: 'create_item', groupId: b.open.id, title: 'X' }],
    },
    {
      trigger: { type: 'item_created' },
      actions: [{ type: 'move_group', groupId: other.open.id }],
    },
    {
      trigger: { type: 'item_created' },
      actions: [{ type: 'assign', mode: 'set', personIds: ['ninguem'] }],
    },
    {
      trigger: { type: 'date_arrives', columnId: 'status', offsetDays: 0 },
      actions: [{ type: 'notify', to: 'owners', personIds: [], message: '' }],
    },
    {
      trigger: { type: 'status_changed', columnId: 'status', optionId: 'nao-existe' },
      actions: [{ type: 'notify', to: 'owners', personIds: [], message: '' }],
    },
    { trigger: { type: 'item_created' }, actions: [] },
  ]
  for (const payload of bad) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/boards/${b.id}/automations`,
      payload,
    })
    assert.equal(response.statusCode, 400, JSON.stringify(payload))
  }
})

test('notifications: assignment, comments and replies; each person reads and clears their own', async () => {
  const b = await board('Avisos')
  // Without sign-in every request is "Você": assigning Ana tells Ana, not Você.
  const created = await task(b.id, b.open.id, { title: 'Contrato', ownerIds: ['person-ana'] })
  const ana = await notificationsOf('person-ana')
  assert.ok(ana.some((n) => n.kind === 'assigned' && n.task_id === created.id))
  assert.ok(!(await notificationsOf('person-you')).some((n) => n.task_id === created.id))
  // Ana's own comment is not news to her; Você's comment on her task is.
  await db.query(
    `INSERT INTO comments (id,task_id,author_id,body,created_at) VALUES ('c-ana',$1,'person-ana','Revisei',$2)`,
    [created.id, new Date().toISOString()],
  )
  await app.inject({
    method: 'POST',
    url: `/api/tasks/${created.id}/comments`,
    payload: { body: 'Pode assinar?', parentId: 'c-ana' },
  })
  const after = await notificationsOf('person-ana')
  assert.ok(after.some((n) => n.kind === 'reply' && n.title.includes('respondeu você')))
  // Você reads only Você's list; marking read clears the counter.
  await rule(b.id, {
    trigger: { type: 'status_changed', columnId: 'status', optionId: null },
    actions: [{ type: 'notify', to: 'people', personIds: ['person-you'], message: 'Mudou' }],
  })
  await patch(await load(created.id), { status: 'Parado' })
  let mine = (await app.inject('/api/notifications')).json<{
    items: AppNotification[]
    unread: number
  }>()
  assert.ok(mine.items.every((item) => item.personId === 'person-you'))
  assert.equal(mine.unread, 1)
  assert.equal(mine.items[0].title, 'Mudou')
  await app.inject({ method: 'POST', url: '/api/notifications/read', payload: {} })
  mine = (await app.inject('/api/notifications')).json()
  assert.equal(mine.unread, 0)
})
