// In-app notifications: someone assigned you, commented on your task or replied to you, or an
// automation asked to tell you something. Each person reads only their own, and only on boards
// they can still open.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppNotification } from '../shared/domain.ts'
import { camelRow, type Database } from './database.ts'
import { visibleBoards } from './access.ts'

export interface NotificationInput {
  personIds: string[]
  boardId: string | null
  taskId: string | null
  kind: AppNotification['kind']
  title: string
  body?: string
  /** Who caused it; they are not notified about their own action. */
  actorId?: string | null
}

export async function notify(db: Database, input: NotificationInput) {
  const people = [...new Set(input.personIds)].filter((id) => id && id !== input.actorId)
  if (!people.length) return
  const known = new Set(
    (
      await db.query<{ id: string }>('SELECT id FROM people WHERE id = ANY($1::text[])', [people])
    ).rows.map((row) => row.id),
  )
  const now = new Date().toISOString()
  for (const personId of people.filter((id) => known.has(id)))
    await db.query(
      `INSERT INTO notifications (id,person_id,board_id,task_id,kind,title,body,actor_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        personId,
        input.boardId,
        input.taskId,
        input.kind,
        input.title.slice(0, 300),
        (input.body || '').slice(0, 1000),
        input.actorId || null,
        now,
      ],
    )
}

export function registerNotifications(app: FastifyInstance, db: Database) {
  app.get('/api/notifications', async (request) => {
    const viewer = request.viewer
    const rows = (
      await db.query(
        'SELECT * FROM notifications WHERE person_id=$1 ORDER BY created_at DESC, id DESC LIMIT 200',
        [viewer.personId],
      )
    ).rows.map((row) => camelRow<AppNotification>(row))
    const allowed = await visibleBoards(db, viewer, [
      ...new Set(rows.map((row) => row.boardId).filter((id): id is string => !!id)),
    ])
    const items = rows.filter((row) => !row.boardId || allowed.has(row.boardId)).slice(0, 50)
    return { items, unread: items.filter((item) => !item.readAt).length }
  })

  // Marks some (or, without ids, all) of the signed-in person's notifications as read.
  app.post('/api/notifications/read', async (request) => {
    const { ids } = z
      .object({ ids: z.array(z.string().max(100)).max(500).optional() })
      .strict()
      .parse(request.body ?? {})
    const now = new Date().toISOString()
    const result = ids
      ? await db.query(
          'UPDATE notifications SET read_at=$1 WHERE person_id=$2 AND id = ANY($3::text[]) AND read_at IS NULL RETURNING id',
          [now, request.viewer.personId, ids],
        )
      : await db.query(
          'UPDATE notifications SET read_at=$1 WHERE person_id=$2 AND read_at IS NULL RETURNING id',
          [now, request.viewer.personId],
        )
    return { read: result.rows.length }
  })
}

/** A new update: the task's owners hear about it, and a reply also tells the comment's author. */
export async function notifyComment(
  db: Database,
  comment: { taskId: string; authorId: string; parentId: string | null; body: string },
) {
  const task = (
    await db.query<{ title: string; board_id: string; owner_ids: string[] }>(
      'SELECT title, board_id, owner_ids FROM tasks WHERE id=$1',
      [comment.taskId],
    )
  ).rows[0]
  if (!task) return
  const author =
    (await db.query<{ name: string }>('SELECT name FROM people WHERE id=$1', [comment.authorId]))
      .rows[0]?.name || 'Alguém'
  const snippet = comment.body || 'Enviou um anexo.'
  const repliedTo = comment.parentId
    ? (
        await db.query<{ author_id: string }>('SELECT author_id FROM comments WHERE id=$1', [
          comment.parentId,
        ])
      ).rows[0]?.author_id
    : undefined
  if (repliedTo)
    await notify(db, {
      personIds: [repliedTo],
      boardId: task.board_id,
      taskId: comment.taskId,
      kind: 'reply',
      title: `${author} respondeu você em "${task.title}"`,
      body: snippet,
      actorId: comment.authorId,
    })
  await notify(db, {
    personIds: (task.owner_ids || []).filter((id) => id !== repliedTo),
    boardId: task.board_id,
    taskId: comment.taskId,
    kind: 'comment',
    title: `${author} comentou em "${task.title}"`,
    body: snippet,
    actorId: comment.authorId,
  })
}
