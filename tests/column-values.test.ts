import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase, type Database } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import {
  compileFormula,
  displayFormula,
  evaluateFormula,
  validateFormulaCycles,
} from '../shared/formulas.ts'
import { boardColumns } from '../shared/columns.ts'
import {
  MAX_FILE_SIZE,
  type Board,
  type CustomColumn,
  type Task,
  type Workspace,
} from '../shared/domain.ts'
import type { FastifyInstance } from 'fastify'

const sourceColumns: CustomColumn[] = [
  { id: 'n', name: 'Quantidade', type: 'number' },
  { id: 'price', name: 'Preço', type: 'number' },
  { id: 'status', name: 'Status', type: 'status' },
]
const exampleTask = {
  id: 'task',
  title: 'Exemplo',
  status: 'Feito',
  customValues: { n: '3', price: '2.5' },
} as unknown as Task
function calculation(expression: string, task = exampleTask) {
  const column: CustomColumn = { id: 'formula', name: 'Total', type: 'formula' }
  const columns = [...sourceColumns, column]
  column.formula = compileFormula(expression, columns)
  return evaluateFormula(column, columns, task)
}
test('formulas calculate precedence, percentages, conditionals, numeric references and Excel-style functions', () => {
  for (const [expression, expected] of [
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['-2^2', -4],
    ['2^3^2', 512],
    ['100 * 10%', 10],
    ['{Quantidade} * {Preço}', 7.5],
    ['{Preço}', 2.5],
    ['SOMA(1; 2; 3)', 6],
    ['MÉDIA(2; 4)', 3],
    ['MIN(2; 4)', 2],
    ['MAX(2; 4)', 4],
    ['ARRED(2.555; 2)', 2.56],
    ['ROUND(-2.555, 2)', -2.56],
    ['ABS(-3)', 3],
    ['SE({Status}="feito"; 10; 1/0)', 10],
    ['IF(FALSE;1/0;3)', 3],
    ['SEERRO(1/0;99)', 99],
    ['SEERRO(1e999;5)', 5],
    ['E({Quantidade}>0;{Status}="Feito")', true],
    ['OU(0;1)', true],
    ['CONCAT("Total: "; "{Quantidade}")', 'Total: {Quantidade}'],
    ['"Olá" & " mundo"', 'Olá mundo'],
  ] as const)
    assert.equal(calculation(expression).value, expected, expression)
  assert.equal(calculation('{Quantidade}', { ...exampleTask, customValues: {} }).value, 0)
  assert.equal(calculation('1/0').code, '#DIV/0!')
  assert.equal(calculation('"texto" + 1').code, '#VALOR!')
  assert.equal(calculation('1e999').code, '#NÚM!')
  assert.equal(
    calculation('CONCAT("' + 'x'.repeat(1500) + '";"' + 'y'.repeat(400) + '")').value?.toString()
      .length,
    1900,
  )
})
test('formulas bind stable IDs, reject code, ambiguous names, invalid syntax and circular dependencies', () => {
  const formula: CustomColumn = {
    id: 'f',
    name: 'Total',
    type: 'formula',
    formula: compileFormula('{Quantidade} * {Preço}', sourceColumns),
  }
  const renamed = [
    { ...sourceColumns[0], name: 'Unidades' },
    sourceColumns[1],
    sourceColumns[2],
    formula,
  ]
  assert.match(displayFormula(formula.formula!, renamed), /\{Unidades\}/)
  const braces = [{ ...sourceColumns[0], name: '{Quantidade}' }, sourceColumns[1], formula]
  assert.doesNotThrow(() => compileFormula(displayFormula(formula.formula!, braces), braces))
  assert.equal(evaluateFormula(formula, renamed, exampleTask).value, 7.5)
  assert.equal(
    evaluateFormula(
      formula,
      renamed.filter((c) => c.id !== 'price'),
      exampleTask,
    ).code,
    '#REF!',
  )
  for (const invalid of [
    'globalThis.alert(1)',
    'constructor("return process")()',
    'SOMA()',
    '2 +',
    '1;2',
    'SOMA(1;2',
    '{Ausente}',
    '(',
    '1'.repeat(2001),
  ])
    assert.throws(() => compileFormula(invalid, sourceColumns), invalid)
  assert.throws(() =>
    compileFormula('{Quantidade}', [
      ...sourceColumns,
      { id: 'other', name: 'Quantidade', type: 'number' },
    ]),
  )
  const cycle: CustomColumn[] = [
    { id: 'a', name: 'A', type: 'formula', formula: '{#b}' },
    { id: 'b', name: 'B', type: 'formula', formula: '{#a}' },
  ]
  assert.throws(() => validateFormulaCycles(cycle), /circular/)
  assert.equal(evaluateFormula(cycle[0], cycle, exampleTask).code, '#CICLO!')
  assert.throws(
    () => compileFormula('('.repeat(40) + '1' + ')'.repeat(40), sourceColumns),
    /níveis/,
  )
})

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
async function fixture() {
  const board = (
    await app.inject({
      method: 'POST',
      url: '/api/boards',
      payload: { name: 'Arquivos e fórmulas' },
    })
  ).json<Board>()
  const state = (await app.inject('/api/workspace')).json<Workspace>()
  const group = state.groups.find((g) => g.boardId === board.id && !g.isCompleted)!
  const task = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: group.id, title: 'Calcular entrega' },
    })
  ).json<Task>()
  return { board, task, group }
}
async function column(boardId: string, name: string, type: string, formula?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/boards/${boardId}/columns`,
    payload: { name, type, ...(formula ? { formula } : {}) },
  })
}
async function upload(
  taskId: string,
  columnId: string,
  content: Uint8Array | Buffer,
  name = 'contrato.txt',
) {
  const body = new FormData()
  body.append('file', new Blob([new Uint8Array(content)]), name)
  const request = new Request('http://localhost/upload', { method: 'POST', body })
  return app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/files/${columnId}`,
    headers: { 'content-type': request.headers.get('content-type')! },
    payload: Buffer.from(await request.arrayBuffer()),
  })
}
test('file upload, metadata, byte-for-byte download, restart and deletion preserve tasks and isolate cells', async () => {
  const { board, task } = await fixture()
  const files = (await column(board.id, 'Anexos', 'files')).json<CustomColumn>()
  const content = Buffer.from([0, 1, 255, 100, 20])
  const sent = await upload(task.id, files.id, content, 'ação.txt')
  assert.equal(sent.statusCode, 201, sent.body)
  const meta = sent.json()
  assert.equal(meta.name, 'ação.txt')
  assert.equal(meta.size, 5)
  assert.equal(meta.content, undefined)
  const snapshot = (await app.inject('/api/workspace')).json<Workspace>()
  assert.ok(snapshot.attachments?.some((f) => f.id === meta.id))
  const received = await app.inject(`/api/files/${meta.id}`)
  assert.deepEqual(received.rawPayload, content)
  assert.match(
    received.headers['content-disposition'] as string,
    /filename\*=UTF-8''a%C3%A7%C3%A3o.txt/,
  )
  assert.equal(received.headers['content-type'], 'application/octet-stream')
  await app.close()
  app = await buildApp(db, { demo: false })
  await app.ready()
  assert.deepEqual((await app.inject(`/api/files/${meta.id}`)).rawPayload, content)
  const other = await fixture()
  assert.equal((await upload(other.task.id, files.id, content)).statusCode, 404)
  const text = (await column(board.id, 'Texto', 'text')).json<CustomColumn>()
  assert.equal((await upload(task.id, text.id, content)).statusCode, 404)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        payload: { version: task.version, customValues: { [files.id]: '["fake"]' } },
      })
    ).statusCode,
    400,
  )
  assert.equal(
    (await app.inject({ method: 'DELETE', url: `/api/files/${meta.id}` })).statusCode,
    204,
  )
  assert.equal((await app.inject(`/api/files/${meta.id}`)).statusCode, 404)
  assert.ok(
    (await app.inject('/api/workspace')).json<Workspace>().tasks.some((t) => t.id === task.id),
  )
})
test('file limits, safe filenames, subitems, task cascade and column deletion clean the correct attachments', async () => {
  const { board, task, group } = await fixture()
  const files = (await column(board.id, 'Anexos', 'files')).json<CustomColumn>()
  const large = await upload(task.id, files.id, Buffer.alloc(MAX_FILE_SIZE + 1))
  assert.equal(large.statusCode, 413, large.body)
  for (let i = 0; i < 20; i++)
    assert.equal(
      (await upload(task.id, files.id, Buffer.from('ok'), `doc-${i}.txt`)).statusCode,
      201,
    )
  assert.equal((await upload(task.id, files.id, Buffer.from('extra'))).statusCode, 400)
  const child = (
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { boardId: board.id, groupId: group.id, parentId: task.id, title: 'Subitem' },
    })
  ).json<Task>()
  const attached = await upload(child.id, files.id, Buffer.from('child'), '../documento.html')
  assert.equal(attached.statusCode, 201, attached.body)
  assert.equal(attached.json().name, 'documento.html')
  const id = attached.json().id
  assert.equal(
    (await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}/columns/${files.id}` }))
      .statusCode,
    204,
  )
  assert.equal((await app.inject(`/api/files/${id}`)).statusCode, 404)
  assert.equal(
    (
      await db.query('SELECT id FROM task_files WHERE task_id=ANY($1::text[])', [
        [task.id, child.id],
      ])
    ).rows.length,
    0,
  )
  const second = (await column(board.id, 'Outros', 'files')).json<CustomColumn>()
  const last = (await upload(child.id, second.id, Buffer.from('cleanup'))).json()
  await app.inject({ method: 'DELETE', url: '/api/tasks', payload: { ids: [task.id] } })
  assert.equal((await app.inject(`/api/files/${last.id}`)).statusCode, 404)
})
test('formula configuration persists, recalculates values, exports results and rejects cycles or overwriting calculated cells', async () => {
  const { board, task } = await fixture()
  const qty = (await column(board.id, 'Quantidade', 'number')).json<CustomColumn>()
  const price = (await column(board.id, 'Preço', 'number')).json<CustomColumn>()
  assert.equal((await column(board.id, 'Inválida', 'formula')).statusCode, 400)
  const response = await column(board.id, 'Total', 'formula', 'ARRED({Quantidade} * {Preço}; 2)')
  assert.equal(response.statusCode, 201, response.body)
  const total = response.json<CustomColumn>()
  let updated = (
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { version: task.version, customValues: { [qty.id]: '3', [price.id]: '2.5' } },
    })
  ).json<Task>()
  let current = (await app.inject('/api/workspace'))
    .json<Workspace>()
    .boards.find((b) => b.id === board.id)!
  assert.equal(evaluateFormula(total, boardColumns(current), updated).value, 7.5)
  await app.inject({
    method: 'PATCH',
    url: `/api/boards/${board.id}/columns/${qty.id}`,
    payload: { name: 'Unidades' },
  })
  current = (await app.inject('/api/workspace'))
    .json<Workspace>()
    .boards.find((b) => b.id === board.id)!
  assert.equal(evaluateFormula(total, boardColumns(current), updated).value, 7.5)
  updated = (
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { version: updated.version, customValues: { [qty.id]: '4' } },
    })
  ).json<Task>()
  assert.equal(evaluateFormula(total, boardColumns(current), updated).value, 10)
  assert.match((await app.inject(`/api/boards/${board.id}/export`)).body, /"10"/)
  const dependent = (await column(board.id, 'Final', 'formula', '{Total} + 1')).json<CustomColumn>()
  const circular = await app.inject({
    method: 'PATCH',
    url: `/api/boards/${board.id}/columns/${total.id}`,
    payload: { formula: '{Final} + 1' },
  })
  assert.equal(circular.statusCode, 400, circular.body)
  assert.match(circular.json().message, /circular/)
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${task.id}`,
        payload: { version: updated.version, customValues: { [dependent.id]: '100' } },
      })
    ).statusCode,
    400,
  )
  await app.inject({ method: 'DELETE', url: `/api/boards/${board.id}/columns/${price.id}` })
  current = (await app.inject('/api/workspace'))
    .json<Workspace>()
    .boards.find((b) => b.id === board.id)!
  assert.equal(evaluateFormula(total, boardColumns(current), updated).code, '#REF!')
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/boards/${board.id}/columns/${total.id}`,
        payload: { hidden: true },
      })
    ).statusCode,
    200,
  )
})
