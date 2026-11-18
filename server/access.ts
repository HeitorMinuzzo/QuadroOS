// Board-level access. Every /api route that touches a board, group, task, comment, file or import
// goes through one preHandler, so a new route cannot forget the check.
//
//   view   — public boards for every account; private boards for their members, direct or through
//            the board's sector (the stronger of the two roles counts).
//   edit   — viewing plus an account that is not read-only and, on private boards (or when listed
//            as a board viewer), an owner/editor membership. Favorites, comments and likes only
//            need viewing: readers take part in the conversation without changing the work.
//   manage — visibility and members: board owners and administrators.
// Without sign-in (AUTH_MODE=none) and for administrators every board is fully open.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { BoardAccess, BoardRole, Sector, Workspace } from '../shared/domain.ts'
import type { Database } from './database.ts'
import { DomainError } from './errors.ts'
import type { Viewer } from './auth.ts'

type Need = 'view' | 'edit' | 'manage'
const FULL: BoardAccess = { canEdit: true, canManage: true }

const RANK: Record<BoardRole, number> = { viewer: 1, editor: 2, owner: 3 }
/** The stronger of a direct membership and the role the board gives its sector. */
export function strongest(...roles: (BoardRole | null | undefined)[]) {
  return roles.reduce<BoardRole | null>(
    (best, role) => (role && (!best || RANK[role] > RANK[best]) ? role : best),
    null,
  )
}

interface BoardFacts {
  visibility: string
  role: BoardRole | null
}
function decide(viewer: Viewer, facts: BoardFacts | undefined) {
  if (!facts) return { canView: false, canEdit: false, canManage: false }
  if (!viewer.accountId || viewer.role === 'admin') return { canView: true, ...FULL }
  const canView = facts.visibility !== 'private' || !!facts.role
  const canEdit =
    canView &&
    viewer.role !== 'viewer' &&
    facts.role !== 'viewer' &&
    (facts.visibility !== 'private' || !!facts.role)
  return { canView, canEdit, canManage: facts.role === 'owner' }
}

async function facts(db: Database, viewer: Viewer, boardIds: string[]) {
  const { rows } = await db.query<{
    id: string
    visibility: string
    role: BoardRole | null
    sector_role: BoardRole | null
  }>(
    `SELECT b.id, b.visibility, m.role, CASE WHEN s.person_id IS NULL THEN NULL ELSE b.sector_role END AS sector_role
     FROM boards b
     LEFT JOIN board_members m ON m.board_id=b.id AND m.person_id=$2
     LEFT JOIN sector_members s ON s.sector_id=b.sector_id AND s.person_id=$2
     WHERE b.id = ANY($1::text[])`,
    [boardIds, viewer.personId],
  )
  return new Map(
    rows.map((row) => [
      row.id,
      { visibility: row.visibility, role: strongest(row.role, row.sector_role) },
    ]),
  )
}

export async function assertBoard(
  db: Database,
  viewer: Viewer,
  boardId: string | undefined,
  need: Need,
) {
  if (!boardId) throw new DomainError('Quadro não encontrado.', 404)
  if (!viewer.accountId || viewer.role === 'admin') return
  const access = decide(viewer, (await facts(db, viewer, [boardId])).get(boardId))
  // Boards a person cannot see answer as missing, so their existence is not revealed.
  if (!access.canView) throw new DomainError('Quadro não encontrado.', 404)
  if (need === 'edit' && !access.canEdit)
    throw new DomainError('Você pode ver este quadro, mas não editá-lo.', 403)
  if (need === 'manage' && !access.canManage)
    throw new DomainError(
      'Somente o dono do quadro ou um administrador pode alterar o acesso.',
      403,
    )
}

/** Keeps only what the viewer may see and tells the client what it may change on each board. */
export async function scopeWorkspace(
  db: Database,
  viewer: Viewer,
  state: Workspace,
): Promise<Workspace> {
  const members = (
    await db.query<{ board_id: string; person_id: string; role: BoardRole }>(
      'SELECT board_id, person_id, role FROM board_members ORDER BY board_id, person_id',
    )
  ).rows
  const byBoard = new Map<string, { personId: string; role: BoardRole }[]>()
  for (const row of members)
    byBoard.set(row.board_id, [
      ...(byBoard.get(row.board_id) ?? []),
      { personId: row.person_id, role: row.role },
    ])
  const favorites = new Set(
    (
      await db.query<{ board_id: string }>(
        'SELECT board_id FROM board_favorites WHERE person_id=$1',
        [viewer.personId],
      )
    ).rows.map((row) => row.board_id),
  )
  const sectors = await loadSectors(db)
  const mySectors = new Set(
    sectors.filter((sector) => sector.memberIds.includes(viewer.personId)).map((s) => s.id),
  )
  const boards = state.boards.flatMap((board) => {
    const list = byBoard.get(board.id) ?? []
    const access = decide(viewer, {
      visibility: board.visibility ?? 'public',
      role: strongest(
        list.find((member) => member.personId === viewer.personId)?.role,
        board.sectorId && mySectors.has(board.sectorId) ? (board.sectorRole ?? 'editor') : null,
      ),
    })
    return access.canView
      ? [
          {
            ...board,
            favorite: favorites.has(board.id),
            members: list,
            access: { canEdit: access.canEdit, canManage: access.canManage },
          },
        ]
      : []
  })
  if (boards.length === state.boards.length) return { ...state, boards, sectors }
  const visible = new Set(boards.map((board) => board.id))
  const tasks = state.tasks.filter((task) => visible.has(task.boardId))
  const taskIds = new Set(tasks.map((task) => task.id))
  return {
    ...state,
    boards,
    sectors,
    groups: state.groups.filter((group) => visible.has(group.boardId)),
    tasks,
    comments: state.comments.filter((comment) => taskIds.has(comment.taskId)),
    attachments: (state.attachments ?? []).filter((file) => taskIds.has(file.taskId)),
    imports: state.imports.filter((run) => visible.has(run.boardId)),
  }
}

export async function loadSectors(db: Database): Promise<Sector[]> {
  const sectors = (
    await db.query<{ id: string; name: string; color: string; source: string }>(
      'SELECT id, name, color, source FROM sectors ORDER BY name',
    )
  ).rows
  const members = (
    await db.query<{ sector_id: string; person_id: string }>(
      'SELECT sector_id, person_id FROM sector_members ORDER BY person_id',
    )
  ).rows
  return sectors.map((sector) => ({
    ...sector,
    memberIds: members.filter((m) => m.sector_id === sector.id).map((m) => m.person_id),
  }))
}

async function one(db: Database, sql: string, id: string) {
  return (await db.query<{ board_id: string }>(sql, [id])).rows[0]?.board_id
}
const boardOf = {
  board: async (_db: Database, id: string) => id,
  group: (db: Database, id: string) => one(db, 'SELECT board_id FROM groups WHERE id=$1', id),
  task: (db: Database, id: string) => one(db, 'SELECT board_id FROM tasks WHERE id=$1', id),
  comment: (db: Database, id: string) =>
    one(db, 'SELECT t.board_id FROM comments c JOIN tasks t ON t.id=c.task_id WHERE c.id=$1', id),
  file: (db: Database, id: string) =>
    one(db, 'SELECT t.board_id FROM task_files f JOIN tasks t ON t.id=f.task_id WHERE f.id=$1', id),
  importRun: (db: Database, id: string) =>
    one(db, 'SELECT board_id FROM import_runs WHERE id=$1', id),
}

/** Route pattern → which record its :id names. Routes not listed here need no board check. */
const ROUTES: Record<string, keyof typeof boardOf> = {
  '/api/boards/:id': 'board',
  '/api/boards/:id/automations': 'board',
  '/api/boards/:id/automations/runs': 'board',
  '/api/boards/:id/automations/:ruleId': 'board',
  '/api/boards/:id/column-widths': 'board',
  '/api/boards/:id/column-order': 'board',
  '/api/boards/:id/groups': 'board',
  '/api/boards/:id/columns': 'board',
  '/api/boards/:id/columns/:columnId': 'board',
  '/api/boards/:id/export': 'board',
  '/api/boards/:id/access': 'board',
  '/api/boards/:id/favorite': 'board',
  '/api/groups/:id': 'group',
  '/api/groups/:id/move': 'group',
  '/api/tasks/:id': 'task',
  '/api/tasks/:id/move': 'task',
  '/api/tasks/:id/comments': 'task',
  '/api/tasks/:id/files/:columnId': 'task',
  '/api/comments/:id/like': 'comment',
  '/api/files/:id': 'file',
  '/api/files/:id/preview': 'file',
  '/api/imports/:id/report': 'importRun',
}

/** Needs only sight of the board: favorites, comments and likes, also for its readers. */
const PARTICIPATION = new Set([
  '/api/boards/:id/favorite',
  '/api/tasks/:id/comments',
  '/api/comments/:id/like',
])

export function registerBoardAccess(app: FastifyInstance, db: Database) {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    const viewer = request.viewer
    if (!viewer?.accountId || viewer.role === 'admin') return
    const route = request.routeOptions.url ?? ''
    const reading = request.method === 'GET' || request.method === 'HEAD'
    const kind = ROUTES[route]
    if (kind) {
      const id = (request.params as { id: string }).id
      const need: Need =
        route === '/api/boards/:id/access' && !reading
          ? 'manage'
          : reading || PARTICIPATION.has(route)
            ? 'view'
            : 'edit'
      return assertBoard(db, viewer, await boardOf[kind](db, id), need)
    }
    if (route === '/api/tasks' && request.method === 'POST') {
      const body = z.object({ boardId: z.string() }).passthrough().safeParse(request.body)
      return assertBoard(db, viewer, body.success ? body.data.boardId : undefined, 'edit')
    }
    if (route === '/api/tasks' && request.method === 'DELETE') {
      const body = z
        .object({ ids: z.array(z.string()) })
        .passthrough()
        .safeParse(request.body)
      const ids = body.success ? body.data.ids : []
      const { rows } = await db.query<{ board_id: string }>(
        'SELECT DISTINCT board_id FROM tasks WHERE id = ANY($1::text[])',
        [ids],
      )
      for (const row of rows) await assertBoard(db, viewer, row.board_id, 'edit')
      return
    }
    if (route === '/api/imports/apply') {
      const body = z.object({ boardId: z.string() }).passthrough().safeParse(request.body)
      if (body.success) return assertBoard(db, viewer, body.data.boardId, 'edit')
      return
    }
    // Account-wide monday imports bring every board at once; they stay with administrators.
    if (route.startsWith('/api/monday/'))
      throw new DomainError('Somente administradores podem importar do monday.', 403)
  })

  // Favorites belong to the person, not to the board.
  app.put<{ Params: { id: string } }>('/api/boards/:id/favorite', async (request) => {
    const { favorite } = z.object({ favorite: z.boolean() }).strict().parse(request.body)
    if (favorite)
      await db.query(
        `INSERT INTO board_favorites (board_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [request.params.id, request.viewer.personId],
      )
    else
      await db.query('DELETE FROM board_favorites WHERE board_id=$1 AND person_id=$2', [
        request.params.id,
        request.viewer.personId,
      ])
    return { favorite }
  })

  // Visibility and members of one board, for its owners and administrators.
  app.put<{ Params: { id: string } }>('/api/boards/:id/access', async (request) => {
    const data = z
      .object({
        visibility: z.enum(['public', 'private']),
        members: z
          .array(
            z
              .object({ personId: z.string().min(1), role: z.enum(['owner', 'editor', 'viewer']) })
              .strict(),
          )
          .max(1000),
        sectorId: z.string().min(1).nullable().optional(),
        sectorRole: z.enum(['editor', 'viewer']).optional(),
      })
      .strict()
      .parse(request.body)
    const unique = new Map(data.members.map((member) => [member.personId, member.role]))
    if (data.sectorId) {
      const found = (await db.query('SELECT id FROM sectors WHERE id=$1', [data.sectorId])).rows
      if (!found.length) throw new DomainError('Setor não encontrado.', 400)
    }
    // An owner cannot lock themselves out of the board they are managing. Administrators may
    // leave a private board to a sector alone: they can always manage it.
    const me = request.viewer
    if (me.accountId && me.role !== 'admin' && unique.get(me.personId) !== 'owner')
      throw new DomainError('Mantenha-se como dono para continuar gerenciando este quadro.', 400)
    return db.transaction(async (tx) => {
      const exists = (
        await tx.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [request.params.id])
      ).rows
      if (!exists.length) throw new DomainError('Quadro não encontrado.', 404)
      await tx.query('UPDATE boards SET visibility=$1 WHERE id=$2', [
        data.visibility,
        request.params.id,
      ])
      if (data.sectorId !== undefined)
        await tx.query('UPDATE boards SET sector_id=$1, sector_role=$2 WHERE id=$3', [
          data.sectorId,
          data.sectorRole ?? 'editor',
          request.params.id,
        ])
      await tx.query('DELETE FROM board_members WHERE board_id=$1', [request.params.id])
      for (const [personId, role] of unique)
        await tx.query('INSERT INTO board_members (board_id,person_id,role) VALUES ($1,$2,$3)', [
          request.params.id,
          personId,
          role,
        ])
      return {
        visibility: data.visibility,
        sectorId: data.sectorId,
        sectorRole: data.sectorRole,
        members: [...unique].map(([personId, role]) => ({ personId, role })),
      }
    })
  })
}

/** The person who creates or imports a board becomes its owner. */
export async function addOwner(db: Database, viewer: Viewer, boardId: string) {
  if (!viewer.accountId) return
  await db.query(
    `INSERT INTO board_members (board_id,person_id,role) VALUES ($1,$2,'owner')
     ON CONFLICT (board_id,person_id) DO UPDATE SET role='owner'`,
    [boardId, viewer.personId],
  )
}
