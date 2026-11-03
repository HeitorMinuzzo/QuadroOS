import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createDatabase, type Database } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { previewMonday, prepareMondayPreview } from '../server/monday.ts'
import { workspace } from '../server/repository.ts'
import { guessImportMapping } from '../shared/imports.ts'
import { isTaskDone, isOverdue, type ImportPreview, type Workspace } from '../shared/domain.ts'
import { createMondaySessions } from '../server/monday-sessions.ts'
import { publicSourceData } from '../server/monday-data.ts'
import { MONDAY_CAPABILITIES, mondayCapability } from '../shared/monday-capabilities.ts'
import {
  richMondayFetch,
  richDownloadFetch,
  pngBytes,
  richMondayFixture,
} from './fixtures/monday-rich.ts'

let db: Database,
  app: FastifyInstance,
  preview: ImportPreview,
  imported: { boardId: string; reportId: string }
before(async () => {
  db = await createDatabase({ path: 'memory://' })
  app = await buildApp(db, {
    demo: false,
    mondayFetch: richMondayFetch,
    mondayDownload: richDownloadFetch,
  })
  preview = await previewMonday('synthetic-token', '900', richMondayFetch)
})
after(async () => {
  await app?.close()
  await db?.close()
})

test('complete monday preview covers nested items, comments/replies and every structured column without credentials', () => {
  assert.deepEqual(preview.mondayFolderPath, [
    { id: '91', name: 'TI' },
    { id: '92', name: 'Infraestrutura' },
  ])
  assert.deepEqual(preview.counts, {
    tasks: 2,
    subitems: 2,
    comments: 3,
    files: 3,
    bytes: pngBytes.length * 2,
  })
  assert.equal(preview.items?.find((item) => item.externalId === '202')?.parentExternalId, '201')
  assert.equal(
    preview.subitemColumns?.find((column) => column.sourceId === 'child_status')?.options?.[0]
      .label,
    'Planejado',
  )
  assert.equal(
    preview.columns
      ?.find((column) => column.sourceId === 'status')
      ?.options?.find((option) => option.label === 'Concluído')?.isDone,
    true,
  )
  assert.ok(preview.updates?.some((update) => update.externalId === 'u2'))
  assert.ok(
    preview.updates?.some(
      (update) => update.externalId === 'r1' && update.parentExternalId === 'u1',
    ),
  )
  assert.equal(preview.assets?.filter((asset) => asset.updateExternalId === 'u1').length, 1)
  assert.ok(!JSON.stringify(preview).includes('synthetic-sensitive-value'))
  assert.ok(!JSON.stringify(preview).includes('Untrusted provider note'))
  assert.ok(!JSON.stringify(preview).includes('public_url'))
  assert.equal(
    preview.items?.find((item) => item.externalId === '101')?.values['Dobro [formula]'],
    '20',
  )
})

test('session-backed import preserves source labels, time, hierarchy, same-name groups, comments, binary assets and formulas', async () => {
  const preparing = await app.inject({
    method: 'POST',
    url: '/api/monday/preview',
    payload: { token: 'synthetic-token', boardId: '900' },
  })
  assert.equal(preparing.statusCode, 200, preparing.body)
  const client = preparing.json<ImportPreview>()
  assert.ok(client.sessionId)
  assert.deepEqual(client.mondayFolderPath, preview.mondayFolderPath)
  assert.equal(client.items, undefined)
  assert.ok(!preparing.body.includes('https://files.monday.com/'))
  const applying = await app.inject({
    method: 'POST',
    url: '/api/imports/apply',
    payload: {
      preview: { sessionId: client.sessionId },
      mapping: guessImportMapping(client),
      boardName: 'Importado completo',
    },
  })
  assert.equal(applying.statusCode, 200, applying.body)
  imported = applying.json()
  assert.equal(applying.json().imported, 4)
  assert.equal(applying.json().commentsImported, 3)
  assert.equal(applying.json().filesImported, 3)
  assert.equal(applying.json().automationsImported, 1)
  const state = await workspace(db),
    board = state.boards.find((board) => board.id === imported.boardId)!,
    tasks = state.tasks.filter((task) => task.boardId === board.id)
  const root = tasks.find((task) => task.externalId === '101')!,
    child = tasks.find((task) => task.externalId === '201')!,
    nested = tasks.find((task) => task.externalId === '202')!
  assert.deepEqual(board.settings?.mondayFolderPath, preview.mondayFolderPath)
  assert.equal(root.status, 'Concluído')
  assert.equal(child.status, 'Planejado')
  assert.equal(child.parentId, root.id)
  assert.equal(nested.parentId, child.id)
  assert.equal(root.createdAt, '2025-01-01T10:00:00.000Z')
  assert.equal(root.updatedAt, '2025-01-03T12:00:00.000Z')
  assert.equal(root.dueAt, '2025-01-05T15:00:00.000Z')
  assert.equal(isTaskDone(root, board), true)
  assert.equal(isOverdue({ ...root, dueDate: '2020-01-01' }, board), false)
  assert.match(root.description, /Descrição original/)
  assert.equal(
    state.groups.filter((group) => group.boardId === board.id && group.name === 'Demandas').length,
    2,
  )
  assert.notEqual(root.groupId, tasks.find((task) => task.externalId === '102')?.groupId)
  assert.equal(board.settings?.subitemStatusOptions?.[0].label, 'Planejado')
  assert.ok(
    board.settings?.subitemColumns?.includes(
      board.columns.find((column) => column.name === 'Verificado')!.id,
    ),
  )
  const value = (name: string) =>
    root.customValues[board.columns.find((column) => column.name === name)!.id]
  assert.deepEqual(JSON.parse(value('Cronograma')), { from: '2025-01-01', to: '2025-01-10' })
  assert.equal(value('Conferido'), 'true')
  assert.equal(JSON.parse(value('Horas')).duration, 120)
  assert.equal(board.columns.find((column) => column.name === 'Dobro')?.type, 'formula')
  assert.equal(board.columns.find((column) => column.name === 'Fórmula especial')?.type, 'external')
  assert.match(value('Fórmula especial'), /Resultado especial/)
  const reply = state.comments.find((comment) => comment.externalId === 'r1')!,
    message = state.comments.find((comment) => comment.externalId === 'u1')!
  assert.equal(reply.parentId, message.id)
  assert.equal(message.createdAt, '2025-01-02T10:00:00.000Z')
  assert.equal(
    state.people.find((person) => person.id === message.authorId)?.name,
    'Pessoa da origem',
  )
  const attachment = state.attachments!.find((file) => file.commentId === message.id)!
  const downloaded = await app.inject(`/api/files/${attachment.id}`)
  assert.deepEqual(downloaded.rawPayload, pngBytes)
  const image = await app.inject(`/api/files/${attachment.id}/preview`)
  assert.equal(image.headers['content-type'], 'image/png')
  const external = state.attachments!.find((file) => file.externalUrl)!
  const redirected = await app.inject(`/api/files/${external.id}`)
  assert.equal(redirected.headers.location, 'https://example.com/documento')
  const report = await app.inject(`/api/imports/${imported.reportId}/report`)
  assert.equal(report.statusCode, 200)
  assert.ok(
    report
      .json()
      .coverage.some(
        (entry: { sourceType: string; mode: string }) =>
          entry.sourceType === 'formula' && entry.mode === 'snapshot',
      ),
  )
  assert.ok(!report.body.includes('synthetic-sensitive-value'))
  assert.ok(!report.body.includes('public_url'))
})

test('imported rules execute locally and carry every descendant; source status and child labels remain editable', async () => {
  const state = await workspace(db),
    root = state.tasks.find(
      (task) => task.boardId === imported.boardId && task.externalId === '101',
    )!
  const first = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: { status: 'Em progresso', version: root.version },
  })
  assert.equal(first.statusCode, 200, first.body)
  const done = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: { status: 'Concluído', version: first.json().version },
  })
  assert.equal(done.statusCode, 200, done.body)
  assert.notEqual(done.json().groupId, root.groupId)
  const after = await workspace(db)
  assert.ok(
    after.tasks
      .filter((task) => task.boardId === imported.boardId)
      .every((task) => task.groupId === done.json().groupId),
  )
  const child = after.tasks.find(
    (task) => task.boardId === imported.boardId && task.externalId === '201',
  )!
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${child.id}`,
        payload: { status: 'Feito', version: child.version },
      })
    ).statusCode,
    200,
  )
  const reply = await app.inject({
    method: 'POST',
    url: `/api/tasks/${root.id}/comments`,
    payload: {
      body: 'Resposta local',
      parentId: after.comments.find((comment) => comment.externalId === 'u1')!.id,
    },
  })
  assert.equal(reply.statusCode, 201, reply.body)
})

test('reimport fills additional resources while preserving local edits and creates no duplicate tasks, contacts, comments, files or rules', async () => {
  await db.query("UPDATE boards SET settings=settings-'mondayFolderPath' WHERE id=$1", [
    imported.boardId,
  ])
  const before = await workspace(db),
    root = before.tasks.find(
      (task) => task.boardId === imported.boardId && task.externalId === '101',
    )!
  const numbers = before.boards
    .find((board) => board.id === imported.boardId)!
    .columns.find((column) => column.name === 'Quantidade')!
  await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: {
      title: 'Título editado localmente',
      version: root.version,
      customValues: { [numbers.id]: '99' },
    },
  })
  const prepared = await app.inject({
    method: 'POST',
    url: '/api/monday/preview',
    payload: { token: 'synthetic-token', boardId: '900' },
  })
  const client = prepared.json<ImportPreview>()
  const applied = await app.inject({
    method: 'POST',
    url: '/api/imports/apply',
    payload: {
      preview: { sessionId: client.sessionId },
      mapping: guessImportMapping(client),
      boardId: imported.boardId,
    },
  })
  assert.equal(applied.statusCode, 200, applied.body)
  assert.equal(applied.json().imported, 0)
  assert.equal(applied.json().skipped, 4)
  assert.equal(applied.json().commentsImported, 0)
  assert.equal(applied.json().filesImported, 0)
  assert.equal(applied.json().automationsImported, 0)
  const after = await workspace(db)
  assert.deepEqual(
    after.boards.find((board) => board.id === imported.boardId)?.settings?.mondayFolderPath,
    preview.mondayFolderPath,
  )
  assert.equal(after.tasks.find((task) => task.id === root.id)?.title, 'Título editado localmente')
  assert.equal(
    after.boards
      .find((board) => board.id === imported.boardId)
      ?.columns.find((column) => column.name === 'Dobro')?.type,
    'formula',
  )
  assert.equal(after.tasks.find((task) => task.id === root.id)?.customValues[numbers.id], '99')
  assert.equal(after.people.length, before.people.length)
  assert.equal(after.comments.length, before.comments.length)
  assert.equal(after.attachments!.length, before.attachments!.length)
  assert.equal((await app.inject(`/api/boards/${imported.boardId}/automations`)).json().length, 1)
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/imports/apply',
        payload: {
          preview: { sessionId: client.sessionId },
          mapping: guessImportMapping(client),
          boardId: imported.boardId,
        },
      })
    ).statusCode,
    400,
  )
})

test('unavailable parent folder leaves the board importable and warns about the missing path', async () => {
  const result = await previewMonday('synthetic-token', '900', async (url, init) => {
    const { query, variables } = JSON.parse(String(init?.body))
    if (query.includes('folders(ids:') && variables.ids[0] === '91')
      return Response.json({ data: { folders: [] } })
    return richMondayFetch(url, init)
  })
  assert.equal(result.mondayFolderPath, undefined)
  assert.match(result.warnings.join(' '), /caminho completo da pasta/)
  assert.equal(result.counts?.tasks, 2)
})

test('every column enum in the 2026-10 public schema has explicit coverage; unknown future types retain structured data', () => {
  const names =
    'auto_number board_relation button checkbox color_picker country creation_log date dependency direct_doc doc dropdown email file formula group hour integration item_assignees item_id last_updated link location long_text mirror name numbers people person phone progress rating status subtasks tags team text time_tracking timeline unsupported vote week world_clock'.split(
      ' ',
    )
  assert.deepEqual(Object.keys(MONDAY_CAPABILITIES).sort(), names.sort())
  for (const name of names) {
    assert.ok(mondayCapability(name).detail)
    assert.ok(mondayCapability(name).name)
  }
  assert.equal(mondayCapability('future_app_type').mode, 'snapshot')
  assert.equal(mondayCapability('future_app_type').type, 'external')
})

test('legacy text and newly discovered columns receive structured source values on existing tasks without losing local edits', async () => {
  const { applyImport } = await import('../server/imports.ts')
  const legacy: ImportPreview = {
    ...preview,
    items: undefined,
    columns: undefined,
    subitemColumns: undefined,
    updates: undefined,
    assets: undefined,
    automations: undefined,
  }
  const first = await applyImport(db, legacy, guessImportMapping(preview), {
    boardName: 'Importação antiga',
  })
  let state = await workspace(db)
  const board = state.boards.find((board) => board.id === first.boardId)!,
    root = state.tasks.find((task) => task.boardId === board.id && task.externalId === '101')!,
    period = board.columns.find((column) => column.name.startsWith('Cronograma ['))!
  await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: {
      version: root.version,
      title: 'Título local',
      description: 'Contexto local',
      customValues: { [period.id]: 'Anotação local no campo antigo' },
    },
  })
  const prepared = (
    await app.inject({
      method: 'POST',
      url: '/api/monday/preview',
      payload: { token: 'synthetic-token', boardId: '900' },
    })
  ).json<ImportPreview>()
  const applied = await app.inject({
    method: 'POST',
    url: '/api/imports/apply',
    payload: {
      preview: { sessionId: prepared.sessionId },
      mapping: guessImportMapping(prepared),
      boardId: board.id,
    },
  })
  assert.equal(applied.statusCode, 200, applied.body)
  state = await workspace(db)
  const updated = state.tasks.find((task) => task.id === root.id)!,
    updatedBoard = state.boards.find((entry) => entry.id === board.id)!
  assert.equal(updated.title, 'Título local')
  assert.match(updated.description, /Contexto local/)
  assert.match(updated.description, /Anotação local no campo antigo/)
  assert.equal(updatedBoard.columns.find((column) => column.id === period.id)?.type, 'timeline')
  assert.deepEqual(JSON.parse(updated.customValues[period.id]), {
    from: '2025-01-01',
    to: '2025-01-10',
  })
  for (const [name, expected] of [
    ['Conferido', 'true'],
    ['Horas', '120'],
  ]) {
    const column = updatedBoard.columns.find((column) => column.name === name)!,
      value = updated.customValues[column.id]
    assert.equal(name === 'Horas' ? String(JSON.parse(value).duration) : value, expected)
  }
  assert.equal(state.tasks.filter((task) => task.boardId === board.id).length, 4)
})

test('empty source boards still import independent subitem definitions and same-name empty groups', async () => {
  const emptyFetch: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.variables?.ids?.[0] === '900' && body.query.includes('boards(ids:')) {
      const fixture = richMondayFixture()
      return Response.json({
        data: {
          boards: [
            {
              ...fixture.board,
              columns: [
                ...fixture.board.columns,
                {
                  id: 'subitems',
                  title: 'Subitens',
                  type: 'subtasks',
                  settings: { boardIds: [901] },
                },
              ],
              items_page: { cursor: null, items: [] },
            },
          ],
        },
      })
    }
    return richMondayFetch(url, init)
  }
  const empty = await previewMonday('synthetic-token', '900', emptyFetch)
  assert.equal(empty.items?.length, 0)
  assert.ok(empty.subitemColumns?.some((column) => column.sourceId === 'child_status'))
  const { applyImport } = await import('../server/imports.ts')
  const result = await applyImport(db, empty, guessImportMapping(empty), {
    boardName: 'Estrutura vazia',
  })
  const state = await workspace(db),
    board = state.boards.find((board) => board.id === result.boardId)!
  assert.equal(result.imported, 0)
  assert.equal(
    state.groups.filter((group) => group.boardId === board.id && group.name === 'Demandas').length,
    2,
  )
  assert.equal(board.settings?.subitemStatusOptions?.[0].label, 'Planejado')
})

test('renaming root and independent child labels updates the right tasks and preserves rule conditions and completion flags', async () => {
  const before = await workspace(db),
    board = before.boards.find((board) => board.id === imported.boardId)!
  const statusOptions = board.settings!.statusOptions!.map((option) => ({
    ...option,
    label: option.label === 'Concluído' ? 'Entregue' : option.label,
  }))
  const subitemStatusOptions = board.settings!.subitemStatusOptions!.map((option) => ({
    ...option,
    label: option.label === 'Feito' ? 'Subitem entregue' : option.label,
  }))
  const renamed = await app.inject({
    method: 'PATCH',
    url: `/api/boards/${board.id}`,
    payload: { settings: { statusOptions, subitemStatusOptions } },
  })
  assert.equal(renamed.statusCode, 200, renamed.body)
  const after = await workspace(db),
    updated = after.boards.find((entry) => entry.id === board.id)!,
    root = after.tasks.find((task) => task.boardId === board.id && task.externalId === '101')!,
    child = after.tasks.find((task) => task.boardId === board.id && task.externalId === '201')!
  assert.equal(root.status, 'Entregue')
  assert.equal(child.status, 'Subitem entregue')
  assert.equal(isTaskDone(root, updated), true)
  assert.equal(isTaskDone(child, updated), true)
  const rules = (await app.inject(`/api/boards/${board.id}/automations`)).json()
  assert.equal(rules[0].optionId, statusOptions.find((option) => option.label === 'Entregue')!.id)
  const usedRemoval = await app.inject({
    method: 'PATCH',
    url: `/api/boards/${board.id}`,
    payload: {
      settings: { statusOptions: statusOptions.filter((option) => option.label !== 'Entregue') },
    },
  })
  assert.equal(usedRemoval.statusCode, 400)
})

test('native rich cells validate periods, checkbox values and timer state; read-only snapshots cannot be overwritten', async () => {
  const state = await workspace(db),
    board = state.boards.find((board) => board.id === imported.boardId)!,
    root = state.tasks.find((task) => task.boardId === board.id && task.externalId === '101')!
  const column = (name: string) => board.columns.find((column) => column.name === name)!
  const invalidPeriod = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: {
      version: root.version,
      customValues: { [column('Cronograma').id]: '{"from":"2026-12-01","to":"2026-11-01"}' },
    },
  })
  assert.equal(invalidPeriod.statusCode, 400)
  const invalidCheck = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: { version: root.version, customValues: { [column('Conferido').id]: 'maybe' } },
  })
  assert.equal(invalidCheck.statusCode, 400)
  const started = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: {
      version: root.version,
      customValues: {
        [column('Horas').id]: JSON.stringify({
          duration: 120,
          startedAt: new Date().toISOString(),
          sessions: [],
        }),
      },
    },
  })
  assert.equal(started.statusCode, 200, started.body)
  const forbidden = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${root.id}`,
    payload: {
      version: started.json().version,
      customValues: { [column('Última atualização').id]: 'forged' },
    },
  })
  assert.equal(forbidden.statusCode, 400)
  const unchanged = (await app.inject('/api/workspace'))
    .json<Workspace>()
    .tasks.find((task) => task.id === root.id)!
  assert.equal(unchanged.version, started.json().version)
})

test('asset staging blocks foreign/private redirects, never forwards a token and reports unavailable bytes', async () => {
  let calls = 0
  const sessions = createMondaySessions(async (_url, init) => {
    calls++
    assert.equal(init?.headers, undefined)
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } })
  })
  try {
    const bundle = await prepareMondayPreview('synthetic-token', '900', richMondayFetch)
    const client = await sessions.stage(bundle)
    const session = await sessions.lease(client.sessionId!)
    assert.equal(calls, 2)
    assert.equal(session.files.size, 0)
    assert.ok(
      client.coverage?.some((entry) => entry.sourceType === 'file' && entry.mode === 'unavailable'),
    )
    assert.ok(!JSON.stringify(client).includes('https://files.monday.com/'))
    await sessions.finish(session, true)
    await assert.rejects(() => sessions.lease(client.sessionId!), /expirou/)
    assert.deepEqual(publicSourceData({ auth: { secret: 'x' }, nested: { token: 'x', keep: 1 } }), {
      nested: { keep: 1 },
    })
  } finally {
    await sessions.close()
  }
})
