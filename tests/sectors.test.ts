import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'
import type { Sector, Workspace } from '../shared/domain.ts'

const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]

test('sectors: created by admins, grant their role on private boards and come from monday folders', async () => {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: true, auth: 'local' })
  try {
    const admin = cookieOf(
      await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { name: 'Ana Costa', email: 'ana@example.com', password: 'senha-da-ana' },
      }),
    )
    async function account(name: string, email: string) {
      const { account, temporaryPassword } = (
        await app.inject({
          method: 'POST',
          url: '/api/accounts',
          headers: { cookie: admin },
          payload: { name, email, role: 'member' },
        })
      ).json()
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: temporaryPassword },
      })
      return { id: account.personId as string, cookie: cookieOf(login) }
    }
    const lucas = await account('Lucas Martins', 'lucas@example.com')
    const julia = await account('Júlia Santos', 'julia@example.com')
    const workspace = async (cookie: string) =>
      (await app.inject({ url: '/api/workspace', headers: { cookie } })).json<Workspace>()

    // Only administrators manage sectors.
    const denied = await app.inject({
      method: 'POST',
      url: '/api/sectors',
      headers: { cookie: lucas.cookie },
      payload: { name: 'Obras' },
    })
    assert.equal(denied.statusCode, 403)
    const created = await app.inject({
      method: 'POST',
      url: '/api/sectors',
      headers: { cookie: admin },
      payload: { name: 'Obras', memberIds: [julia.id] },
    })
    assert.equal(created.statusCode, 201, created.body)
    const obras = created.json<Sector>()
    assert.deepEqual(obras.memberIds, [julia.id])
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/sectors',
      headers: { cookie: admin },
      payload: { name: 'obras' },
    })
    assert.equal(duplicate.statusCode, 409)

    // A private board owned by Lucas, shared with the Obras sector as readers.
    const board = (
      await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { cookie: lucas.cookie },
        payload: { name: 'Obra Norte' },
      })
    ).json().id as string
    const share = (sectorRole: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/boards/${board}/access`,
        headers: { cookie: lucas.cookie },
        payload: {
          visibility: 'private',
          members: [{ personId: lucas.id, role: 'owner' }],
          sectorId: obras.id,
          sectorRole,
        },
      })
    assert.equal((await share('viewer')).statusCode, 200)
    let seen = (await workspace(julia.cookie)).boards.find((b) => b.id === board)
    assert.deepEqual(seen?.access, { canEdit: false, canManage: false })
    assert.equal(seen?.sectorId, obras.id)
    const group = (await workspace(julia.cookie)).groups.find((g) => g.boardId === board)!
    const add = () =>
      app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: { cookie: julia.cookie },
        payload: { boardId: board, groupId: group.id, title: 'Concretagem' },
      })
    assert.equal((await add()).statusCode, 403)

    // As editors, the sector may change the board; leaving the sector removes the access.
    assert.equal((await share('editor')).statusCode, 200)
    assert.equal((await add()).statusCode, 201)
    await app.inject({
      method: 'PATCH',
      url: `/api/sectors/${obras.id}`,
      headers: { cookie: admin },
      payload: { memberIds: [] },
    })
    seen = (await workspace(julia.cookie)).boards.find((b) => b.id === board)
    assert.equal(seen, undefined)
    assert.equal(
      (await app.inject({ url: `/api/boards/${board}/export`, headers: { cookie: julia.cookie } }))
        .statusCode,
      404,
    )

    // monday folders become sectors; boards already in a sector keep it.
    const demo = (await workspace(admin)).boards.filter((b) => b.id !== board)
    const folder = (name: string, folderId: string) => ({
      mondayFolderPath: [
        { id: 'workspace:1', name: 'Industrial' },
        { id: folderId, name },
      ],
    })
    await db.query('UPDATE boards SET settings=$1 WHERE id=$2', [
      JSON.stringify(folder('Manutenção', '10')),
      demo[0].id,
    ])
    await db.query('UPDATE boards SET settings=$1 WHERE id=$2', [
      JSON.stringify(folder('Obras', '11')),
      demo[1].id,
    ])
    await db.query(`INSERT INTO board_members (board_id,person_id,role) VALUES ($1,$2,'editor')`, [
      demo[0].id,
      lucas.id,
    ])
    const fromFolders = await app.inject({
      method: 'POST',
      url: '/api/sectors/from-folders',
      headers: { cookie: admin },
      payload: {},
    })
    assert.deepEqual(fromFolders.json(), { created: 1, assigned: 2, members: 1 })
    const after = await workspace(admin)
    const manutencao = after.sectors!.find((s) => s.name === 'Manutenção')!
    assert.deepEqual(manutencao.memberIds, [lucas.id])
    assert.equal(after.boards.find((b) => b.id === demo[0].id)?.sectorId, manutencao.id)
    assert.equal(after.boards.find((b) => b.id === demo[1].id)?.sectorId, obras.id)
    assert.deepEqual(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sectors/from-folders',
          headers: { cookie: admin },
          payload: {},
        })
      ).json(),
      { created: 0, assigned: 0, members: 0 },
    )

    // Administrators may leave a private board to a sector alone, without direct members.
    await app.inject({
      method: 'PATCH',
      url: `/api/sectors/${obras.id}`,
      headers: { cookie: admin },
      payload: { memberIds: [julia.id] },
    })
    const sectorOnly = await app.inject({
      method: 'PUT',
      url: `/api/boards/${board}/access`,
      headers: { cookie: admin },
      payload: { visibility: 'private', members: [], sectorId: obras.id, sectorRole: 'viewer' },
    })
    assert.equal(sectorOnly.statusCode, 200, sectorOnly.body)
    assert.equal(
      (await workspace(lucas.cookie)).boards.find((b) => b.id === board),
      undefined,
    )
    assert.deepEqual((await workspace(julia.cookie)).boards.find((b) => b.id === board)?.access, {
      canEdit: false,
      canManage: false,
    })

    // Deleting a sector frees its boards.
    await app.inject({
      method: 'DELETE',
      url: `/api/sectors/${obras.id}`,
      headers: { cookie: admin },
    })
    assert.equal((await workspace(admin)).boards.find((b) => b.id === board)?.sectorId, null)
  } finally {
    await app.close()
    await db.close()
  }
})
