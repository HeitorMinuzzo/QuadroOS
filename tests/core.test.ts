import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { createDatabase, migrate, type Database } from '../server/database.ts'
import { seed } from '../server/seed.ts'
import { buildApp } from '../server/app.ts'
import { parseFile, parseDate, applyImport } from '../server/imports.ts'
import { previewMonday, listMondayBoards, type MondayFetch } from '../server/monday.ts'
import { workspace } from '../server/repository.ts'
import type { FastifyInstance } from 'fastify'
import { isOverdue, type Task, type Workspace } from '../shared/domain.ts'

let db: Database
let app: FastifyInstance
before(async () => {
  db = await createDatabase({ path: 'memory://' })
  app = await buildApp(db, { demo: false })
  await app.ready()
})
after(async () => {
  await app?.close()
  await db?.close()
})

test('Brazilian dates, leap years and invalid calendar dates', () => {
  assert.equal(parseDate('29/02/2024'), '2024-02-29')
  assert.equal(parseDate('29/02/2025'), null)
  assert.equal(parseDate('31/04/2026'), null)
  assert.equal(parseDate('2026-10-21'), '2026-10-21')
  assert.equal(parseDate('10/11/2026'), '2026-11-10')
  assert.equal(parseDate('not a date'), null)
})
test('CSV understands BOM, semicolon, quoted multiline text and duplicate headers', async () => {
  const csv = '\uFEFFTarefa;Notas;Notas;Prazo\r\n"Revisar; rede";"Linha 1\nLinha 2";ok;21/10/2026'
  const preview = await parseFile(Buffer.from(csv), 'tarefas.csv')
  assert.deepEqual(preview.headers, ['Tarefa', 'Notas', 'Notas (2)', 'Prazo'])
  assert.equal(preview.rows[0][0], 'Revisar; rede')
  assert.equal(preview.rows[0][1], 'Linha 1\nLinha 2')
  await assert.rejects(() => parseFile(Buffer.from('one row'), 'empty.csv'))
  await assert.rejects(
    () => parseFile(Buffer.from('invalid'), 'invalid.xlsx'),
    /Não foi possível ler o Excel/,
  )
})
test('XLSX first worksheet is parsed from an actual OOXML workbook', async () => {
  const content = {
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tarefas" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Tarefa</t></is></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Testar Excel</t></is></c><c r="B2" t="inlineStr"><is><t>Em andamento</t></is></c></row></sheetData></worksheet>',
  }
  const archive = zipSync(
    Object.fromEntries(Object.entries(content).map(([name, value]) => [name, strToU8(value)])),
  )
  const preview = await parseFile(Buffer.from(archive), 'tarefas.xlsx')
  assert.deepEqual(preview.headers, ['Tarefa', 'Status'])
  assert.equal(preview.rows[0][0], 'Testar Excel')
})
test('imports preserve extra columns, flag unmatched values and skip repeated source IDs', async () => {
  const preview = await parseFile(
    Buffer.from(
      'ID;Tarefa;Status;Responsável;Prazo;Orçamento\n42;Migrar dados;Em andamento;Pessoa Externa;31/02/2026;1200\n43;Validar acesso;Concluído;Você;21/10/2026;800\n43;Duplicada;Concluído;;;',
    ),
    'origem.csv',
  )
  const mapping = {
    ID: 'externalId',
    Tarefa: 'title',
    Status: 'status',
    Responsável: 'owner',
    Prazo: 'dueDate',
    Orçamento: 'custom',
  } as const
  const result = await applyImport(db, preview, mapping, { boardName: 'Importados' })
  assert.equal(result.imported, 2)
  assert.equal(result.skipped, 1)
  const state = await workspace(db)
  const migrated = state.tasks.find((t) => t.externalId === '42')!
  assert.equal(migrated.status, 'Em andamento')
  assert.equal(state.tasks.find((t) => t.externalId === '43')?.status, 'Feito')
  assert.equal(migrated.dueDate, null)
  assert.match(migrated.description, /Pessoa Externa/)
  assert.match(migrated.description, /31\/02\/2026/)
  assert.equal(Object.values(migrated.customValues)[0], '1200')
  const repeat = await applyImport(db, preview, mapping, { boardId: result.boardId })
  assert.equal(repeat.imported, 0)
  assert.equal(repeat.skipped, 3)
  assert.equal((await workspace(db)).tasks.length, 2)
})
test('import rollback leaves no partially created board or task', async () => {
  const beforeState = await workspace(db)
  await assert.rejects(() =>
    applyImport(
      db,
      {
        headers: ['Tarefa'],
        rows: [['Good'], ['Bad']],
        name: 'rollback.csv',
        source: 'file',
        warnings: [],
      },
      { Tarefa: 'title' },
      { boardId: 'does-not-exist' },
    ),
  )
  const afterState = await workspace(db)
  assert.equal(afterState.boards.length, beforeState.boards.length)
  assert.equal(afterState.tasks.length, beforeState.tasks.length)
})
test('CRUD, optimistic concurrency, date validation, foreign keys, comments and CSV export', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/boards',
    payload: { name: 'API test' },
  })
  assert.equal(create.statusCode, 201)
  const boardId = create.json().id
  const state = (await app.inject('/api/workspace')).json<Workspace>()
  const group = state.groups.find((g) => g.boardId === boardId)!
  const taskResponse = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: { title: '=1+1', boardId, groupId: group.id },
  })
  assert.equal(taskResponse.statusCode, 201)
  const task = taskResponse.json()
  const change = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { status: 'Feito', version: task.version },
  })
  assert.equal(change.statusCode, 200)
  assert.equal(change.json().version, 2)
  const conflict = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { title: 'Overwritten', version: 1 },
  })
  assert.equal(conflict.statusCode, 409)
  const custom1 = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { customValues: { a: 'one' }, version: 2 },
  })
  assert.equal(custom1.statusCode, 200)
  const custom2 = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { customValues: { b: 'two' }, version: 3 },
  })
  assert.deepEqual(custom2.json().customValues, { a: 'one', b: 'two' })
  const invalidDate = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { dueDate: '2026-02-31', version: 4 },
  })
  assert.equal(invalidDate.statusCode, 400)
  const otherGroup = state.groups.find((g) => g.boardId !== boardId)!
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        payload: { groupId: otherGroup.id, version: 4 },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/comments`,
        payload: { body: 'Persisted comment' },
      })
    ).statusCode,
    201,
  )
  const exported = await app.inject(`/api/boards/${boardId}/export`)
  assert.equal(exported.statusCode, 200)
  assert.match(exported.body, /'=1\+1/)
  assert.equal(
    (await app.inject({ method: 'DELETE', url: '/api/tasks', payload: { ids: [task.id] } }))
      .statusCode,
    204,
  )
  const final = await workspace(db)
  assert.ok(!final.comments.some((c) => c.taskId === task.id))
})
test('cross-site mutations are rejected and duplicate mappings cannot silently overwrite fields', async () => {
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { origin: 'https://untrusted.example' },
        payload: { name: 'CSRF' },
      })
    ).statusCode,
    403,
  )
  const response = await app.inject({
    method: 'POST',
    url: '/api/imports/apply',
    payload: {
      preview: {
        headers: ['A', 'B'],
        rows: [['one', 'two']],
        name: 'test.csv',
        source: 'file',
        warnings: [],
      },
      mapping: { A: 'title', B: 'title' },
      boardName: 'Bad mapping',
    },
  })
  assert.equal(response.statusCode, 400)
})
test('monday connector sends token only to official endpoint and follows item cursors', async () => {
  let calls = 0
  const fetcher: MondayFetch = async (url, init) => {
    assert.equal(url, 'https://api.monday.com/v2')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'secret-test-token')
    const request = JSON.parse(init!.body as string)
    calls++
    const data = request.query.includes('next_items_page')
      ? {
          next_items_page: {
            cursor: null,
            items: [
              {
                id: '2',
                name: 'Second item',
                group: { title: 'Week' },
                column_values: [{ id: 'status', text: 'Done', value: null }],
              },
            ],
          },
        }
      : {
          boards: [
            {
              name: 'Source board',
              columns: [
                { id: 'name', title: 'Name', type: 'name' },
                { id: 'status', title: 'Status', type: 'status' },
              ],
              items_page: {
                cursor: 'page-2',
                items: [
                  {
                    id: '1',
                    name: 'First item',
                    group: { title: 'Week' },
                    column_values: [{ id: 'status', text: 'Working on it', value: null }],
                  },
                ],
              },
            },
          ],
        }
    if (calls === 2) assert.equal(request.variables.cursor, 'page-2')
    return new Response(JSON.stringify({ data }), { status: 200 })
  }
  const preview = await previewMonday('secret-test-token', '123', fetcher)
  assert.equal(calls, 2)
  assert.equal(preview.rows.length, 2)
  assert.equal(preview.rows[1][2], '2')
  assert.ok(!JSON.stringify(preview).includes('secret-test-token'))
  await assert.rejects(
    () => listMondayBoards('bad-token', async () => new Response('{}', { status: 401 })),
    /Token inválido/,
  )
})

test('status migration preserves tasks and comments and runs only once', async () => {
  const legacyDb = await createDatabase({ path: 'memory://' })
  try {
    await migrate(legacyDb)
    await seed(legacyDb)
    // Reproduce the previous alpha's persisted data, before any status migration.
    await legacyDb.query("DELETE FROM schema_migrations WHERE id='20261021_monday_statuses'")
    await legacyDb.query(`UPDATE tasks SET status='Concluído' WHERE id='task-11'`)
    await legacyDb.query(`UPDATE tasks SET status='Em revisão' WHERE id='task-3'`)
    const beforeState = await workspace(legacyDb)
    await migrate(legacyDb)
    const afterState = await workspace(legacyDb)
    assert.equal(afterState.tasks.length, beforeState.tasks.length)
    assert.deepEqual(afterState.comments, beforeState.comments)
    assert.deepEqual(afterState.boards, beforeState.boards)
    for (const task of beforeState.tasks) {
      const updated = afterState.tasks.find((t) => t.id === task.id)!
      const expected =
        task.id === 'task-11' ? 'Feito' : task.id === 'task-3' ? 'Aguardando' : task.status
      assert.deepEqual(updated, {
        ...task,
        status: expected,
        version: task.version + Number(updated.status !== task.status),
        updatedAt: updated.updatedAt,
      })
    }
    await migrate(legacyDb)
    assert.deepEqual(await workspace(legacyDb), afterState)
  } finally {
    await legacyDb.close()
  }
})

test('imports retain all six monday statuses and convert legacy and English labels', async () => {
  const cases = [
    ['Feito', 'Feito'],
    ['Em andamento', 'Em andamento'],
    ['Parado', 'Parado'],
    ['Não iniciado', 'Não iniciado'],
    ['Aguardando', 'Aguardando'],
    ['Contínuo', 'Contínuo'],
    ['Continuo', 'Contínuo'],
    ['Concluído', 'Feito'],
    ['Em revisão', 'Aguardando'],
    ['Done', 'Feito'],
    ['Working on it', 'Em andamento'],
    ['Stuck', 'Parado'],
    ['Not started', 'Não iniciado'],
    ['Waiting', 'Aguardando'],
    ['Continuous', 'Contínuo'],
    ['Em aprovação', 'Não iniciado'],
  ]
  const result = await applyImport(
    db,
    {
      headers: ['Tarefa', 'Status'],
      rows: cases.map(([original], i) => [`Status ${i}`, original]),
      name: 'statuses.csv',
      source: 'file',
      warnings: [],
    },
    { Tarefa: 'title', Status: 'status' },
    { boardName: 'Status importados' },
  )
  assert.equal(result.imported, cases.length)
  const tasks = (await workspace(db)).tasks.filter((t) => t.boardId === result.boardId)
  for (const [i, [, expected]] of cases.entries()) {
    assert.equal(tasks.find((t) => t.title === `Status ${i}`)?.status, expected)
  }
  assert.match(tasks.find((t) => t.title === 'Status 15')!.description, /Em aprovação/)
})

test('API saves all six statuses; only Feito stops a past-due task being overdue', async () => {
  const state = await workspace(db)
  const group = state.groups[0]
  const created = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    payload: {
      title: 'Lifecycle',
      boardId: group.boardId,
      groupId: group.id,
      dueDate: '2000-01-01',
    },
  })
  assert.equal(created.statusCode, 201)
  let task = created.json<Task>()
  for (const status of [
    'Feito',
    'Em andamento',
    'Parado',
    'Não iniciado',
    'Aguardando',
    'Contínuo',
  ]) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status, version: task.version },
    })
    assert.equal(response.statusCode, 200)
    task = response.json<Task>()
    assert.equal(task.status, status)
    assert.equal(isOverdue(task), status !== 'Feito')
  }
  const invalid = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { status: 'Em revisão', version: task.version },
  })
  assert.equal(invalid.statusCode, 400)
})

test('subitems persist, follow parent groups, complete independently and cascade on deletion', async () => {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Subitems workflow' } })
  ).json()
  const initial = await workspace(db)
  const normal = initial.groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  const done = initial.groups.find((g) => g.boardId === board.id && g.isCompleted)!
  const second = (
    await app.inject({
      method: 'POST',
      url: `/api/boards/${board.id}/groups`,
      payload: { name: 'Next' },
    })
  ).json()
  for (const [optionId, groupId] of [
    ['status-done', done.id],
    ['status-progress', second.id],
  ])
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/boards/${board.id}/automations`,
          payload: { columnId: 'status', optionId, groupId },
        })
      ).statusCode,
      201,
    )
  const create = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: normal.id, ...payload },
    })
  const parent = (await create({ title: 'Parent' })).json<Task>()
  let child = (await create({ title: 'Child', parentId: parent.id })).json<Task>()
  assert.equal(child.parentId, parent.id)
  const patch = (task: Task, changes: Partial<Task>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { version: task.version, ...changes },
    })
  child = (await patch(child, { status: 'Feito' })).json<Task>()
  assert.equal(child.groupId, normal.id)
  assert.equal((await workspace(db)).tasks.find((t) => t.id === parent.id)?.status, 'Não iniciado')
  const moved = (await patch(parent, { groupId: second.id })).json<Task>()
  child = (await workspace(db)).tasks.find((t) => t.id === child.id)!
  assert.equal(child.groupId, second.id)
  assert.equal(
    (await patch({ ...child, version: child.version - 1 }, { title: 'Stale' })).statusCode,
    409,
  )
  const completed = (await patch(moved, { status: 'Feito' })).json<Task>()
  assert.equal(completed.groupId, done.id)
  assert.equal(completed.previousGroupId, null)
  child = (await workspace(db)).tasks.find((t) => t.id === child.id)!
  assert.equal(child.groupId, done.id)
  assert.equal(child.status, 'Feito')
  assert.equal((await patch(child, { groupId: normal.id })).statusCode, 400)
  const reopened = (await patch(completed, { status: 'Em andamento' })).json<Task>()
  assert.equal(reopened.groupId, second.id)
  assert.equal(reopened.previousGroupId, null)
  assert.equal((await workspace(db)).tasks.find((t) => t.id === child.id)?.groupId, second.id)
  const nested = (await create({ title: 'Nested child', parentId: child.id })).json<Task>()
  assert.equal(nested.parentId, child.id)
  const another = initial.groups.find((g) => g.boardId !== board.id)!
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          title: 'Wrong board',
          boardId: another.boardId,
          groupId: another.id,
          parentId: parent.id,
        },
      })
    ).statusCode,
    400,
  )
  assert.equal((await create({ title: 'Missing parent', parentId: 'missing' })).statusCode, 404)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/groups/${done.id}`,
        payload: { name: 'Entregues', color: '#8b79bd' },
      })
    ).statusCode,
    200,
  )
  assert.equal(
    (await app.inject({ method: 'PATCH', url: `/api/groups/${done.id}`, payload: { name: '  ' } }))
      .statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/groups/${done.id}`,
        payload: { isCompleted: false },
      })
    ).statusCode,
    400,
  )
  const finishedAgain = (await patch(reopened, { status: 'Feito' })).json<Task>()
  assert.equal(finishedAgain.groupId, done.id)
  assert.equal((await workspace(db)).tasks.find((task) => task.id === nested.id)?.groupId, done.id)
  assert.equal(
    (await workspace(db)).groups.filter((g) => g.boardId === board.id && g.isCompleted).length,
    1,
  )
  await app.inject({
    method: 'POST',
    url: `/api/tasks/${child.id}/comments`,
    payload: { body: 'Child comment' },
  })
  await app.inject({ method: 'DELETE', url: '/api/tasks', payload: { ids: [parent.id] } })
  const final = await workspace(db)
  assert.ok(!final.tasks.some((t) => t.id === parent.id || t.parentId === parent.id))
  assert.ok(!final.comments.some((c) => c.taskId === child.id))
  assert.ok(!final.tasks.some((task) => task.id === nested.id))
})

test('migration preserves groups, installs no automations and is idempotent', async () => {
  const isolated = await createDatabase({ path: 'memory://' })
  try {
    await migrate(isolated)
    await seed(isolated, true)
    const before = await workspace(isolated)
    await isolated.query("UPDATE groups SET is_completed=false WHERE id='group-done'")
    await isolated.query("UPDATE tasks SET status='Feito',group_id='group-week' WHERE id=$1", [
      before.tasks[0].id,
    ])
    await isolated.query(
      "DELETE FROM schema_migrations WHERE id='20261021_subitems_completion_groups'",
    )
    await migrate(isolated)
    const migrated = await workspace(isolated)
    assert.equal(migrated.tasks.length, before.tasks.length)
    assert.deepEqual(migrated.comments, before.comments)
    assert.equal(migrated.tasks.find((t) => t.id === before.tasks[0].id)?.groupId, 'group-week')
    assert.equal(migrated.tasks.find((t) => t.id === before.tasks[0].id)?.previousGroupId, null)
    assert.equal(migrated.groups.filter((g) => g.boardId === 'board-ti' && g.isCompleted).length, 0)
    assert.equal((await isolated.query('SELECT id FROM board_automations')).rows.length, 0)
    await migrate(isolated)
    assert.deepEqual((await workspace(isolated)).tasks, migrated.tasks)
  } finally {
    await isolated.close()
  }
})

test('column widths persist per board, validate limits and preserve independent label settings', async () => {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Larguras' } })
  ).json()
  const label = [{ id: 'custom-status', label: 'Validando', color: '#0073ea' }]
  await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id,
    payload: { settings: { statusOptions: label } },
  })
  const resized = await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/column-widths',
    payload: { widths: { title: 520, status: 180 } },
  })
  assert.equal(resized.statusCode, 200)
  assert.deepEqual(resized.json().settings, {
    statusOptions: label,
    columnWidths: { title: 520, status: 180 },
  })
  // A label editor can update only its own field, without replacing column widths.
  await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id,
    payload: { settings: { priorityOptions: label } },
  })
  const persisted = (await workspace(db)).boards.find((b) => b.id === board.id)!
  assert.deepEqual(persisted.settings?.columnWidths, { title: 520, status: 180 })
  for (const widths of [{ title: 10 }, { title: 1201 }, { unknown: 200 }, { status: 150.5 }]) {
    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/boards/' + board.id + '/column-widths',
      payload: { widths },
    })
    assert.equal(invalid.statusCode, 400)
  }
  assert.deepEqual(
    (await workspace(db)).boards.find((b) => b.id === board.id),
    persisted,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/missing/column-widths',
        payload: { widths: { title: 300 } },
      })
    ).statusCode,
    404,
  )
})

test('moving tasks normalizes all siblings, retains hidden neighbors and rejects stale or cross-group moves', async () => {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Ordenação' } })
  ).json()
  const state = await workspace(db)
  const group = state.groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  const otherGroup = state.groups.find((g) => g.boardId === board.id && g.isCompleted)!
  const tasks: Task[] = []
  for (const title of ['A', 'Oculta', 'B', 'C'])
    tasks.push(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tasks',
          payload: { boardId: board.id, groupId: group.id, title },
        })
      ).json(),
    )
  const child = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: group.id, parentId: tasks[3].id, title: 'Filho de C' },
    })
  ).json<Task>()
  const done = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: otherGroup.id, title: 'Concluída', status: 'Feito' },
    })
  ).json<Task>()
  const moved = await app.inject({
    method: 'POST',
    url: '/api/tasks/' + tasks[3].id + '/move',
    payload: { version: tasks[3].version, targetId: tasks[0].id, placement: 'before' },
  })
  assert.equal(moved.statusCode, 200)
  const ordered = moved.json<Task[]>()
  assert.deepEqual(
    ordered.map((t) => t.title),
    ['C', 'A', 'Oculta', 'B'],
  )
  assert.deepEqual(
    ordered.map((t) => t.position),
    [0, 1, 2, 3],
  )
  assert.deepEqual(
    (await workspace(db)).tasks.find((t) => t.id === child.id),
    child,
  )
  const stale = await app.inject({
    method: 'POST',
    url: '/api/tasks/' + tasks[3].id + '/move',
    payload: { version: tasks[3].version, targetId: tasks[0].id, placement: 'after' },
  })
  assert.equal(stale.statusCode, 409)
  const before = await workspace(db)
  for (const targetId of [done.id, child.id, ordered[0].id, 'missing']) {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/tasks/' + ordered[0].id + '/move',
      payload: { version: ordered[0].version, targetId, placement: 'after' },
    })
    assert.equal(invalid.statusCode, 400)
  }
  assert.deepEqual(await workspace(db), before)
  const down = await app.inject({
    method: 'POST',
    url: '/api/tasks/' + ordered[0].id + '/move',
    payload: { version: ordered[0].version, targetId: tasks[2].id, placement: 'after' },
  })
  assert.deepEqual(
    down.json<Task[]>().map((t) => t.title),
    ['A', 'Oculta', 'B', 'C'],
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks/missing/move',
        payload: { version: 1, targetId: tasks[0].id, placement: 'after' },
      })
    ).statusCode,
    404,
  )
})

test('subitems can be reordered only among children of the same task', async () => {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Ordem de subitens' } })
  ).json()
  const group = (await workspace(db)).groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  const create = async (title: string, parentId?: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { boardId: board.id, groupId: group.id, title, parentId },
      })
    ).json<Task>()
  const parent = await create('Principal')
  const other = await create('Outra tarefa')
  const first = await create('Primeiro', parent.id)
  const second = await create('Segundo', parent.id)
  const outsider = await create('Outro filho', other.id)
  const moved = await app.inject({
    method: 'POST',
    url: '/api/tasks/' + second.id + '/move',
    payload: { version: second.version, targetId: first.id, placement: 'before' },
  })
  assert.deepEqual(
    moved.json<Task[]>().map((t) => t.title),
    ['Segundo', 'Primeiro'],
  )
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/tasks/' + first.id + '/move',
        payload: {
          version: moved.json<Task[]>()[1].version,
          targetId: outsider.id,
          placement: 'before',
        },
      })
    ).statusCode,
    400,
  )
  assert.deepEqual(
    (await workspace(db)).tasks.find((t) => t.id === parent.id),
    parent,
  )
})

test('multiple owners preserve legacy assignments, validate people and survive export/import', async () => {
  await db.query(
    "INSERT INTO people VALUES ('person-multi','Pessoa Extra','PE','#647ac1','extra@example.com')",
  )
  const board = (
    await app.inject({
      method: 'POST',
      url: '/api/boards',
      payload: { name: 'Equipe compartilhada' },
    })
  ).json()
  const group = (await workspace(db)).groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  let task = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        boardId: board.id,
        groupId: group.id,
        title: 'Entrega conjunta',
        ownerId: 'person-you',
      },
    })
  ).json()
  assert.deepEqual(task.ownerIds, ['person-you'])
  const update = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/' + task.id,
    payload: { version: task.version, ownerIds: ['person-multi', 'person-you', 'person-multi'] },
  })
  assert.equal(update.statusCode, 200)
  task = update.json()
  assert.deepEqual(task.ownerIds, ['person-multi', 'person-you'])
  assert.equal(task.ownerId, 'person-multi')
  const invalid = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/' + task.id,
    payload: { version: task.version, ownerIds: ['person-you', 'missing-person'] },
  })
  assert.equal(invalid.statusCode, 400)
  assert.deepEqual(
    (await workspace(db)).tasks.find((t) => t.id === task.id)?.ownerIds,
    task.ownerIds,
  )
  const exported = await app.inject({ method: 'GET', url: '/api/boards/' + board.id + '/export' })
  assert.ok(exported.body.includes('Pessoa Extra, Você'))
  const preview = await parseFile(Buffer.from(exported.body), 'equipe.csv')
  const imported = await applyImport(
    db,
    preview,
    { Tarefa: 'title', Responsável: 'owner', Status: 'status' },
    { boardName: 'Equipe importada' },
  )
  assert.deepEqual(
    (await workspace(db)).tasks.find((t) => t.boardId === imported.boardId)?.ownerIds,
    task.ownerIds,
  )
  task = (
    await app.inject({
      method: 'PATCH',
      url: '/api/tasks/' + task.id,
      payload: { version: task.version, dueDate: '2030-05-20' },
    })
  ).json()
  assert.deepEqual(task.ownerIds, ['person-multi', 'person-you'])
  task = (
    await app.inject({
      method: 'PATCH',
      url: '/api/tasks/' + task.id,
      payload: { version: task.version, ownerIds: [] },
    })
  ).json()
  assert.deepEqual(task.ownerIds, [])
  assert.equal(task.ownerId, null)
  const legacy = await app.inject({
    method: 'PATCH',
    url: '/api/tasks/' + task.id,
    payload: { version: task.version, ownerId: 'person-you' },
  })
  assert.deepEqual(legacy.json().ownerIds, ['person-you'])
})

test('multiple-owner migration preserves existing tasks and runs only once', async () => {
  const isolated = await createDatabase({ path: 'memory://' })
  try {
    await migrate(isolated)
    await seed(isolated, true)
    const before = await workspace(isolated)
    await isolated.query("DELETE FROM schema_migrations WHERE id='20261022_multiple_owners'")
    await migrate(isolated)
    const migrated = await workspace(isolated)
    assert.deepEqual(migrated.tasks, before.tasks)
    assert.deepEqual(migrated.comments, before.comments)
    const stored = await isolated.query<{ owner_id: string | null; owner_ids: string[] }>(
      'SELECT owner_id,owner_ids FROM tasks',
    )
    for (const row of stored.rows)
      assert.deepEqual(row.owner_ids, row.owner_id ? [row.owner_id] : [])
    await isolated.query("UPDATE tasks SET owner_ids='[]'::jsonb,owner_id=NULL WHERE id=$1", [
      before.tasks[0].id,
    ])
    await migrate(isolated)
    assert.deepEqual(
      (await workspace(isolated)).tasks.find((t) => t.id === before.tasks[0].id)?.ownerIds,
      [],
    )
  } finally {
    await isolated.close()
  }
})

test('column order persists independently for tables/subitems and rejects invalid layouts', async () => {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Ordem das colunas' } })
  ).json()
  const custom = (
    await app.inject({
      method: 'POST',
      url: '/api/boards/' + board.id + '/columns',
      payload: { name: 'Estimativa', type: 'number' },
    })
  ).json()
  await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/column-widths',
    payload: { widths: { status: 180 } },
  })
  const keys = ['status', custom.id, 'owner', 'date', 'priority']
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/column-order',
    payload: { keys, scope: 'tasks' },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().settings.columnOrder, keys)
  assert.deepEqual(response.json().settings.columnWidths, { status: 180 })
  const subitems = ['date', 'status', 'owner', 'priority', custom.id]
  await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/column-order',
    payload: { keys: subitems, scope: 'subitems' },
  })
  const settings = (await workspace(db)).boards.find((b) => b.id === board.id)!.settings!
  assert.deepEqual(settings.columnOrder, keys)
  assert.deepEqual(settings.subitemColumnOrder, subitems)
  for (const invalid of [
    [],
    ['status', 'status'],
    ['title', ...keys],
    keys.map((key) => (key === custom.id ? 'missing' : key)),
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/boards/' + board.id + '/column-order',
          payload: { keys: invalid, scope: 'tasks' },
        })
      ).statusCode,
      400,
    )
  }
  assert.deepEqual((await workspace(db)).boards.find((b) => b.id === board.id)!.settings, settings)
})

test('six column types validate task values and option edits migrate parents and subitems atomically', async () => {
  const board = (
    await app.inject({
      method: 'POST',
      url: '/api/boards',
      payload: { name: 'Colunas configuráveis' },
    })
  ).json()
  const group = (await workspace(db)).groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  const options = [
    { id: 'review', label: 'Conferir', color: '#0073ea' },
    { id: 'ready', label: 'Pronto', color: '#00a86b' },
  ]
  const columns: Record<string, { id: string; name: string; type: string }> = {}
  for (const type of ['text', 'number', 'date', 'status', 'people', 'dropdown']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/boards/' + board.id + '/columns',
      payload: {
        name: 'Campo ' + type,
        type,
        ...(['status', 'dropdown'].includes(type) ? { options } : {}),
      },
    })
    assert.equal(response.statusCode, 201)
    columns[type] = response.json()
  }
  const values = {
    [columns.text.id]: '8,5',
    [columns.number.id]: '12.5',
    [columns.date.id]: '2030-05-20',
    [columns.status.id]: 'Conferir',
    [columns.people.id]: JSON.stringify(['person-you']),
    [columns.dropdown.id]: JSON.stringify(['Conferir', 'Pronto']),
  }
  const parent = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        boardId: board.id,
        groupId: group.id,
        title: 'Com todos os campos',
        customValues: values,
      },
    })
  ).json()
  const child = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        boardId: board.id,
        groupId: group.id,
        parentId: parent.id,
        title: 'Subitem com campos',
        customValues: values,
      },
    })
  ).json()
  assert.deepEqual(parent.customValues, values)
  for (const [kind, value] of [
    ['number', 'abc'],
    ['date', '2030-02-30'],
    ['status', 'Inexistente'],
    ['people', '["missing"]'],
    ['people', 'person-you'],
    ['dropdown', '["missing"]'],
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/tasks/' + parent.id,
          payload: { version: parent.version, customValues: { [columns[kind].id]: value } },
        })
      ).statusCode,
      400,
    )
  }
  const rename = await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/columns/' + columns.status.id,
    payload: {
      name: 'Etapa de revisão',
      options: [{ ...options[0], label: 'Revisar' }, options[1]],
    },
  })
  assert.equal(rename.statusCode, 200)
  for (const task of (await workspace(db)).tasks.filter((t) =>
    [parent.id, child.id].includes(t.id),
  )) {
    assert.equal(task.customValues[columns.status.id], 'Revisar')
    assert.equal(task.version, 2)
    assert.equal(task.status, 'Não iniciado')
  }
  const before = await workspace(db)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/' + board.id + '/columns/' + columns.status.id,
        payload: { options: [options[1]] },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/' + board.id + '/columns/' + columns.dropdown.id,
        payload: { type: 'status', options },
      })
    ).statusCode,
    400,
  )
  assert.deepEqual((await workspace(db)).tasks, before.tasks)
  assert.deepEqual((await workspace(db)).boards, before.boards)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/' + board.id + '/columns/' + columns.text.id,
        payload: { type: 'number' },
      })
    ).statusCode,
    200,
  )
  assert.equal(
    (await workspace(db)).tasks.find((t) => t.id === child.id)?.customValues[columns.text.id],
    '8.5',
  )
  const current = (await workspace(db)).tasks.find((t) => t.id === parent.id)!
  await app.inject({
    method: 'PATCH',
    url: '/api/tasks/' + parent.id,
    payload: { version: current.version, customValues: { [columns.dropdown.id]: '[]' } },
  })
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/boards/' + board.id + '/columns',
        payload: {
          name: 'Duplicadas',
          type: 'dropdown',
          options: [options[0], { ...options[1], label: 'Conferir' }],
        },
      })
    ).statusCode,
    400,
  )
})

test('column management preserves board settings, hides system fields and removes only selected custom data', async () => {
  const board = (
    await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Montar meu quadro' } })
  ).json()
  const group = (await workspace(db)).groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  const column = (
    await app.inject({
      method: 'POST',
      url: '/api/boards/' + board.id + '/columns',
      payload: { name: 'Aprovação', type: 'text', scope: 'subitems' },
    })
  ).json()
  let settings = (await workspace(db)).boards.find((b) => b.id === board.id)!.settings!
  assert.ok(settings.subitemColumns?.includes(column.id))
  assert.ok(settings.hiddenColumns?.includes(column.id))
  await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/column-widths',
    payload: { widths: { [column.id]: 180 } },
  })
  await app.inject({
    method: 'PATCH',
    url: '/api/boards/' + board.id + '/column-order',
    payload: { keys: ['owner', column.id, 'status', 'priority', 'date'], scope: 'tasks' },
  })
  const task = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        boardId: board.id,
        groupId: group.id,
        title: 'Preservar tarefa',
        customValues: { [column.id]: 'conteúdo', legacy: 'preservar' },
      },
    })
  ).json()
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/' + board.id + '/columns/owner',
        payload: { name: 'Equipe', hidden: true },
      })
    ).statusCode,
    200,
  )
  settings = (await workspace(db)).boards.find((b) => b.id === board.id)!.settings!
  assert.equal(settings.columnNames?.owner, 'Equipe')
  assert.ok(settings.hiddenColumns?.includes('owner'))
  assert.equal(settings.columnWidths?.[column.id], 180)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/' + board.id + '/columns/owner',
        payload: { type: 'text' },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (await app.inject({ method: 'DELETE', url: '/api/boards/' + board.id + '/columns/status' }))
      .statusCode,
    400,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/boards/missing/columns/' + column.id,
        payload: { name: 'Outro' },
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/boards/' + board.id + '/columns/' + column.id,
      })
    ).statusCode,
    204,
  )
  const final = await workspace(db)
  const saved = final.tasks.find((t) => t.id === task.id)!
  assert.deepEqual(saved.customValues, { legacy: 'preservar' })
  assert.equal(saved.version, task.version + 1)
  assert.equal(final.boards.find((b) => b.id === board.id)?.columns.length, 0)
  settings = final.boards.find((b) => b.id === board.id)!.settings!
  assert.ok(!settings.hiddenColumns?.includes(column.id))
  assert.ok(!settings.subitemColumns?.includes(column.id))
  assert.ok(!settings.columnOrder?.includes(column.id))
  assert.equal(settings.columnWidths?.[column.id], undefined)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/tasks/' + task.id,
        payload: { version: saved.version, customValues: { [column.id]: 'edição antiga' } },
      })
    ).statusCode,
    400,
  )
})

test('imports map values into configured column types and retain incompatible source data', async () => {
  const board = (
    await app.inject({
      method: 'POST',
      url: '/api/boards',
      payload: { name: 'Importar campos configurados' },
    })
  ).json()
  const kinds = [
    { name: 'Estimativa', type: 'number' },
    { name: 'Reunião', type: 'date' },
    { name: 'Revisores', type: 'people' },
    {
      name: 'Áreas',
      type: 'dropdown',
      options: [
        { id: 'finance', label: 'Financeiro', color: '#0073ea' },
        { id: 'it', label: 'TI', color: '#8b79bd' },
      ],
    },
  ]
  const columns: Record<string, string> = {}
  for (const kind of kinds)
    columns[kind.name] = (
      await app.inject({
        method: 'POST',
        url: '/api/boards/' + board.id + '/columns',
        payload: kind,
      })
    ).json().id
  const result = await applyImport(
    db,
    {
      name: 'Campos.csv',
      source: 'file',
      warnings: [],
      headers: ['Tarefa', 'Estimativa', 'Reunião', 'Revisores', 'Áreas'],
      rows: [
        ['Importada', '8,5', '20/05/2030', 'Você', 'Financeiro, TI'],
        ['Incompatível', 'abc', '31/02/2030', 'Pessoa desconhecida', 'Inexistente'],
      ],
    },
    {
      Tarefa: 'title',
      Estimativa: 'custom',
      Reunião: 'custom',
      Revisores: 'custom',
      Áreas: 'custom',
    },
    { boardId: board.id },
  )
  assert.equal(result.imported, 2)
  const tasks = (await workspace(db)).tasks.filter((t) => t.boardId === board.id)
  const valid = tasks.find((t) => t.title === 'Importada')!
  assert.equal(valid.customValues[columns.Estimativa], '8.5')
  assert.equal(valid.customValues[columns['Reunião']], '2030-05-20')
  assert.deepEqual(JSON.parse(valid.customValues[columns.Revisores]), ['person-you'])
  assert.deepEqual(JSON.parse(valid.customValues[columns['Áreas']]), ['Financeiro', 'TI'])
  const invalid = tasks.find((t) => t.title === 'Incompatível')!
  assert.equal(invalid.customValues[columns.Estimativa], '')
  assert.match(invalid.description, /Pessoa desconhecida/)
  assert.match(invalid.description, /31\/02\/2030/)
  assert.ok(result.warnings.length > 0)
})
