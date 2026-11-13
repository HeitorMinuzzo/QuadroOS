import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'
import type { Workspace } from '../shared/domain.ts'

const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]

test('board access: private boards, board roles, read-only accounts and sharing', async () => {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: true, auth: 'local' })
  try {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { name: 'Ana Costa', email: 'ana@example.com', password: 'senha-da-ana' },
    })
    const admin = cookieOf(setup)
    const as = (cookie: string) => ({ cookie })
    async function account(name: string, email: string, role: string) {
      const created = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: as(admin),
        payload: { name, email, role },
      })
      const { account, temporaryPassword } = created.json()
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: temporaryPassword },
      })
      return { id: account.personId as string, cookie: cookieOf(login) }
    }
    const lucas = await account('Lucas Martins', 'lucas@example.com', 'member')
    const julia = await account('Júlia Santos', 'julia@example.com', 'member')
    const leitor = await account('Leitor Geral', 'leitor@example.com', 'viewer')
    const boards = async (cookie: string) =>
      (await app.inject({ url: '/api/workspace', headers: as(cookie) })).json<Workspace>()

    // Lucas creates a board: he becomes its owner and makes it private, sharing it with Júlia
    // as a viewer.
    const created = await app.inject({
      method: 'POST',
      url: '/api/boards',
      headers: as(lucas.cookie),
      payload: { name: 'Assuntos RH' },
    })
    const rh = created.json().id as string
    let mine = (await boards(lucas.cookie)).boards.find((board) => board.id === rh)!
    assert.deepEqual(mine.members, [{ personId: lucas.id, role: 'owner' }])
    assert.deepEqual(mine.access, { canEdit: true, canManage: true })
    const shared = await app.inject({
      method: 'PUT',
      url: `/api/boards/${rh}/access`,
      headers: as(lucas.cookie),
      payload: {
        visibility: 'private',
        members: [
          { personId: lucas.id, role: 'owner' },
          { personId: julia.id, role: 'viewer' },
        ],
      },
    })
    assert.equal(shared.statusCode, 200)

    // Júlia sees it read-only; the general reader and the demo boards' public data stay visible.
    const juliaView = await boards(julia.cookie)
    mine = juliaView.boards.find((board) => board.id === rh)!
    assert.deepEqual(mine.access, { canEdit: false, canManage: false })
    const group = juliaView.groups.find((item) => item.boardId === rh)!
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: as(julia.cookie),
      payload: { boardId: rh, groupId: group.id, title: 'Não pode' },
    })
    assert.equal(blocked.statusCode, 403)
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/boards/${rh}/access`,
          headers: as(julia.cookie),
          payload: { visibility: 'public', members: [] },
        })
      ).statusCode,
      403,
    )

    // The reader is not a member: the private board, its groups and tasks do not exist for them.
    const readerView = await boards(leitor.cookie)
    assert.equal(
      readerView.boards.some((board) => board.id === rh),
      false,
    )
    assert.equal(
      readerView.groups.some((item) => item.boardId === rh),
      false,
    )
    assert.equal(
      (await app.inject({ url: `/api/boards/${rh}/export`, headers: as(leitor.cookie) }))
        .statusCode,
      404,
    )
    // Public demo boards remain visible to every account, read-only for the reader account.
    const publicBoard = readerView.boards.find((board) => board.id === 'board-ti')!
    assert.deepEqual(publicBoard.access, { canEdit: false, canManage: false })

    // On public boards members can edit; Lucas adds a task to the demo board.
    const demoGroup = readerView.groups.find((item) => item.boardId === 'board-ti')!
    const added = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: as(lucas.cookie),
      payload: { boardId: 'board-ti', groupId: demoGroup.id, title: 'Tarefa do Lucas' },
    })
    assert.equal(added.statusCode, 201)

    // Júlia becomes an editor: now she can add tasks to the private board.
    await app.inject({
      method: 'PUT',
      url: `/api/boards/${rh}/access`,
      headers: as(lucas.cookie),
      payload: {
        visibility: 'private',
        members: [
          { personId: lucas.id, role: 'owner' },
          { personId: julia.id, role: 'editor' },
        ],
      },
    })
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: as(julia.cookie),
      payload: { boardId: rh, groupId: group.id, title: 'Agora pode' },
    })
    assert.equal(allowed.statusCode, 201)

    // Owners cannot remove their own ownership; administrators may leave a board without owner.
    const lockedOut = await app.inject({
      method: 'PUT',
      url: `/api/boards/${rh}/access`,
      headers: as(lucas.cookie),
      payload: { visibility: 'private', members: [{ personId: julia.id, role: 'owner' }] },
    })
    assert.equal(lockedOut.statusCode, 400)
    const noOwner = await app.inject({
      method: 'PUT',
      url: `/api/boards/${rh}/access`,
      headers: as(admin),
      payload: { visibility: 'private', members: [{ personId: julia.id, role: 'editor' }] },
    })
    assert.equal(noOwner.statusCode, 200)

    // Administrators see and manage every board, and only they import from monday.
    const adminView = (await boards(admin)).boards.find((board) => board.id === rh)!
    assert.deepEqual(adminView.access, { canEdit: true, canManage: true })
    assert.equal(
      (await app.inject({ url: '/api/monday/batch', headers: as(lucas.cookie) })).statusCode,
      403,
    )
    assert.equal(
      (await app.inject({ url: '/api/monday/batch', headers: as(admin) })).statusCode,
      200,
    )
  } finally {
    await app.close()
    await db.close()
  }
})
