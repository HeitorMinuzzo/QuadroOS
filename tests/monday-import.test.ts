import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createDatabase, type Database } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { previewMonday, type MondayFetch } from '../server/monday.ts'
import { applyImport } from '../server/imports.ts'
import { workspace } from '../server/repository.ts'
import { guessImportMapping } from '../shared/imports.ts'
import type { ImportPreview } from '../shared/domain.ts'
import { mondayFixture } from './fixtures/monday.ts'

const fetcher: MondayFetch = async (_url, init) => {
  const query = JSON.parse(init!.body as string).query as string
  assert.ok(!query.includes('mutation'))
  if (query.includes('users('))
    return new Response(
      JSON.stringify({ data: { users: [{ id: '42', name: 'Você', email: 'voce@quadro.local' }] } }),
    )
  return new Response(JSON.stringify({ data: { boards: [mondayFixture()] } }))
}
let db: Database
let app: FastifyInstance
let preview: ImportPreview
before(async () => {
  db = await createDatabase({ path: 'memory://' })
  app = await buildApp(db, { demo: false, mondayFetch: fetcher })
  preview = await previewMonday('simulated-token', '900', fetcher)
})
after(async () => {
  await app?.close()
  await db?.close()
})

test('monday preview preserves typed metadata, raw dates/numbers, complete label palettes and multi-select values', () => {
  const column = (name: string) => preview.columns!.find((c) => c.name === name)!
  assert.equal(column('SETOR').type, 'status')
  assert.deepEqual(
    column('SETOR').options?.map((o) => [o.label, o.color]),
    [
      ['EXPORTAÇÃO', '#df2f4a'],
      ['FISCAL', '#9cd326'],
      ['PCP', '#784bd1'],
    ],
  )
  const value = (name: string) => preview.rows[0][preview.headers.indexOf(column(name).header)]
  assert.equal(value('Prazo'), '2026-10-30')
  assert.equal(value('Orçamento'), '1234.50')
  assert.deepEqual(JSON.parse(value('Áreas')), ['Compras, exterior', 'Financeiro'])
  assert.ok(preview.warnings.some((warning) => warning.includes('calculadas')))
  assert.ok(!JSON.stringify(preview).includes('simulated-token'))
  const mapping = guessImportMapping(preview)
  assert.equal(mapping[column('SETOR').header], 'custom')
  assert.equal(mapping[column('Status').header], 'status')
  assert.equal(mapping[column('Revisão').header], 'custom')
  assert.equal(mapping[column('Aprovadores').header], 'custom')
})

test('typed monday import persists editable custom cells, source order, colors and empty groups; repeat skips stable IDs', async () => {
  const mapping = guessImportMapping(preview)
  const response = await app.inject({
    method: 'POST',
    url: '/api/imports/apply',
    payload: {
      preview,
      mapping,
      boardName: 'Tipos preservados',
    },
  })
  assert.equal(response.statusCode, 200, response.body)
  const result = response.json()
  let state = await workspace(db)
  const board = state.boards.find((b) => b.id === result.boardId)!
  const sector = board.columns.find((c) => c.name === 'SETOR')!
  const task = state.tasks.find((t) => t.boardId === board.id && t.externalId === '101')!
  assert.equal(sector.type, 'status')
  assert.equal(task.customValues[sector.id], 'FISCAL')
  assert.equal(task.status, 'Feito')
  assert.equal(
    state.tasks.find((t) => t.boardId === board.id && t.externalId === '102')?.status,
    'Em testes',
  )
  assert.equal(board.columns.find((c) => c.name === 'Orçamento')?.type, 'number')
  assert.equal(board.columns.find((c) => c.name === 'Revisão')?.type, 'date')
  const reviewers = board.columns.find((c) => c.name === 'Aprovadores')!
  assert.deepEqual(JSON.parse(task.customValues[reviewers.id]), ['person-you'])
  const observations = board.columns.filter((c) => c.name === 'Observação')
  assert.equal(observations.length, 2)
  assert.notEqual(task.customValues[observations[0].id], task.customValues[observations[1].id])
  assert.deepEqual(board.settings?.hiddenColumns, ['priority'])
  assert.equal(board.settings?.columnOrder?.[1], 'status')
  assert.deepEqual(
    state.groups.filter((g) => g.boardId === board.id).map((g) => [g.name, g.color]),
    [
      ['Demandas', '#df2f4a'],
      ['Grupo vazio', '#784bd1'],
    ],
  )
  const edit = await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: {
      version: task.version,
      customValues: { [sector.id]: 'PCP' },
    },
  })
  assert.equal(edit.statusCode, 200, edit.body)
  const repeated = await applyImport(
    db,
    preview,
    { ...mapping, 'ID monday': 'ignore' },
    { boardId: board.id },
  )
  assert.equal(repeated.imported, 0)
  assert.equal(repeated.skipped, 2)
  state = await workspace(db)
  assert.equal(state.tasks.find((t) => t.id === task.id)?.customValues[sector.id], 'PCP')
  assert.equal(state.boards.find((b) => b.id === board.id)?.columns.length, board.columns.length)
  const renamed = await app.inject({
    method: 'PATCH',
    url: `/api/boards/${board.id}/columns/${sector.id}`,
    payload: {
      name: 'Setor da equipe',
      options: sector.options!.map((option) =>
        option.label === 'PCP' ? { ...option, label: 'PCP local', color: '#0073ea' } : option,
      ),
    },
  })
  assert.equal(renamed.statusCode, 200, renamed.body)
  const newRow = [...preview.rows[0]]
  newRow[0] = 'Terceira demanda'
  newRow[2] = '103'
  newRow[preview.headers.indexOf(preview.columns!.find((c) => c.name === 'SETOR')!.header)] = 'PCP'
  await applyImport(db, { ...preview, rows: [...preview.rows, newRow] }, mapping, {
    boardId: board.id,
  })
  state = await workspace(db)
  assert.equal(
    state.boards.find((b) => b.id === board.id)!.columns.find((c) => c.id === sector.id)?.name,
    'Setor da equipe',
  )
  assert.equal(
    state.tasks.find((t) => t.boardId === board.id && t.externalId === '103')?.customValues[
      sector.id
    ],
    'PCP local',
  )
})

test('reimport upgrades legacy text columns atomically without duplicating or overwriting task edits', async () => {
  const legacy = { ...preview, columns: undefined, groups: undefined }
  const mapping = guessImportMapping(preview)
  const original = await applyImport(db, legacy, mapping, { boardName: 'Importação antiga' })
  const before = await workspace(db)
  const oldBoard = before.boards.find((b) => b.id === original.boardId)!
  const oldSector = oldBoard.columns.find((c) => c.name.startsWith('SETOR ['))!
  const oldTask = before.tasks.find((t) => t.boardId === original.boardId)!
  await app.inject({
    method: 'PATCH',
    url: `/api/tasks/${oldTask.id}`,
    payload: {
      version: oldTask.version,
      title: 'Edição local preservada',
    },
  })
  const result = await applyImport(db, preview, mapping, { boardId: original.boardId })
  assert.equal(result.imported, 0)
  const after = await workspace(db)
  const newBoard = after.boards.find((b) => b.id === original.boardId)!
  assert.equal(newBoard.columns.find((c) => c.id === oldSector.id)?.type, 'status')
  assert.equal(newBoard.columns.find((c) => c.id === oldSector.id)?.name, 'SETOR')
  assert.equal(after.tasks.find((t) => t.id === oldTask.id)?.title, 'Edição local preservada')
  const dropdown = newBoard.columns.find((c) => c.name === 'Áreas')!
  assert.deepEqual(
    JSON.parse(after.tasks.find((t) => t.id === oldTask.id)!.customValues[dropdown.id]),
    ['Compras, exterior', 'Financeiro'],
  )
  assert.equal(after.tasks.filter((t) => t.boardId === newBoard.id).length, 2)
})

test('legacy label settings use configured colors/order and invalid metadata cannot partially create a board', async () => {
  const board = mondayFixture()
  const column = board.columns.find((c) => c.id === 'sector')!
  const legacyBoard = {
    ...board,
    columns: board.columns.map((c) =>
      c !== column
        ? c
        : {
            id: c.id,
            title: c.title,
            type: c.type,
            settings_str: JSON.stringify({
              labels: { 2: 'FISCAL', 3: 'EXPORTAÇÃO', 4: 'PCP' },
              labels_positions_v2: { 2: 1, 3: 0, 4: 2 },
              labels_colors: {
                2: { color: '#9cd326' },
                3: { color: '#df2f4a' },
                4: { color: '#784bd1' },
              },
            }),
          },
    ),
  }
  const legacyPreview = await previewMonday(
    'fake-token',
    '901',
    async () => new Response(JSON.stringify({ data: { boards: [legacyBoard] } })),
  )
  assert.deepEqual(
    legacyPreview.columns?.find((c) => c.name === 'SETOR')?.options,
    preview.columns?.find((c) => c.name === 'SETOR')?.options,
  )
  const before = (await workspace(db)).boards.length
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/imports/apply',
    payload: {
      preview: { ...preview, columns: [{ ...preview.columns![0], header: 'Inexistente' }] },
      mapping: guessImportMapping(preview),
      boardName: 'Não criar',
    },
  })
  assert.equal(invalid.statusCode, 400)
  assert.equal((await workspace(db)).boards.length, before)
})

test('monday contacts preserve multiple owners and names with commas; users can disable contact creation', async () => {
  const source = mondayFixture()
  source.items_page.items[0].column_values.find((v) => v.id === 'owner')!.value =
    '{"personsAndTeams":[{"id":56,"kind":"person"},{"id":42,"kind":"person"}]}'
  source.items_page.items[0].column_values.find((v) => v.id === 'reviewers')!.value =
    '{"personsAndTeams":[{"id":56,"kind":"person"}]}'
  const contactPreview = await previewMonday('fake-token', '902', async (_url, init) => {
    const query = JSON.parse(init!.body as string).query as string
    return new Response(
      JSON.stringify({
        data: query.includes('users(')
          ? {
              users: [
                { id: '42', name: 'Você', email: 'voce@quadro.local' },
                { id: '56', name: 'Pessoa, Externa', email: 'externa@example.test' },
              ],
            }
          : { boards: [source] },
      }),
    )
  })
  const mapping = guessImportMapping(contactPreview)
  const without = await applyImport(db, contactPreview, mapping, {
    boardName: 'Sem novos contatos',
    importPeople: false,
  })
  let state = await workspace(db)
  assert.ok(!state.people.some((p) => p.email === 'externa@example.test'))
  const unmatched = state.tasks.find(
    (t) => t.boardId === without.boardId && t.externalId === '101',
  )!
  assert.deepEqual(unmatched.ownerIds, ['person-you'])
  assert.match(unmatched.description, /Pessoa, Externa \(externa@example.test\)/)
  const withContacts = await applyImport(db, contactPreview, mapping, { boardName: 'Com contatos' })
  state = await workspace(db)
  const person = state.people.find((p) => p.email === 'externa@example.test')!
  assert.equal(person.name, 'Pessoa, Externa')
  const task = state.tasks.find(
    (t) => t.boardId === withContacts.boardId && t.externalId === '101',
  )!
  assert.deepEqual(task.ownerIds, [person.id, 'person-you'])
  const reviewers = state.boards
    .find((b) => b.id === withContacts.boardId)!
    .columns.find((c) => c.name === 'Aprovadores')!
  assert.deepEqual(JSON.parse(task.customValues[reviewers.id]), [person.id])
  await applyImport(db, contactPreview, mapping, { boardId: withContacts.boardId })
  assert.equal((await workspace(db)).people.filter((p) => p.email === person.email).length, 1)
})
