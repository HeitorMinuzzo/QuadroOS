import { randomUUID } from 'node:crypto'
import {
  type Board,
  type BoardAutomation,
  type AutomationRun,
  type Task,
} from '../shared/domain.ts'
import { boardColumns } from '../shared/columns.ts'
import { camelRow, type Database } from './database.ts'
import { DomainError } from './errors.ts'

export type AutomationInput = Pick<
  BoardAutomation,
  'columnId' | 'optionId' | 'groupId' | 'description' | 'enabled'
>

async function boardFor(db: Database, boardId: string, lock = false) {
  const row = (
    await db.query(`SELECT * FROM boards WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [boardId])
  ).rows[0]
  if (!row) throw new DomainError('Quadro não encontrado.', 404)
  return camelRow<Board>(row)
}
export async function listAutomations(db: Database, boardId: string) {
  await boardFor(db, boardId)
  return (
    await db.query('SELECT * FROM board_automations WHERE board_id=$1 ORDER BY created_at,id', [
      boardId,
    ])
  ).rows.map((row) => camelRow<BoardAutomation>(row))
}
export async function automationHistory(db: Database, boardId: string) {
  await boardFor(db, boardId)
  return (
    await db.query(
      'SELECT * FROM automation_runs WHERE board_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
      [boardId],
    )
  ).rows.map((row) => camelRow<AutomationRun>(row))
}
export async function saveAutomation(
  db: Database,
  boardId: string,
  input: Partial<AutomationInput>,
  ruleId?: string,
) {
  const board = await boardFor(db, boardId, true)
  const row = ruleId
    ? (
        await db.query('SELECT * FROM board_automations WHERE id=$1 AND board_id=$2', [
          ruleId,
          boardId,
        ])
      ).rows[0]
    : undefined
  if (ruleId && !row) throw new DomainError('Automação não encontrada.', 404)
  const rule = {
    description: '',
    enabled: true,
    ...(row ? camelRow<BoardAutomation>(row) : {}),
    ...input,
  }
  if (
    rule.enabled ||
    input.columnId !== undefined ||
    input.optionId !== undefined ||
    input.groupId !== undefined
  ) {
    const column = boardColumns(board).find((c) => c.id === rule.columnId && c.type === 'status')
    if (!column?.options?.some((option) => option.id === rule.optionId))
      throw new DomainError('Escolha uma coluna e uma etiqueta válidas para a automação.')
    if (
      !(
        await db.query('SELECT id FROM groups WHERE id=$1 AND board_id=$2', [rule.groupId, boardId])
      ).rows.length
    )
      throw new DomainError('Escolha um grupo deste quadro para a automação.')
  }
  const duplicate = await db.query(
    'SELECT id FROM board_automations WHERE board_id=$1 AND column_id=$2 AND option_id=$3 AND id<>$4',
    [boardId, rule.columnId, rule.optionId, ruleId || ''],
  )
  if (duplicate.rows.length)
    throw new DomainError(
      'Já existe uma automação para esta condição. Edite a regra existente.',
      409,
    )
  const now = new Date().toISOString()
  const result = ruleId
    ? await db.query(
        'UPDATE board_automations SET column_id=$1,option_id=$2,group_id=$3,description=$4,enabled=$5,updated_at=$6 WHERE id=$7 AND board_id=$8 RETURNING *',
        [
          rule.columnId,
          rule.optionId,
          rule.groupId,
          rule.description,
          rule.enabled,
          now,
          ruleId,
          boardId,
        ],
      )
    : await db.query(
        'INSERT INTO board_automations (id,board_id,column_id,option_id,group_id,description,enabled,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *',
        [
          randomUUID(),
          boardId,
          rule.columnId,
          rule.optionId,
          rule.groupId,
          rule.description,
          rule.enabled,
          now,
        ],
      )
  return camelRow<BoardAutomation>(result.rows[0])
}
export async function deleteAutomation(db: Database, boardId: string, ruleId: string) {
  await boardFor(db, boardId, true)
  const result = await db.query(
    'DELETE FROM board_automations WHERE id=$1 AND board_id=$2 RETURNING id',
    [ruleId, boardId],
  )
  if (!result.rows.length) throw new DomainError('Automação não encontrada.', 404)
}

// Rules run once per actual label change, inside the task's transaction. Moving
// the parent carries its subitems; their independent labels never move them alone.
export async function automationDestination(
  db: Database,
  current: Task,
  next: Task,
): Promise<string | null> {
  if (current.parentId) return null
  const rules = await listAutomations(db, current.boardId)
  if (!rules.some((rule) => rule.enabled)) return null
  const columns = boardColumns(await boardFor(db, current.boardId))
  const value = (task: Task, key: string) =>
    key === 'status'
      ? task.status
      : key === 'priority'
        ? task.priority
        : task.customValues[key] || ''
  for (const rule of rules) {
    if (!rule.enabled) continue
    const column = columns.find((c) => c.id === rule.columnId && c.type === 'status')
    const option = column?.options?.find((o) => o.id === rule.optionId)
    if (
      !option ||
      value(current, rule.columnId) === value(next, rule.columnId) ||
      value(next, rule.columnId) !== option.label
    )
      continue
    if (next.groupId === rule.groupId) return null
    const groups = (
      await db.query<{ id: string; name: string }>('SELECT id,name FROM groups WHERE board_id=$1', [
        current.boardId,
      ])
    ).rows
    const destination = groups.find((g) => g.id === rule.groupId)
    if (!destination) continue
    await db.query(
      'INSERT INTO automation_runs (id,board_id,automation_id,task_id,task_title,rule_description,from_group,to_group,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        randomUUID(),
        current.boardId,
        rule.id,
        current.id,
        next.title,
        `Quando ${column!.name} mudar para ${option.label}, mover item para ${destination.name}.`,
        groups.find((g) => g.id === current.groupId)?.name || '',
        destination.name,
        new Date().toISOString(),
      ],
    )
    return destination.id
  }
  return null
}
