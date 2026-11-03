import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z, ZodError } from 'zod'
import { type Task, COLUMN_TYPES } from '../shared/domain.ts'
import { addColumn, editColumn, deleteColumn } from './columns.ts'
import { registerFileRoutes } from './files.ts'
import { boardColumns } from '../shared/columns.ts'
import { evaluateFormula, formulaText } from '../shared/formulas.ts'
import {
  listAutomations,
  automationHistory,
  saveAutomation,
  deleteAutomation,
} from './automations.ts'
import { type Database, migrate, camelRow } from './database.ts'
import { seed } from './seed.ts'
import {
  workspace,
  createBoard,
  insertTask,
  updateTask,
  resizeColumns,
  reorderColumns,
  moveTask,
  moveGroup,
  DomainError,
  id,
} from './repository.ts'
import { parseFile, parseDate, applyImport, MAX_ROWS } from './imports.ts'
import { listMondayBoards, prepareMondayPreview, type MondayFetch } from './monday.ts'
import { createMondaySessions } from './monday-sessions.ts'
import { createMondayBatch } from './monday-batch.ts'
import { jsonObject } from '../shared/rich-values.ts'
import { migrateBoardLabels } from './board-labels.ts'

const text = z.string().trim().min(1).max(300)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const date = z
  .string()
  .refine((v) => !!parseDate(v) && /^\d{4}-\d{2}-\d{2}$/.test(v), 'Informe uma data válida.')
  .nullable()
const taskFields = {
  title: text,
  description: z.string().max(20000),
  groupId: text,
  status: z.string().trim().max(300),
  priority: z.string().trim().max(300),
  dueDate: date,
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  ownerId: text.nullable(),
  ownerIds: z.array(text).max(100),
  customValues: z.record(z.string().max(100), z.string().max(1_000_000)),
}
const columnOption = z
  .object({
    id: text,
    label: z.string().trim().min(1).max(300),
    color,
    hasWarning: z.boolean().optional(),
    isDone: z.boolean().optional(),
  })
  .strict()
const columnFields = {
  name: text,
  type: z.enum(COLUMN_TYPES),
  options: z.array(columnOption).min(1).max(200),
  scope: z.enum(['tasks', 'subitems']),
  formula: z.string().trim().min(1).max(2000),
}
export async function buildApp(
  db: Database,
  options: {
    demo?: boolean
    logger?: boolean
    mondayFetch?: MondayFetch
    mondayDownload?: typeof fetch
  } = {},
) {
  await migrate(db)
  await seed(db, options.demo ?? true)
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.authorization', 'req.headers.cookie'] }
      : false,
    bodyLimit: 12 * 1024 * 1024,
  })
  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' })
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 } })
  const origins = new Set(
    [
      process.env.APP_ORIGIN,
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter(Boolean),
  )
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY')
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin &&
      !origins.has(request.headers.origin)
    )
      return reply.status(403).send({ message: 'Origem não autorizada.' })
  })
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, _request, reply) => {
    if (error instanceof DomainError)
      return reply.status(error.statusCode).send({ message: error.message })
    if (error instanceof ZodError)
      return reply.status(400).send({
        message: 'Confira os campos enviados.',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 8),
      })
    if (error.code === '23503')
      return reply
        .status(400)
        .send({ message: 'O quadro, grupo ou responsável selecionado não existe.' })
    if (error.code === '23505')
      return reply.status(409).send({ message: 'Este registro já existe.' })
    if (error.code?.startsWith('FST_'))
      return reply.status(error.statusCode || 400).send({
        message: error.code.includes('LARGE')
          ? 'O arquivo excede o limite de 5 MB.'
          : 'Não foi possível processar a solicitação.',
      })
    // Upstream responses and request bodies (including tokens) are never logged.
    if (
      error.message.startsWith('O ') ||
      error.message.startsWith('A ') ||
      error.message.startsWith('Não ') ||
      error.message.startsWith('Use ') ||
      error.message.startsWith('Escolha ') ||
      error.message.startsWith('Relacione ') ||
      error.message.startsWith('Este ') ||
      error.message.startsWith('Nesta ') ||
      error.message.startsWith('Token ')
    )
      return reply.status(400).send({ message: error.message })
    app.log.error({ name: error.name, code: error.code }, 'Falha interna')
    return reply.status(500).send({ message: 'Não foi possível concluir. Tente novamente.' })
  })
  app.get('/api/health', async () => ({ ok: true, version: '0.1.0', database: db.kind }))
  app.get('/api/workspace', async () => workspace(db))
  const mondaySessions = createMondaySessions(options.mondayDownload)
  const mondayBatch = await createMondayBatch(db, mondaySessions, options.mondayFetch)
  let individualImports = 0
  app.addHook('onClose', async () => {
    await mondayBatch.close()
    await mondaySessions.close()
  })
  registerFileRoutes(app, db)
  const automationFields = z
    .object({
      columnId: text,
      optionId: text,
      groupId: text,
      description: z.string().trim().max(1000),
      enabled: z.boolean(),
    })
    .strict()
  app.get<{ Params: { id: string } }>('/api/boards/:id/automations', (request) =>
    listAutomations(db, request.params.id),
  )
  app.get<{ Params: { id: string } }>('/api/boards/:id/automations/runs', (request) =>
    automationHistory(db, request.params.id),
  )
  app.post<{ Params: { id: string } }>('/api/boards/:id/automations', async (request, reply) => {
    const body = automationFields.partial({ description: true, enabled: true }).parse(request.body)
    return reply
      .status(201)
      .send(await db.transaction((tx) => saveAutomation(tx, request.params.id, body)))
  })
  app.patch<{ Params: { id: string; ruleId: string } }>(
    '/api/boards/:id/automations/:ruleId',
    async (request) => {
      const body = automationFields.partial().parse(request.body)
      if (!Object.keys(body).length) throw new DomainError('Informe o que deseja alterar.')
      return db.transaction((tx) =>
        saveAutomation(tx, request.params.id, body, request.params.ruleId),
      )
    },
  )
  app.delete<{ Params: { id: string; ruleId: string } }>(
    '/api/boards/:id/automations/:ruleId',
    async (request, reply) => {
      await db.transaction((tx) => deleteAutomation(tx, request.params.id, request.params.ruleId))
      return reply.status(204).send()
    },
  )
  app.post('/api/boards', async (request, reply) => {
    const data = z
      .object({ name: text, description: z.string().max(1000).default('') })
      .parse(request.body)
    return reply
      .status(201)
      .send(await db.transaction((tx) => createBoard(tx, data.name, data.description)))
  })
  app.patch<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
    const data = z
      .object({
        name: text.optional(),
        description: z.string().max(1000).optional(),
        favorite: z.boolean().optional(),
        settings: z.record(z.string(), z.any()).optional(),
      })
      .strict()
      .parse(request.body)
    const entries = Object.entries(data)
    if (!entries.length) return reply.status(400).send({ message: 'Informe o que deseja alterar.' })
    const setClauses = entries.map(([key], i) =>
      key === 'settings'
        ? `${key}=COALESCE(settings,'{}'::jsonb)||$${i + 1}::jsonb`
        : `${key}=$${i + 1}`,
    )
    const values = entries.map(([key, value]) =>
      key === 'settings' ? JSON.stringify(value) : value,
    )
    const result = await db.transaction(async (tx) => {
      if (data.settings) await migrateBoardLabels(tx, request.params.id, data.settings)
      return tx.query(
        `UPDATE boards SET ${setClauses.join(',')} WHERE id=$${entries.length + 1} RETURNING *`,
        [...values, request.params.id],
      )
    })
    return result.rows[0]
      ? camelRow(result.rows[0])
      : reply.status(404).send({ message: 'Quadro não encontrado.' })
  })
  app.patch<{ Params: { id: string } }>('/api/boards/:id/column-widths', async (request) => {
    const { widths } = z
      .object({ widths: z.record(z.string().max(100), z.number().int().positive()) })
      .strict()
      .parse(request.body)
    return db.transaction((tx) => resizeColumns(tx, request.params.id, widths))
  })
  app.post<{ Params: { id: string } }>('/api/tasks/:id/move', async (request) => {
    const body = z
      .object({
        version: z.number().int().positive(),
        targetId: text,
        placement: z.enum(['before', 'after']),
      })
      .strict()
      .parse(request.body)
    return db.transaction((tx) =>
      moveTask(tx, request.params.id, body.version, body.targetId, body.placement),
    )
  })
  app.patch<{ Params: { id: string } }>('/api/boards/:id/column-order', async (request) => {
    const body = z
      .object({ keys: z.array(text).max(104), scope: z.enum(['tasks', 'subitems']) })
      .strict()
      .parse(request.body)
    return db.transaction((tx) => reorderColumns(tx, request.params.id, body.keys, body.scope))
  })
  app.post<{ Params: { id: string } }>('/api/boards/:id/groups', async (request, reply) => {
    const data = z.object({ name: text, color: color.default('#6f80be') }).parse(request.body)
    const result = await db.transaction(async (tx) => {
      if (
        !(await tx.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [request.params.id])).rows
          .length
      )
        throw new DomainError('Quadro não encontrado.', 404)
      return tx.query(
        'INSERT INTO groups (id,board_id,name,color,position) SELECT $1,$2,$3,$4,COALESCE(MAX(position),0)+1 FROM groups WHERE board_id=$2 RETURNING *',
        [id(), request.params.id, data.name, data.color],
      )
    })
    return reply.status(201).send(camelRow(result.rows[0]))
  })
  app.post<{ Params: { id: string } }>('/api/groups/:id/move', async (request) => {
    const body = z
      .object({ targetId: text, placement: z.enum(['before', 'after']) })
      .strict()
      .parse(request.body)
    return db.transaction((tx) => moveGroup(tx, request.params.id, body.targetId, body.placement))
  })
  app.patch<{ Params: { id: string } }>('/api/groups/:id', async (request, reply) => {
    const changes = z
      .object({ name: text.optional(), color: color.optional() })
      .strict()
      .parse(request.body)
    const entries = Object.entries(changes)
    if (!entries.length) return reply.status(400).send({ message: 'Informe o que deseja alterar.' })
    const result = await db.query(
      `UPDATE groups SET ${entries.map(([key], i) => `${key}=$${i + 1}`).join(',')} WHERE id=$${entries.length + 1} RETURNING *`,
      [...entries.map(([, value]) => value), request.params.id],
    )
    return result.rows[0]
      ? camelRow(result.rows[0])
      : reply.status(404).send({ message: 'Grupo não encontrado.' })
  })
  app.post<{ Params: { id: string } }>('/api/boards/:id/columns', async (request, reply) => {
    const data = z
      .object({
        ...columnFields,
        options: columnFields.options.optional(),
        scope: columnFields.scope.optional(),
        formula: columnFields.formula.optional(),
      })
      .strict()
      .parse(request.body)
    return reply
      .status(201)
      .send(await db.transaction((tx) => addColumn(tx, request.params.id, data)))
  })
  app.patch<{ Params: { id: string; columnId: string } }>(
    '/api/boards/:id/columns/:columnId',
    async (request) => {
      const data = z
        .object({ ...columnFields, hidden: z.boolean() })
        .partial()
        .strict()
        .parse(request.body)
      if (!Object.keys(data).some((key) => key !== 'scope'))
        throw new DomainError('Informe o que deseja alterar.')
      return db.transaction((tx) =>
        editColumn(tx, request.params.id, request.params.columnId, data),
      )
    },
  )
  app.delete<{ Params: { id: string; columnId: string } }>(
    '/api/boards/:id/columns/:columnId',
    async (request, reply) => {
      await db.transaction((tx) => deleteColumn(tx, request.params.id, request.params.columnId))
      return reply.status(204).send()
    },
  )
  app.post('/api/tasks', async (request, reply) => {
    const data = z
      .object({
        ...Object.fromEntries(
          Object.entries(taskFields).map(([key, schema]) => [key, schema.optional()]),
        ),
        boardId: text,
        groupId: text,
        title: text,
        parentId: text.nullable().optional(),
      })
      .parse(request.body)
    return reply
      .status(201)
      .send(
        await db.transaction((tx) =>
          insertTask(
            tx,
            data as Partial<Task> & { boardId: string; groupId: string; title: string },
          ),
        ),
      )
  })
  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const data = z
      .object({ ...taskFields, version: z.number().int().positive() })
      .partial()
      .required({ version: true })
      .strict()
      .parse(request.body)
    const { version, ...changes } = data
    if (!Object.keys(changes).length)
      return reply.status(400).send({ message: 'Informe o que deseja alterar.' })
    return db.transaction((tx) => updateTask(tx, request.params.id, version, changes))
  })
  app.delete('/api/tasks', async (request, reply) => {
    const { ids } = z.object({ ids: z.array(text).min(1).max(2000) }).parse(request.body)
    await db.query('DELETE FROM tasks WHERE id=ANY($1::text[])', [ids])
    return reply.status(204).send()
  })
  app.post<{ Params: { id: string } }>('/api/tasks/:id/comments', async (request, reply) => {
    const { body, parentId } = z
      .object({ body: z.string().trim().min(1).max(5000), parentId: text.nullable().optional() })
      .parse(request.body)
    if (
      parentId &&
      !(
        await db.query('SELECT id FROM comments WHERE id=$1 AND task_id=$2', [
          parentId,
          request.params.id,
        ])
      ).rows.length
    )
      throw new DomainError('O comentário respondido não pertence a esta tarefa.')
    const result = await db.query(
      'INSERT INTO comments (id,task_id,author_id,body,created_at,parent_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [id(), request.params.id, 'person-you', body, new Date().toISOString(), parentId || null],
    )
    return reply.status(201).send(camelRow(result.rows[0]))
  })
  app.put<{ Params: { id: string } }>('/api/comments/:id/like', async (request) => {
    const { liked } = z.object({ liked: z.boolean() }).strict().parse(request.body)
    return db.transaction(async (tx) => {
      const row = (
        await tx.query('SELECT * FROM comments WHERE id=$1 FOR UPDATE', [request.params.id])
      ).rows[0]
      if (!row) throw new DomainError('Atualização não encontrada.', 404)
      const metadata = jsonObject(row.metadata),
        localLikes = new Set(
          Array.isArray(metadata.localLikes)
            ? metadata.localLikes.filter((id): id is string => typeof id === 'string')
            : [],
        )
      if (liked) localLikes.add('person-you')
      else localLikes.delete('person-you')
      const saved = await tx.query(
        'UPDATE comments SET metadata=$1::jsonb WHERE id=$2 RETURNING *',
        [JSON.stringify({ ...metadata, localLikes: [...localLikes] }), request.params.id],
      )
      return camelRow(saved.rows[0])
    })
  })
  app.post('/api/imports/preview', async (request) => {
    const file = await request.file()
    if (!file) throw new Error('Escolha um arquivo CSV ou Excel (.xlsx).')
    const buffer = await file.toBuffer()
    return parseFile(buffer, file.filename)
  })
  app.post('/api/imports/apply', async (request) => {
    if (mondayBatch.running())
      throw new DomainError('Aguarde a conclusão da importação em lote.', 409)
    const posted = jsonObject(request.body),
      postedPreview = jsonObject(posted.preview)
    const sessionId = typeof postedPreview.sessionId === 'string' ? postedPreview.sessionId : null
    let session: Awaited<ReturnType<typeof mondaySessions.lease>> | null = null
    let success = false
    individualImports++
    try {
      const leased = sessionId ? await mondaySessions.lease(sessionId) : null
      session = leased
      const input = z
        .object({
          preview: z.object({
            headers: z.array(text).min(1).max(120),
            rows: z.array(z.array(z.string().max(1_000_000)).max(120)).max(MAX_ROWS),
            name: text,
            source: z.enum(['file', 'monday']),
            sourceBoardId: text.optional(),
            warnings: z.array(z.string().max(1000)).max(20),
            columns: z
              .array(
                z.object({
                  header: text,
                  sourceId: text,
                  name: text,
                  sourceType: text,
                  type: z.enum(COLUMN_TYPES),
                  options: z.array(columnOption).max(200).optional(),
                }),
              )
              .max(120)
              .optional(),
            groups: z
              .array(z.object({ name: text, color }))
              .max(MAX_ROWS)
              .optional(),
            people: z
              .array(
                z.object({
                  sourceId: z.string().regex(/^\d+$/),
                  name: text,
                  email: z.string().max(300),
                }),
              )
              .max(2000)
              .optional(),
          }),
          mapping: z.record(
            z.string().max(300),
            z.enum([
              'title',
              'status',
              'priority',
              'dueDate',
              'owner',
              'group',
              'description',
              'externalId',
              'custom',
              'ignore',
            ]),
          ),
          boardId: text.optional(),
          boardName: text.optional(),
          importPeople: z.boolean().optional(),
          importAutomations: z.boolean().optional(),
        })
        .parse(session ? { ...posted, preview: session.preview } : request.body)
      const mapped = Object.values(input.mapping).filter((v) => !['ignore', 'custom'].includes(v))
      if (new Set(mapped).size !== mapped.length)
        throw new Error('Relacione cada campo principal a apenas uma coluna.')
      if (input.preview.source === 'monday' && !input.preview.sourceBoardId)
        throw new Error('O identificador do quadro monday está ausente.')
      const { preview } = input
      if (
        new Set(preview.headers).size !== preview.headers.length ||
        Object.keys(input.mapping).some((header) => !preview.headers.includes(header)) ||
        preview.columns?.some((column) => !preview.headers.includes(column.header)) ||
        new Set(preview.columns?.map((column) => column.header)).size !==
          (preview.columns?.length || 0) ||
        new Set(preview.columns?.map((column) => column.sourceId)).size !==
          (preview.columns?.length || 0)
      )
        throw new DomainError(
          'As colunas da prévia não correspondem ao mapeamento. Prepare a importação novamente.',
        )
      const result = await applyImport(db, session?.preview || input.preview, input.mapping, {
        ...input,
        ...(leased
          ? {
              readAsset: (asset: import('../shared/domain.ts').ImportSourceAsset) =>
                mondaySessions.read(leased, asset),
            }
          : {}),
      })
      success = true
      return result
    } finally {
      try {
        if (session) await mondaySessions.finish(session, success)
      } finally {
        individualImports--
      }
    }
  })
  app.get<{ Params: { id: string } }>('/api/imports/:id/report', async (request, reply) => {
    const report = (
      await db.query('SELECT id,created_at,coverage,snapshot FROM import_reports WHERE id=$1', [
        request.params.id,
      ])
    ).rows[0]
    if (!report) throw new DomainError('Relatório de importação não encontrado.', 404)
    return reply
      .header('Content-Disposition', 'attachment; filename="quadroos-importacao.json"')
      .type('application/json; charset=utf-8')
      .send(report)
  })
  app.delete<{ Params: { id: string } }>('/api/monday/previews/:id', async (request, reply) => {
    await mondaySessions.cancel(request.params.id)
    return reply.status(204).send()
  })
  const tokenSchema = z.string().trim().min(10).max(5000)
  app.get('/api/monday/batch', async () => ({ batch: mondayBatch.latest() }))
  app.post(
    '/api/monday/batch',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { token, resumeId } = z
        .object({ token: tokenSchema, resumeId: z.uuid().optional() })
        .parse(request.body)
      if (individualImports)
        throw new DomainError('Aguarde a conclusão da importação individual.', 409)
      return reply.status(202).send(await mondayBatch.start(token, resumeId))
    },
  )
  app.post(
    '/api/monday/boards',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { token } = z.object({ token: tokenSchema }).parse(request.body)
      return listMondayBoards(token, options.mondayFetch)
    },
  )
  app.post(
    '/api/monday/preview',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { token, boardId } = z
        .object({ token: tokenSchema, boardId: z.string().regex(/^\d+$/) })
        .parse(request.body)
      const bundle = await prepareMondayPreview(token, boardId, options.mondayFetch)
      return bundle.preview.items ? mondaySessions.stage(bundle) : bundle.preview
    },
  )
  app.get<{ Params: { id: string } }>('/api/boards/:id/export', async (request, reply) => {
    const state = await workspace(db)
    const board = state.boards.find((b) => b.id === request.params.id)
    if (!board) return reply.status(404).send({ message: 'Quadro não encontrado.' })
    const escape = (value: string) =>
      `"${(/^[=+@\-\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
    const headers = [
      'ID',
      'ID da tarefa principal',
      'Tarefa',
      'Grupo',
      'Responsável',
      'Status',
      'Prioridade',
      'Prazo',
      'Descrição',
      ...board.columns.map((c) => c.name),
    ]
    const rows = state.tasks
      .filter((t) => t.boardId === board.id)
      .map((t) => [
        t.id,
        t.parentId || '',
        t.title,
        state.groups.find((g) => g.id === t.groupId)?.name || '',
        t.ownerIds
          .map((id) => state.people.find((p) => p.id === id)?.name)
          .filter(Boolean)
          .join(', '),
        t.status,
        t.priority,
        t.dueAt || t.dueDate || '',
        t.description,
        ...board.columns.map((c) =>
          c.type === 'formula'
            ? formulaText(evaluateFormula(c, boardColumns(board), t))
            : c.type === 'files'
              ? (state.attachments || [])
                  .filter((f) => f.taskId === t.id && f.columnId === c.id)
                  .map((f) => f.name)
                  .join(', ')
              : t.customValues[c.id] || '',
        ),
      ])
    reply
      .header('Content-Disposition', 'attachment; filename="quadroos-export.csv"')
      .type('text/csv; charset=utf-8')
    return '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(';')).join('\r\n')
  })
  const dist = resolve('dist')
  if (existsSync(resolve(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist })
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.status(404).send({ message: 'Rota não encontrada.' })
        : reply.sendFile('index.html'),
    )
  }
  return app
}
