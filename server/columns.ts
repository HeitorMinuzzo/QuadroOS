import { randomUUID } from 'node:crypto'
import {
  type Board,
  type CustomColumn,
  type ColumnType,
  type LabelOption,
  type Person,
  DEFAULT_STATUS_OPTIONS,
} from '../shared/domain.ts'
import { boardColumns, columnList, SYSTEM_COLUMN_IDS } from '../shared/columns.ts'
import { camelRow, type Database } from './database.ts'
import { DomainError } from './errors.ts'
import { compileFormula, FormulaError, validateFormulaCycles } from '../shared/formulas.ts'
import { validateRichValue } from '../shared/rich-values.ts'

function configureFormula(board: Board, column: CustomColumn, source?: string) {
  if (column.type !== 'formula') {
    delete column.formula
    return
  }
  try {
    const columns = boardColumns({
      ...board,
      columns: [...board.columns.filter((c) => c.id !== column.id), column],
    })
    column.formula = compileFormula(source || '', columns)
    validateFormulaCycles(columns.map((c) => (c.id === column.id ? column : c)))
  } catch (e) {
    if (e instanceof FormulaError) throw new DomainError(e.message)
    throw e
  }
}

async function lockedBoard(db: Database, boardId: string) {
  const row = (await db.query('SELECT * FROM boards WHERE id=$1 FOR UPDATE', [boardId])).rows[0]
  if (!row) throw new DomainError('Quadro não encontrado.', 404)
  return camelRow<Board>(row)
}
function optionsFor(type: ColumnType, options?: LabelOption[]) {
  if (type !== 'status' && type !== 'dropdown') return undefined
  const result =
    options ??
    (type === 'status'
      ? DEFAULT_STATUS_OPTIONS
      : [
          { id: randomUUID(), label: 'Opção 1', color: '#0073ea' },
          { id: randomUUID(), label: 'Opção 2', color: '#8b79bd' },
        ])
  if (
    !result.length ||
    new Set(result.map((o) => o.id)).size !== result.length ||
    new Set(result.map((o) => o.label.toLocaleLowerCase('pt-BR'))).size !== result.length
  )
    throw new DomainError('As opções precisam ter nomes e identificadores únicos.')
  return result
}
function validDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value))
    return validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function checkedValue(column: CustomColumn, value: string, people: Person[]) {
  if (column.type === 'last_updated' || (column.type === 'external' && column.source?.readOnly))
    throw new DomainError(
      'Esta coluna é calculada ou preservada da origem e não aceita edição direta.',
    )
  if (!value) return ''
  if (['timeline', 'checkbox', 'time_tracking', 'external'].includes(column.type)) {
    try {
      return validateRichValue(column, value)
    } catch (error) {
      throw new DomainError(
        error instanceof Error ? error.message : 'O valor da coluna é inválido.',
      )
    }
  }
  if (column.type === 'formula')
    throw new DomainError(`A coluna “${column.name}” é calculada automaticamente.`)
  if (column.type === 'files')
    throw new DomainError(`Use o envio de arquivos para preencher “${column.name}”.`)
  if (column.type === 'text') return value
  if (column.type === 'number') {
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ||
      !Number.isFinite(Number(value))
    )
      throw new DomainError(`A coluna “${column.name}” aceita apenas números válidos.`)
    return value
  }
  if (column.type === 'date') {
    if (!validDate(value))
      throw new DomainError(`A coluna “${column.name}” precisa de uma data válida.`)
    return value
  }
  if (column.type === 'status') {
    if (!column.options?.some((option) => option.label === value))
      throw new DomainError(`Escolha uma etiqueta válida para “${column.name}”.`)
    return value
  }
  let values: unknown
  try {
    values = JSON.parse(value)
  } catch {
    throw new DomainError(`A seleção de “${column.name}” não é válida.`)
  }
  if (!Array.isArray(values) || !values.every((item) => typeof item === 'string'))
    throw new DomainError(`A seleção de “${column.name}” não é válida.`)
  const allowed =
    column.type === 'people' ? people.map((p) => p.id) : column.options?.map((o) => o.label) || []
  if (values.some((item) => !allowed.includes(item)))
    throw new DomainError(`A seleção de “${column.name}” contém pessoas ou opções que não existem.`)
  return JSON.stringify([...new Set(values)])
}
export async function validateCustomValues(
  db: Database,
  boardId: string,
  values: Record<string, string>,
) {
  if (!Object.keys(values).length) return values
  const board = camelRow<Board>(
    (await db.query('SELECT * FROM boards WHERE id=$1', [boardId])).rows[0],
  )
  const people = (await db.query('SELECT * FROM people')).rows.map((p) => camelRow<Person>(p))
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const column = board.columns.find((c) => c.id === key)
      if (board.settings?.deletedColumnIds?.includes(key))
        throw new DomainError('Esta coluna foi excluída. Atualize o quadro antes de continuar.')
      // Preserve older integrations' extra values; validate every configured column.
      return [key, column ? checkedValue(column, value, people) : value]
    }),
  )
}
export async function addColumn(
  db: Database,
  boardId: string,
  input: {
    name: string
    type: ColumnType
    options?: LabelOption[]
    scope?: 'tasks' | 'subitems'
    formula?: string
  },
) {
  const board = await lockedBoard(db, boardId)
  if (board.columns.length >= 100)
    throw new DomainError('O quadro permite até 100 colunas personalizadas nesta versão.')
  const column: CustomColumn = {
    id: randomUUID(),
    name: input.name,
    type: input.type,
    options: optionsFor(input.type, input.options),
  }
  if (input.formula !== undefined && input.type !== 'formula')
    throw new DomainError('A expressão só pode ser usada em uma coluna de Fórmula.')
  configureFormula(board, column, input.formula)
  const settings = { ...board.settings }
  if (input.scope === 'subitems') {
    settings.subitemColumns = [
      ...new Set([...(settings.subitemColumns || ['owner', 'status', 'date']), column.id]),
    ]
    settings.hiddenColumns = [...new Set([...(settings.hiddenColumns || []), column.id])]
  }
  await db.query('UPDATE boards SET columns=$1::jsonb,settings=$2::jsonb WHERE id=$3', [
    JSON.stringify([...board.columns, column]),
    JSON.stringify(settings),
    boardId,
  ])
  return column
}
function convertedValue(old: CustomColumn, next: CustomColumn, value: string, people: Person[]) {
  if (!value) return ''
  const list =
    old.type === 'people' ||
    old.type === 'dropdown' ||
    (old.type === 'text' &&
      ['people', 'dropdown', 'status'].includes(next.type) &&
      value.trim().startsWith('['))
      ? columnList(value)
      : [value]
  if (!list.length) return ''
  if (next.type === 'text')
    return old.type === 'people'
      ? list.map((id) => people.find((p) => p.id === id)?.name || id).join(', ')
      : list.join(', ')
  if (next.type === 'number') return checkedValue(next, value.trim().replace(',', '.'), people)
  if (next.type === 'date') {
    const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
    return checkedValue(
      next,
      brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}` : value,
      people,
    )
  }
  if (['timeline', 'checkbox', 'time_tracking', 'external', 'last_updated'].includes(next.type))
    return checkedValue(next, value, people)
  if (next.type === 'people') {
    if (old.type === 'people') return checkedValue(next, value, people)
    const ids = list
      .flatMap((item) => item.split(/[,;]+/))
      .map((item) => {
        const match = people.find((p) =>
          [p.id, p.name, p.email].some(
            (v) => v.toLocaleLowerCase('pt-BR') === item.trim().toLocaleLowerCase('pt-BR'),
          ),
        )
        if (!match)
          throw new DomainError(
            `Não foi possível relacionar “${item}” a uma pessoa. Os dados foram preservados.`,
          )
        return match.id
      })
    return checkedValue(next, JSON.stringify(ids), people)
  }
  const labels = list.map((item) => {
    const original = old.options?.find((o) => o.label === item)
    const match =
      (original && next.options?.find((o) => o.id === original.id)) ||
      next.options?.find(
        (o) => o.label.toLocaleLowerCase('pt-BR') === item.toLocaleLowerCase('pt-BR'),
      )
    if (!match)
      throw new DomainError(
        `A opção “${item}” está em uso. Mantenha essa opção ou ajuste os valores antes de removê-la.`,
      )
    return match.label
  })
  if (next.type === 'status' && labels.length !== 1)
    throw new DomainError(
      'Uma coluna de Status aceita uma etiqueta por item. Os dados foram preservados.',
    )
  return checkedValue(next, next.type === 'status' ? labels[0] : JSON.stringify(labels), people)
}
export async function editColumn(
  db: Database,
  boardId: string,
  columnId: string,
  changes: {
    name?: string
    type?: ColumnType
    options?: LabelOption[]
    hidden?: boolean
    scope?: 'tasks' | 'subitems'
    formula?: string
  },
) {
  const board = await lockedBoard(db, boardId)
  const old = boardColumns(board).find((c) => c.id === columnId)
  if (!old) throw new DomainError('Coluna não encontrada.', 404)
  const system = SYSTEM_COLUMN_IDS.includes(columnId)
  if (changes.type && changes.type !== old.type && ['files', 'formula'].includes(old.type))
    throw new DomainError(
      'Colunas de Arquivos e Fórmula mantêm seu tipo. Crie outra coluna para usar um tipo diferente.',
    )
  if (changes.formula !== undefined && (changes.type || old.type) !== 'formula')
    throw new DomainError('A expressão só pode ser usada em uma coluna de Fórmula.')
  if (system && ((changes.type && changes.type !== old.type) || changes.options))
    throw new DomainError(
      'O tipo desta coluna é fixo. Suas etiquetas podem ser editadas pelo menu da célula.',
    )
  const next: CustomColumn = {
    ...old,
    name: changes.name ?? old.name,
    type: changes.type ?? old.type,
  }
  if (!system)
    next.options = optionsFor(
      next.type,
      changes.options ?? (next.type === old.type ? old.options : undefined),
    )
  if (changes.formula !== undefined || next.type !== old.type)
    configureFormula(board, next, changes.formula)
  const settings = { ...board.settings }
  if (system && changes.name)
    settings.columnNames = { ...settings.columnNames, [columnId]: changes.name }
  if (changes.hidden !== undefined) {
    if (changes.scope === 'subitems') {
      const visible = settings.subitemColumns || ['owner', 'status', 'date']
      settings.subitemColumns = changes.hidden
        ? visible.filter((key) => key !== columnId)
        : [...new Set([...visible, columnId])]
    } else {
      const hidden = settings.hiddenColumns || []
      settings.hiddenColumns = changes.hidden
        ? [...new Set([...hidden, columnId])]
        : hidden.filter((key) => key !== columnId)
    }
  }
  if (!system && (changes.type || changes.options)) {
    const people = (await db.query('SELECT * FROM people')).rows.map((p) => camelRow<Person>(p))
    const tasks = (
      await db.query<{ id: string; custom_values: Record<string, string> }>(
        'SELECT id,custom_values FROM tasks WHERE board_id=$1 FOR UPDATE',
        [boardId],
      )
    ).rows
    for (const task of tasks) {
      if (!(columnId in task.custom_values)) continue
      const current = task.custom_values[columnId]
      const value = convertedValue(old, next, current, people)
      if (current !== value)
        await db.query(
          'UPDATE tasks SET custom_values=$1::jsonb,version=version+1,updated_at=$2 WHERE id=$3',
          [
            JSON.stringify({ ...task.custom_values, [columnId]: value }),
            new Date().toISOString(),
            task.id,
          ],
        )
    }
  }
  await db.query('UPDATE boards SET columns=$1::jsonb,settings=$2::jsonb WHERE id=$3', [
    JSON.stringify(board.columns.map((c) => (c.id === columnId ? next : c))),
    JSON.stringify(settings),
    boardId,
  ])
  return next
}
export async function deleteColumn(db: Database, boardId: string, columnId: string) {
  const board = await lockedBoard(db, boardId)
  if (SYSTEM_COLUMN_IDS.includes(columnId))
    throw new DomainError(
      'Esta coluna pode ser ocultada, mas faz parte do funcionamento do quadro.',
    )
  if (!board.columns.some((c) => c.id === columnId))
    throw new DomainError('Coluna não encontrada.', 404)
  await db.query(
    'DELETE FROM task_files WHERE column_id=$1 AND task_id IN (SELECT id FROM tasks WHERE board_id=$2)',
    [columnId, boardId],
  )
  const settings = { ...board.settings }
  settings.deletedColumnIds = [...new Set([...(settings.deletedColumnIds || []), columnId])]
  for (const field of [
    'columnOrder',
    'subitemColumnOrder',
    'hiddenColumns',
    'subitemColumns',
  ] as const)
    if (settings[field]) settings[field] = settings[field].filter((key) => key !== columnId)
  if (settings.columnWidths) {
    settings.columnWidths = { ...settings.columnWidths }
    delete settings.columnWidths[columnId]
  }
  await db.query(
    'UPDATE tasks SET custom_values=custom_values-$1::text,version=version+1,updated_at=$2 WHERE board_id=$3 AND custom_values ? $1',
    [columnId, new Date().toISOString(), boardId],
  )
  await db.query('UPDATE boards SET columns=$1::jsonb,settings=$2::jsonb WHERE id=$3', [
    JSON.stringify(board.columns.filter((c) => c.id !== columnId)),
    JSON.stringify(settings),
    boardId,
  ])
}

export function importColumnValue(column: CustomColumn, value: string, people: Person[]) {
  if (column.type === 'text') return value
  if (['timeline', 'checkbox', 'time_tracking', 'external', 'last_updated'].includes(column.type))
    return checkedValue(column, value, people)
  if ((column.type === 'people' || column.type === 'dropdown') && value.trim().startsWith('[')) {
    const list = columnList(value)
    if (column.type === 'dropdown') return checkedValue(column, JSON.stringify(list), people)
    const ids = list.map(
      (item) =>
        people.find((person) =>
          [person.id, person.name, person.email].some(
            (candidate) => candidate.toLocaleLowerCase('pt-BR') === item.toLocaleLowerCase('pt-BR'),
          ),
        )?.id || item,
    )
    return checkedValue(column, JSON.stringify(ids), people)
  }
  if (column.type === 'dropdown' && value) {
    const list = column.options?.some((option) => option.label === value)
      ? [value]
      : value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
    return checkedValue(column, JSON.stringify(list), people)
  }
  return convertedValue({ ...column, type: 'text', options: undefined }, column, value, people)
}
