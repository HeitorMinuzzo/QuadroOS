// Board automations: "Quando <gatilho>, então <ações>".
//
// Triggers on task changes (status changed, moved to a group) run inside the task's transaction,
// in passes, so an action that changes a status can start another rule; each rule runs at most
// once per change. "Item criado" and "todos os subitens concluídos" apply their actions as a
// follow-up change of that task. Date and recurring rules run from the scheduler (see
// runScheduledAutomations), once per task and date.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  type AutomationAction,
  type AutomationRun,
  type AutomationTrigger,
  type Board,
  type BoardAutomation,
  type Group,
  type Task,
  isTaskDone,
} from '../shared/domain.ts'
import { boardColumns } from '../shared/columns.ts'
import { describeRule } from '../shared/automation-text.ts'
import { camelRow, type Database } from './database.ts'
import { DomainError } from './errors.ts'
import { notify } from './notifications.ts'
import { insertTask, taskRow, updateTask } from './repository.ts'

/** Everything a rule run needs to know about who caused it. */
export interface RuleContext {
  actorId?: string | null
  /** Follow-up changes made by rules; stops rule chains from looping. */
  depth?: number
}
const MAX_DEPTH = 3

// ---------- shapes ----------

const id = z.string().trim().min(1).max(200)
export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status_changed'), columnId: id, optionId: id.nullable() }).strict(),
  z.object({ type: z.literal('item_created') }).strict(),
  z.object({ type: z.literal('moved_to_group'), groupId: id }).strict(),
  z.object({ type: z.literal('subitems_done') }).strict(),
  z
    .object({
      type: z.literal('date_arrives'),
      columnId: id,
      offsetDays: z.number().int().min(-365).max(365),
    })
    .strict(),
  z
    .object({
      type: z.literal('recurring'),
      every: z.enum(['day', 'week', 'month']),
      weekday: z.number().int().min(0).max(6).optional(),
      monthDay: z.number().int().min(1).max(31).optional(),
    })
    .strict(),
])
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move_group'), groupId: id }).strict(),
  z.object({ type: z.literal('set_status'), columnId: id, optionId: id.nullable() }).strict(),
  z
    .object({
      type: z.literal('set_date'),
      columnId: id,
      mode: z.enum(['today', 'offset', 'clear']),
      days: z.number().int().min(-365).max(365).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('assign'),
      mode: z.enum(['set', 'add', 'clear']),
      personIds: z.array(id).max(50),
    })
    .strict(),
  z
    .object({
      type: z.literal('notify'),
      to: z.enum(['owners', 'people']),
      personIds: z.array(id).max(50),
      message: z.string().trim().max(300),
    })
    .strict(),
  z
    .object({
      type: z.literal('create_item'),
      groupId: id,
      title: z.string().trim().min(1).max(300),
    })
    .strict(),
])
export const automationBody = z
  .object({
    trigger: triggerSchema,
    actions: z.array(actionSchema).min(1).max(5),
    // The classic shape, still used by the monday import and older clients.
    columnId: id,
    optionId: id,
    groupId: id,
    description: z.string().trim().max(1000),
    enabled: z.boolean(),
  })
  .partial()
  .strict()
export type AutomationInput = z.infer<typeof automationBody>

// ---------- reading ----------

async function boardFor(db: Database, boardId: string, lock = false) {
  const row = (
    await db.query(`SELECT * FROM boards WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [boardId])
  ).rows[0]
  if (!row) throw new DomainError('Quadro não encontrado.', 404)
  return camelRow<Board>(row)
}
async function groupsOf(db: Database, boardId: string) {
  return (
    await db.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position,id', [boardId])
  ).rows.map((row) => camelRow<Group>(row))
}
function ruleRow(row: Record<string, unknown>): BoardAutomation & { state: RuleState } {
  const rule = camelRow<BoardAutomation & { state: RuleState }>(row)
  return { ...rule, state: (rule.state || {}) as RuleState }
}
interface RuleState {
  /** Recurring rules: the next day (YYYY-MM-DD) an item is due to be created. */
  nextRun?: string
}
function publicRule(rule: BoardAutomation & { state?: RuleState }): BoardAutomation {
  const { state: _state, ...rest } = rule
  return rest
}
export async function listAutomations(db: Database, boardId: string) {
  await boardFor(db, boardId)
  return (await rulesOf(db, boardId)).map(publicRule)
}
async function rulesOf(db: Database, boardId: string, onlyEnabled = false) {
  return (
    await db.query(
      `SELECT * FROM board_automations WHERE board_id=$1${onlyEnabled ? ' AND enabled' : ''} ORDER BY created_at,id`,
      [boardId],
    )
  ).rows.map(ruleRow)
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

// ---------- dates (in the company's time zone) ----------

export const TIME_ZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo'
/** The calendar day (YYYY-MM-DD) of an instant in the company's time zone. */
export function dayOf(instant: Date, timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}
export function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
function weekday(day: string) {
  return new Date(`${day}T12:00:00Z`).getUTCDay()
}
function lastDayOfMonth(day: string) {
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return date.getUTCDate()
}
/** First day on or after `from` matching a recurring trigger. */
export function nextOccurrence(
  trigger: Extract<AutomationTrigger, { type: 'recurring' }>,
  from: string,
) {
  for (let i = 0, day = from; i < 400; i++, day = addDays(day, 1)) {
    if (trigger.every === 'day') return day
    if (trigger.every === 'week' && weekday(day) === (trigger.weekday ?? 1)) return day
    if (
      trigger.every === 'month' &&
      Number(day.slice(8)) === Math.min(trigger.monthDay ?? 1, lastDayOfMonth(day))
    )
      return day
  }
  return from
}
function brazilianDay(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`
}

// ---------- validation and saving ----------

function columnsOf(board: Board) {
  return boardColumns(board)
}
async function validate(
  db: Database,
  board: Board,
  trigger: AutomationTrigger,
  actions: AutomationAction[],
) {
  const columns = columnsOf(board)
  const groupIds = new Set((await groupsOf(db, board.id)).map((group) => group.id))
  const statusColumn = (columnId: string) =>
    columns.find((column) => column.id === columnId && column.type === 'status')
  const dateColumn = (columnId: string) =>
    columnId === 'date' ||
    columns.some((column) => column.id === columnId && column.type === 'date')
  const invalid = (message: string) => {
    throw new DomainError(message)
  }
  if (trigger.type === 'status_changed') {
    const column = statusColumn(trigger.columnId)
    if (
      !column ||
      (trigger.optionId !== null && !column.options?.some((o) => o.id === trigger.optionId))
    )
      invalid('Escolha uma coluna e uma etiqueta válidas para a automação.')
  }
  if (trigger.type === 'moved_to_group' && !groupIds.has(trigger.groupId))
    invalid('Escolha um grupo deste quadro para a automação.')
  if (trigger.type === 'date_arrives' && !dateColumn(trigger.columnId))
    invalid('Escolha uma coluna de data deste quadro.')
  if (trigger.type === 'recurring') {
    if (trigger.every === 'week' && trigger.weekday === undefined)
      invalid('Escolha o dia da semana da repetição.')
    if (trigger.every === 'month' && trigger.monthDay === undefined)
      invalid('Escolha o dia do mês da repetição.')
  }
  const recurring = trigger.type === 'recurring'
  const people = [
    ...new Set(
      actions.flatMap((action) =>
        action.type === 'assign' || (action.type === 'notify' && action.to === 'people')
          ? action.personIds
          : [],
      ),
    ),
  ]
  if (people.length) {
    const found = (await db.query('SELECT id FROM people WHERE id=ANY($1::text[])', [people])).rows
    if (found.length !== people.length) invalid('Uma das pessoas escolhidas não existe.')
  }
  for (const action of actions) {
    if (recurring !== (action.type === 'create_item') && action.type !== 'notify')
      invalid(
        recurring
          ? 'Uma repetição cria um item; escolha "Criar item" (e, se quiser, "Notificar").'
          : '"Criar item" só existe nas repetições.',
      )
    if (
      (action.type === 'move_group' || action.type === 'create_item') &&
      !groupIds.has(action.groupId)
    )
      invalid('Escolha um grupo deste quadro para a automação.')
    if (action.type === 'set_status') {
      const column = statusColumn(action.columnId)
      if (
        !column ||
        (action.optionId !== null && !column.options?.some((o) => o.id === action.optionId))
      )
        invalid('Escolha uma coluna e uma etiqueta válidas para a ação.')
    }
    if (action.type === 'set_date' && !dateColumn(action.columnId))
      invalid('Escolha uma coluna de data deste quadro.')
    if (action.type === 'assign' && action.mode !== 'clear' && !action.personIds.length)
      invalid('Escolha quem será atribuído.')
    if (action.type === 'notify' && action.to === 'people' && !action.personIds.length)
      invalid('Escolha quem será notificado.')
  }
  if (recurring && !actions.some((action) => action.type === 'create_item'))
    invalid('Uma repetição precisa da ação "Criar item".')
}
/** The classic columns, kept only for "status changed to a label → move to group". */
function classic(trigger: AutomationTrigger, actions: AutomationAction[]) {
  const [action] = actions
  return trigger.type === 'status_changed' &&
    trigger.optionId &&
    actions.length === 1 &&
    action.type === 'move_group'
    ? { columnId: trigger.columnId, optionId: trigger.optionId, groupId: action.groupId }
    : { columnId: null, optionId: null, groupId: null }
}

export async function saveAutomation(
  db: Database,
  boardId: string,
  input: AutomationInput,
  ruleId?: string,
) {
  const board = await boardFor(db, boardId, true)
  const existing = ruleId
    ? (
        await db.query('SELECT * FROM board_automations WHERE id=$1 AND board_id=$2', [
          ruleId,
          boardId,
        ])
      ).rows[0]
    : undefined
  if (ruleId && !existing) throw new DomainError('Automação não encontrada.', 404)
  const before = existing ? ruleRow(existing) : undefined
  // The classic fields describe "status changed → move to group".
  const classicInput =
    input.columnId !== undefined || input.optionId !== undefined || input.groupId !== undefined
  let trigger = input.trigger ?? before?.trigger
  let actions = input.actions ?? before?.actions
  if (classicInput && !input.trigger && !input.actions) {
    const old = before ? classic(before.trigger, before.actions) : undefined
    trigger = {
      type: 'status_changed',
      columnId: input.columnId ?? old?.columnId ?? '',
      optionId: input.optionId ?? old?.optionId ?? '',
    }
    actions = [{ type: 'move_group', groupId: input.groupId ?? old?.groupId ?? '' }]
  }
  if (!trigger || !actions?.length)
    throw new DomainError('Escolha quando a automação começa e o que ela faz.')
  const enabled = input.enabled ?? before?.enabled ?? true
  const changedShape = !!input.trigger || !!input.actions || classicInput
  if (enabled || changedShape) await validate(db, board, trigger, actions)
  const columns = classic(trigger, actions)
  if (columns.columnId) {
    const duplicate = await db.query(
      'SELECT id FROM board_automations WHERE board_id=$1 AND column_id=$2 AND option_id=$3 AND id<>$4',
      [boardId, columns.columnId, columns.optionId, ruleId || ''],
    )
    if (duplicate.rows.length)
      throw new DomainError(
        'Já existe uma automação para esta condição. Edite a regra existente.',
        409,
      )
  }
  const state: RuleState =
    trigger.type === 'recurring'
      ? changedShape || !before?.state.nextRun
        ? { nextRun: nextOccurrence(trigger, dayOf(new Date())) }
        : before.state
      : {}
  const description = input.description ?? before?.description ?? ''
  const now = new Date().toISOString()
  const values = [
    columns.columnId,
    columns.optionId,
    columns.groupId,
    description,
    enabled,
    now,
    JSON.stringify(trigger),
    JSON.stringify(actions),
    JSON.stringify(state),
  ]
  const result = ruleId
    ? await db.query(
        `UPDATE board_automations SET column_id=$1,option_id=$2,group_id=$3,description=$4,enabled=$5,
           updated_at=$6,trigger=$7::jsonb,actions=$8::jsonb,state=$9::jsonb
         WHERE id=$10 AND board_id=$11 RETURNING *`,
        [...values, ruleId, boardId],
      )
    : await db.query(
        `INSERT INTO board_automations
           (column_id,option_id,group_id,description,enabled,updated_at,trigger,actions,state,id,board_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$6) RETURNING *`,
        [...values, randomUUID(), boardId],
      )
  return publicRule(ruleRow(result.rows[0]))
}
export async function deleteAutomation(db: Database, boardId: string, ruleId: string) {
  await boardFor(db, boardId, true)
  const result = await db.query(
    'DELETE FROM board_automations WHERE id=$1 AND board_id=$2 RETURNING id',
    [ruleId, boardId],
  )
  if (!result.rows.length) throw new DomainError('Automação não encontrada.', 404)
}

// ---------- running ----------

function valueOf(task: Task, columnId: string) {
  if (columnId === 'status') return task.status
  if (columnId === 'priority') return task.priority
  if (columnId === 'date') return task.dueDate || ''
  return task.customValues[columnId] || ''
}
function withValue(task: Task, columnId: string, value: string): Task {
  if (columnId === 'status') return { ...task, status: value as Task['status'] }
  if (columnId === 'priority') return { ...task, priority: value as Task['priority'] }
  if (columnId === 'date') return { ...task, dueDate: value || null, dueAt: null }
  return { ...task, customValues: { ...task.customValues, [columnId]: value } }
}
function dayValue(value: string) {
  if (!value) return ''
  return value.includes('T') ? dayOf(new Date(value)) : value.slice(0, 10)
}
interface Effects {
  task: Task
  notes: { personIds: string[]; title: string; body: string }[]
}
/** Applies a rule's actions to a task in memory; invalid ones (deleted groups…) are skipped. */
async function applyActions(
  db: Database,
  board: Board,
  groups: Group[],
  task: Task,
  rule: BoardAutomation,
  now: Date,
): Promise<Effects> {
  const columns = columnsOf(board)
  let next = { ...task, customValues: { ...task.customValues } }
  const notes: Effects['notes'] = []
  for (const action of rule.actions) {
    if (action.type === 'move_group') {
      if (!next.parentId && groups.some((g) => g.id === action.groupId))
        next = { ...next, groupId: action.groupId }
    } else if (action.type === 'set_status') {
      const column = columns.find((c) => c.id === action.columnId && c.type === 'status')
      if (!column) continue
      const option = column.options?.find((o) => o.id === action.optionId)
      if (action.optionId !== null && !option) continue
      next = withValue(next, action.columnId, option?.label || '')
    } else if (action.type === 'set_date') {
      const day =
        action.mode === 'clear'
          ? ''
          : addDays(dayOf(now), action.mode === 'offset' ? (action.days ?? 0) : 0)
      next = withValue(next, action.columnId, day)
    } else if (action.type === 'assign') {
      const known = action.personIds.length
        ? (
            await db.query<{ id: string }>('SELECT id FROM people WHERE id=ANY($1::text[])', [
              action.personIds,
            ])
          ).rows.map((row) => row.id)
        : []
      const owners =
        action.mode === 'clear'
          ? []
          : action.mode === 'set'
            ? known
            : [...new Set([...next.ownerIds, ...known])]
      next = { ...next, ownerIds: owners, ownerId: owners[0] || null }
    } else if (action.type === 'notify') {
      notes.push({
        personIds: action.to === 'owners' ? next.ownerIds : action.personIds,
        title: action.message || `Automação em "${next.title}"`,
        body: `${board.name} · ${next.title}`,
      })
    }
  }
  return { task: next, notes }
}
async function record(
  db: Database,
  board: Board,
  groups: Group[],
  rule: BoardAutomation,
  before: Task,
  after: Task,
) {
  const people = (await db.query<{ id: string; name: string }>('SELECT id, name FROM people')).rows
  const moved = before.groupId !== after.groupId
  await db.query(
    'INSERT INTO automation_runs (id,board_id,automation_id,task_id,task_title,rule_description,from_group,to_group,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      randomUUID(),
      board.id,
      rule.id,
      after.id,
      after.title,
      describeRule(rule, { board, groups, people }),
      moved ? groups.find((g) => g.id === before.groupId)?.name || '' : '',
      moved ? groups.find((g) => g.id === after.groupId)?.name || '' : '',
      new Date().toISOString(),
    ],
  )
}
async function deliver(db: Database, board: Board, task: Task, notes: Effects['notes']) {
  for (const note of notes)
    await notify(db, {
      personIds: note.personIds,
      boardId: board.id,
      taskId: task.id,
      kind: 'automation',
      title: note.title,
      body: note.body,
      // Automations tell everyone they name, including whoever triggered them.
      actorId: null,
    })
}

/**
 * Runs the change-driven rules (status changed, moved to a group) on a task about to be saved
 * and returns it with the rules' changes. Called from updateTask, inside its transaction.
 */
export async function evaluateTaskRules(
  db: Database,
  current: Task,
  next: Task,
  ctx: RuleContext = {},
): Promise<Task> {
  if (current.parentId || (ctx.depth ?? 0) >= MAX_DEPTH) return next
  const rules = (await rulesOf(db, current.boardId, true)).filter(
    (rule) => rule.trigger.type === 'status_changed' || rule.trigger.type === 'moved_to_group',
  )
  if (!rules.length) return next
  const board = await boardFor(db, current.boardId)
  const groups = await groupsOf(db, current.boardId)
  const columns = columnsOf(board)
  const matches = (rule: BoardAutomation, from: Task, to: Task) => {
    const t = rule.trigger
    if (t.type === 'moved_to_group') return from.groupId !== to.groupId && to.groupId === t.groupId
    if (t.type !== 'status_changed') return false
    const column = columns.find((c) => c.id === t.columnId && c.type === 'status')
    if (!column || valueOf(from, t.columnId) === valueOf(to, t.columnId)) return false
    if (t.optionId === null) return true
    return column.options?.find((o) => o.id === t.optionId)?.label === valueOf(to, t.columnId)
  }
  const fired = new Set<string>()
  const now = new Date()
  let before = current
  let after = next
  // Each pass looks at what changed in the previous one, so rules can chain a few steps.
  for (let pass = 0; pass < MAX_DEPTH; pass++) {
    const start = after
    for (const rule of rules) {
      if (fired.has(rule.id) || !matches(rule, before, after)) continue
      fired.add(rule.id)
      const effects = await applyActions(db, board, groups, after, rule, now)
      await record(db, board, groups, rule, after, effects.task)
      await deliver(db, board, effects.task, effects.notes)
      after = effects.task
    }
    if (after === start) break
    before = start
  }
  return after
}

/** What changed between two versions of a task, as an update for updateTask. */
function changesBetween(before: Task, after: Task): Partial<Task> {
  const changes: Partial<Task> = {}
  if (before.groupId !== after.groupId) changes.groupId = after.groupId
  if (before.status !== after.status) changes.status = after.status
  if (before.priority !== after.priority) changes.priority = after.priority
  if (before.dueDate !== after.dueDate) {
    changes.dueDate = after.dueDate
    changes.dueAt = null
  }
  if (JSON.stringify(before.ownerIds) !== JSON.stringify(after.ownerIds))
    changes.ownerIds = after.ownerIds
  const custom = Object.fromEntries(
    Object.entries(after.customValues).filter(([key, value]) => before.customValues[key] !== value),
  )
  if (Object.keys(custom).length) changes.customValues = custom
  return changes
}
/** Runs one rule's actions on a saved task, as a follow-up change (with its own rules). */
async function runOn(
  db: Database,
  board: Board,
  groups: Group[],
  rule: BoardAutomation,
  task: Task,
  ctx: RuleContext,
) {
  const effects = await applyActions(db, board, groups, task, rule, new Date())
  const changes = changesBetween(task, effects.task)
  const saved = Object.keys(changes).length
    ? await updateTask(db, task.id, task.version, changes, {
        actorId: ctx.actorId,
        depth: (ctx.depth ?? 0) + 1,
      })
    : task
  await record(db, board, groups, rule, task, saved)
  await deliver(db, board, saved, effects.notes)
  return saved
}

/** "Item criado": runs after a task is created by someone (not by imports). */
export async function afterTaskCreated(db: Database, task: Task, ctx: RuleContext = {}) {
  if (task.parentId || (ctx.depth ?? 0) >= MAX_DEPTH) return task
  const rules = (await rulesOf(db, task.boardId, true)).filter(
    (rule) => rule.trigger.type === 'item_created',
  )
  if (!rules.length) return task
  const board = await boardFor(db, task.boardId)
  const groups = await groupsOf(db, task.boardId)
  let current = task
  for (const rule of rules) current = await runOn(db, board, groups, rule, current, ctx)
  return current
}

/** "Todos os subitens concluídos": runs when a subitem change completes the last one. */
export async function afterSubitemChanged(
  db: Database,
  before: Task,
  after: Task,
  ctx: RuleContext = {},
) {
  if (!after.parentId || (ctx.depth ?? 0) >= MAX_DEPTH) return
  const board = await boardFor(db, after.boardId)
  if (isTaskDone(before, board) || !isTaskDone(after, board)) return
  const rules = (await rulesOf(db, after.boardId, true)).filter(
    (rule) => rule.trigger.type === 'subitems_done',
  )
  if (!rules.length) return
  const siblings = (
    await db.query('SELECT * FROM tasks WHERE parent_id=$1', [after.parentId])
  ).rows.map(taskRow)
  if (!siblings.every((task) => isTaskDone(task.id === after.id ? after : task, board))) return
  const parentRow = (await db.query('SELECT * FROM tasks WHERE id=$1', [after.parentId])).rows[0]
  if (!parentRow) return
  const groups = await groupsOf(db, after.boardId)
  let parent = taskRow(parentRow)
  for (const rule of rules) parent = await runOn(db, board, groups, rule, parent, ctx)
}

// ---------- scheduler ----------

/**
 * Date and recurring rules. Safe to call often and from a restarted server: every firing is
 * recorded first, so a task and date (or a recurring day) never fires twice. A firing missed
 * while the server was down still happens within the next two days.
 */
export async function runScheduledAutomations(db: Database, now = new Date()) {
  const today = dayOf(now)
  const rules = (
    await db.query(
      `SELECT * FROM board_automations WHERE enabled AND trigger->>'type' IN ('date_arrives','recurring') ORDER BY created_at,id`,
    )
  ).rows.map(ruleRow)
  let fired = 0
  for (const rule of rules) {
    try {
      fired += await db.transaction(async (tx) => {
        const board = await boardFor(tx, rule.boardId)
        const groups = await groupsOf(tx, rule.boardId)
        const claim = async (taskId: string, key: string) =>
          (
            await tx.query(
              'INSERT INTO automation_fired (rule_id,task_id,fire_key,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING rule_id',
              [rule.id, taskId, key, now.toISOString()],
            )
          ).rows.length > 0
        const t = rule.trigger
        if (t.type === 'date_arrives') {
          const tasks = (
            await tx.query('SELECT * FROM tasks WHERE board_id=$1 AND parent_id IS NULL', [
              rule.boardId,
            ])
          ).rows.map(taskRow)
          let count = 0
          for (const task of tasks) {
            const day = dayValue(valueOf(task, t.columnId))
            if (!day || isTaskDone(task, board)) continue
            const due = addDays(day, t.offsetDays)
            // Today, or up to two days late if the server was off on the day.
            if (due > today || due < addDays(today, -2)) continue
            if (!(await claim(task.id, day))) continue
            await runOn(tx, board, groups, rule, task, { actorId: null })
            count++
          }
          return count
        }
        if (t.type === 'recurring') {
          const nextRun = rule.state.nextRun || nextOccurrence(t, today)
          if (nextRun > today) return 0
          const fresh = await claim('', nextRun)
          await tx.query('UPDATE board_automations SET state=$1::jsonb WHERE id=$2', [
            JSON.stringify({ nextRun: nextOccurrence(t, addDays(today, 1)) }),
            rule.id,
          ])
          if (!fresh) return 0
          for (const action of rule.actions) {
            if (action.type !== 'create_item' || !groups.some((g) => g.id === action.groupId))
              continue
            const task = await insertTask(tx, {
              boardId: rule.boardId,
              groupId: action.groupId,
              title: action.title.replaceAll('{data}', brazilianDay(nextRun)),
            })
            await record(tx, board, groups, rule, task, task)
            const notes = (await applyActions(tx, board, groups, task, rule, now)).notes
            await deliver(tx, board, task, notes)
            await afterTaskCreated(tx, task, { actorId: null })
          }
          return 1
        }
        return 0
      })
    } catch (error) {
      console.error(`Automação ${rule.id} não pôde ser executada:`, error)
    }
  }
  return fired
}

/** Runs the scheduled rules shortly after start and then every few minutes. */
export function startAutomationScheduler(db: Database, everyMs = 5 * 60_000) {
  const run = () => void runScheduledAutomations(db).catch(() => undefined)
  const first = setTimeout(run, 15_000)
  const timer = setInterval(run, everyMs)
  first.unref?.()
  timer.unref?.()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
