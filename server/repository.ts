import { randomUUID } from 'node:crypto'
import { DomainError } from './errors.ts'
import { validateCustomValues } from './columns.ts'
import { automationDestination } from './automations.ts'
export { DomainError } from './errors.ts'
import { type Database, camelRow } from './database.ts'
import {
  type Workspace,
  type Task,
  type Board,
  type Group,
  taskOwnerIds,
} from '../shared/domain.ts'
import {
  boardColumnKeys,
  columnLayout,
  moveAmongSiblings,
  moveGroupOrder,
  type TaskPlacement,
} from '../shared/board-layout.ts'

export const id = () => randomUUID()
function taskRow(row: Record<string, unknown>): Task {
  const task = camelRow<Task>(row)
  return { ...task, ownerIds: taskOwnerIds(task) }
}
async function resolveOwners(db: Database, changes: Partial<Task>, current: Partial<Task> = {}) {
  const owners = [
    ...new Set(
      changes.ownerIds !== undefined
        ? changes.ownerIds
        : changes.ownerId !== undefined
          ? changes.ownerId
            ? [changes.ownerId]
            : []
          : taskOwnerIds(current),
    ),
  ]
  if (owners.length) {
    const people = await db.query('SELECT id FROM people WHERE id=ANY($1::text[])', [owners])
    if (people.rows.length !== owners.length)
      throw new DomainError('O responsável selecionado não existe.')
  }
  return { ownerIds: owners, ownerId: owners[0] || null }
}
async function lockBoard(db: Database, boardId: string) {
  if (!(await db.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [boardId])).rows.length)
    throw new DomainError('Quadro não encontrado.', 404)
}
async function findGroup(db: Database, boardId: string, groupId: string) {
  const row = (
    await db.query('SELECT * FROM groups WHERE id=$1 AND board_id=$2', [groupId, boardId])
  ).rows[0]
  if (!row) throw new DomainError('O grupo não pertence a este quadro.')
  return camelRow<Group>(row)
}
export async function completedGroup(db: Database, boardId: string): Promise<Group> {
  const existing = (
    await db.query('SELECT * FROM groups WHERE board_id=$1 AND is_completed=true', [boardId])
  ).rows[0]
  if (existing) return camelRow<Group>(existing)
  const result = await db.query(
    `INSERT INTO groups (id,board_id,name,color,position,is_completed) SELECT $1,$2,'Concluídas','#377f68',COALESCE(MAX(position),0)+1,true FROM groups WHERE board_id=$2 RETURNING *`,
    [id(), boardId],
  )
  return camelRow<Group>(result.rows[0])
}
export async function moveGroup(
  db: Database,
  groupId: string,
  targetId: string,
  placement: TaskPlacement,
) {
  const row = (await db.query('SELECT * FROM groups WHERE id=$1', [groupId])).rows[0]
  if (!row) throw new DomainError('Grupo não encontrado.', 404)
  const group = camelRow<Group>(row)
  await lockBoard(db, group.boardId)
  const groups = (
    await db.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position,id FOR UPDATE', [
      group.boardId,
    ])
  ).rows.map((row) => camelRow<Group>(row))
  if (!groups.some((item) => item.id === groupId))
    throw new DomainError('Grupo não encontrado.', 404)
  if (!groups.some((item) => item.id === targetId))
    throw new DomainError('O destino deve pertencer ao mesmo quadro.')
  const ordered = moveGroupOrder(groups, groupId, targetId, placement)
  for (const item of ordered)
    if (groups.find((previous) => previous.id === item.id)?.position !== item.position)
      await db.query('UPDATE groups SET position=$1 WHERE id=$2', [item.position, item.id])
  return ordered
}
export async function workspace(db: Database): Promise<Workspace> {
  const tables = ['boards', 'groups', 'tasks', 'people', 'comments', 'import_runs']
  // Sequential queries also work on the single-connection embedded database.
  const data: Record<string, unknown> = {}
  data.attachments = (
    await db.query(
      'SELECT id,task_id,column_id,name,size,created_at,source,external_id,comment_id,external_url FROM task_files ORDER BY created_at,id',
    )
  ).rows.map((row) => camelRow(row))
  for (const table of tables) {
    const order =
      table === 'tasks' || table === 'groups'
        ? 'position, id'
        : table === 'comments' || table === 'import_runs'
          ? 'created_at, id'
          : 'id'
    data[table === 'import_runs' ? 'imports' : table] = (
      await db.query(
        table === 'import_runs'
          ? `SELECT i.*,r.id AS report_id FROM import_runs i LEFT JOIN import_reports r ON r.id=i.id ORDER BY i.created_at,i.id`
          : `SELECT * FROM ${table} ORDER BY ${order}`,
      )
    ).rows.map((row) => (table === 'tasks' ? taskRow(row) : camelRow(row)))
  }
  return { ...data, database: db.kind } as unknown as Workspace
}
export async function createBoard(
  db: Database,
  name: string,
  description = '',
  color = '#4f8b74',
): Promise<Board> {
  const boardId = id()
  await db.query('INSERT INTO boards (id,name,description,color,icon) VALUES ($1,$2,$3,$4,$5)', [
    boardId,
    name,
    description,
    color,
    'board',
  ])
  await db.query('INSERT INTO groups (id,board_id,name,color,position) VALUES ($1,$2,$3,$4,0)', [
    id(),
    boardId,
    'Primeiros passos',
    color,
  ])
  await completedGroup(db, boardId)
  return camelRow<Board>((await db.query('SELECT * FROM boards WHERE id=$1', [boardId])).rows[0])
}
export async function insertTask(
  db: Database,
  input: Partial<Task> & { boardId: string; groupId: string; title: string },
): Promise<Task> {
  await lockBoard(db, input.boardId)
  let group = await findGroup(db, input.boardId, input.groupId)
  if (input.parentId) {
    const row = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [input.parentId]))
      .rows[0]
    if (!row) throw new DomainError('A tarefa principal não existe.', 404)
    const parent = taskRow(row)
    if (parent.boardId !== input.boardId)
      throw new DomainError('O subitem precisa pertencer ao mesmo quadro da tarefa principal.')
    if (parent.parentId) {
      const ancestors = (
        await db.query<{ depth: number }>(
          'WITH RECURSIVE ancestors AS (SELECT id,parent_id,1 AS depth FROM tasks WHERE id=$1 UNION ALL SELECT t.id,t.parent_id,a.depth+1 FROM tasks t JOIN ancestors a ON a.parent_id=t.id WHERE a.depth<7) SELECT MAX(depth) AS depth FROM ancestors',
          [parent.id],
        )
      ).rows[0]
      if (Number(ancestors.depth) >= 6)
        throw new DomainError('Os subitens permitem até cinco níveis dentro da tarefa principal.')
    }
    group = await findGroup(db, input.boardId, parent.groupId)
  }
  const now = new Date().toISOString()
  const taskId = id()
  const owners = await resolveOwners(db, input)
  const importedDefaults =
    input.status === undefined || input.priority === undefined
      ? !!camelRow<Board>(
          (await db.query('SELECT * FROM boards WHERE id=$1', [input.boardId])).rows[0],
        ).settings?.monday
      : false
  const customValues = await validateCustomValues(db, input.boardId, input.customValues || {})
  const count = (
    await db.query<{ count: number }>(
      'SELECT COALESCE(MAX(position),0)+1 AS count FROM tasks WHERE board_id=$1',
      [input.boardId],
    )
  ).rows[0].count
  await db.query(
    `INSERT INTO tasks (id,board_id,group_id,title,description,status,priority,due_date,owner_id,position,created_at,updated_at,source,external_id,custom_values,parent_id,previous_group_id,owner_ids,due_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb,$18)`,
    [
      taskId,
      input.boardId,
      group.id,
      input.title,
      input.description || '',
      input.status ?? (importedDefaults ? '' : 'Não iniciado'),
      input.priority ?? (importedDefaults ? '' : 'Média'),
      input.dueDate || null,
      owners.ownerId,
      count,
      now,
      input.source || null,
      input.externalId || null,
      JSON.stringify(customValues),
      input.parentId || null,
      null,
      JSON.stringify(owners.ownerIds),
      input.dueDate ? input.dueAt || null : null,
    ],
  )
  return taskRow((await db.query('SELECT * FROM tasks WHERE id=$1', [taskId])).rows[0])
}

export async function updateTask(
  db: Database,
  taskId: string,
  version: number,
  changes: Partial<Task>,
): Promise<Task> {
  const hint = (
    await db.query<{ board_id: string }>('SELECT board_id FROM tasks WHERE id=$1', [taskId])
  ).rows[0]
  if (!hint) throw new DomainError('Tarefa não encontrada.', 404)
  await lockBoard(db, hint.board_id)
  const row = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0]
  if (!row) throw new DomainError('Tarefa não encontrada.', 404)
  const current = taskRow(row)
  if (changes.status && ['Em revisão', 'Concluído'].includes(changes.status)) {
    const board = camelRow<Board>(
      (await db.query('SELECT * FROM boards WHERE id=$1', [current.boardId])).rows[0],
    )
    const options = current.parentId
      ? board.settings?.subitemStatusOptions || board.settings?.statusOptions
      : board.settings?.statusOptions
    if (!options?.some((option) => option.label === changes.status))
      throw new DomainError('Status inválido.')
  }
  if (current.version !== version)
    throw new DomainError(
      'Esta tarefa mudou em outra janela. Os dados foram atualizados; tente novamente.',
      409,
    )
  const next = {
    ...current,
    ...changes,
    ...(await resolveOwners(db, changes, current)),
    customValues: {
      ...current.customValues,
      ...(await validateCustomValues(db, current.boardId, changes.customValues || {})),
    },
  }
  await findGroup(db, current.boardId, next.groupId)
  if (!next.dueDate || (changes.dueDate !== undefined && changes.dueAt === undefined))
    next.dueAt = null
  if (current.parentId) {
    const parent = taskRow(
      (await db.query('SELECT * FROM tasks WHERE id=$1', [current.parentId])).rows[0],
    )
    if (changes.groupId && changes.groupId !== parent.groupId)
      throw new DomainError('O subitem acompanha o grupo da tarefa principal.')
    next.groupId = parent.groupId
    next.previousGroupId = null
  } else {
    next.groupId = (await automationDestination(db, current, next)) || next.groupId
    next.previousGroupId = null
  }
  const now = new Date().toISOString()
  const result = await db.query(
    `UPDATE tasks SET title=$1,description=$2,group_id=$3,status=$4,priority=$5,due_date=$6,owner_id=$7,custom_values=$8::jsonb,previous_group_id=$9,updated_at=$10,version=version+1,owner_ids=$12::jsonb,due_at=$13 WHERE id=$11 RETURNING *`,
    [
      next.title,
      next.description,
      next.groupId,
      next.status,
      next.priority,
      next.dueDate,
      next.ownerId,
      JSON.stringify(next.customValues),
      next.previousGroupId,
      now,
      taskId,
      JSON.stringify(next.ownerIds),
      next.dueAt || null,
    ],
  )
  if (!current.parentId && next.groupId !== current.groupId)
    await db.query(
      'WITH RECURSIVE descendants AS (SELECT id FROM tasks WHERE parent_id=$3 UNION ALL SELECT t.id FROM tasks t JOIN descendants d ON t.parent_id=d.id) UPDATE tasks SET group_id=$1,updated_at=$2,version=version+1 WHERE id IN (SELECT id FROM descendants) AND group_id<>$1',
      [next.groupId, now, taskId],
    )
  return taskRow(result.rows[0])
}

export async function resizeColumns(
  db: Database,
  boardId: string,
  widths: Record<string, number>,
): Promise<Board> {
  await lockBoard(db, boardId)
  const board = camelRow<Board>(
    (await db.query('SELECT * FROM boards WHERE id=$1', [boardId])).rows[0],
  )
  const keys = boardColumnKeys(board)
  for (const [key, width] of Object.entries(widths)) {
    const { min, max } = columnLayout(key)
    if (!keys.includes(key) || !Number.isInteger(width) || width < min || width > max)
      throw new DomainError('A largura informada não é válida para esta coluna.')
  }
  const settings = {
    ...board.settings,
    columnWidths: { ...board.settings?.columnWidths, ...widths },
  }
  return camelRow<Board>(
    (
      await db.query('UPDATE boards SET settings=$1::jsonb WHERE id=$2 RETURNING *', [
        JSON.stringify(settings),
        boardId,
      ])
    ).rows[0],
  )
}

export async function reorderColumns(
  db: Database,
  boardId: string,
  keys: string[],
  scope: 'tasks' | 'subitems',
): Promise<Board> {
  await lockBoard(db, boardId)
  const board = camelRow<Board>(
    (await db.query('SELECT * FROM boards WHERE id=$1', [boardId])).rows[0],
  )
  const allowed = boardColumnKeys(board).filter((key) => key !== 'title')
  if (
    new Set(keys).size !== keys.length ||
    keys.length !== allowed.length ||
    keys.some((key) => !allowed.includes(key))
  )
    throw new DomainError('Escolha uma posição válida para as colunas deste quadro.')
  const field = scope === 'tasks' ? 'columnOrder' : 'subitemColumnOrder'
  const settings = { ...board.settings, [field]: keys }
  return camelRow<Board>(
    (
      await db.query('UPDATE boards SET settings=$1::jsonb WHERE id=$2 RETURNING *', [
        JSON.stringify(settings),
        boardId,
      ])
    ).rows[0],
  )
}

export async function moveTask(
  db: Database,
  taskId: string,
  version: number,
  targetId: string,
  placement: TaskPlacement,
): Promise<Task[]> {
  const hint = (
    await db.query<{ board_id: string }>('SELECT board_id FROM tasks WHERE id=$1', [taskId])
  ).rows[0]
  if (!hint) throw new DomainError('Tarefa não encontrada.', 404)
  await lockBoard(db, hint.board_id)
  const row = (await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [taskId])).rows[0]
  if (!row) throw new DomainError('Tarefa não encontrada.', 404)
  const task = taskRow(row)
  if (task.version !== version)
    throw new DomainError(
      'Esta tarefa mudou em outra janela. Os dados foram atualizados; tente novamente.',
      409,
    )
  const siblings = (
    await db.query(
      'SELECT * FROM tasks WHERE board_id=$1 AND group_id=$2 AND parent_id IS NOT DISTINCT FROM $3::text ORDER BY position,id FOR UPDATE',
      [task.boardId, task.groupId, task.parentId],
    )
  ).rows.map((r) => taskRow(r))
  if (targetId === taskId || !siblings.some((t) => t.id === targetId))
    throw new DomainError('Escolha uma posição dentro do mesmo grupo de tarefas ou subitens.')
  const ordered = moveAmongSiblings(siblings, task, targetId, placement)
  const updated = (
    await db.query(
      `UPDATE tasks AS task SET position=ordering.position,updated_at=$3,version=task.version+1
     FROM unnest($1::text[],$2::integer[]) AS ordering(id,position)
     WHERE task.id=ordering.id AND task.position IS DISTINCT FROM ordering.position RETURNING task.*`,
      [ordered.map((t) => t.id), ordered.map((t) => t.position), new Date().toISOString()],
    )
  ).rows.map((row) => taskRow(row))
  const byId = new Map([...siblings, ...updated].map((t) => [t.id, t]))
  return ordered.map((t) => byId.get(t.id)!)
}
