import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../server/app.ts'
import { createDatabase, migrate } from '../server/database.ts'
import type { Workspace } from '../shared/domain.ts'

const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]

test('favorites belong to each person, also to read-only accounts', async () => {
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
    async function account(name: string, email: string, role: string) {
      const { temporaryPassword } = (
        await app.inject({
          method: 'POST',
          url: '/api/accounts',
          headers: { cookie: admin },
          payload: { name, email, role },
        })
      ).json()
      return cookieOf(
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: temporaryPassword },
        }),
      )
    }
    const lucas = await account('Lucas Martins', 'lucas@example.com', 'member')
    const leitor = await account('Leitor Geral', 'leitor@example.com', 'viewer')
    const starred = async (cookie: string) =>
      (await app.inject({ url: '/api/workspace', headers: { cookie } }))
        .json<Workspace>()
        .boards.filter((board) => board.favorite)
        .map((board) => board.id)
        .sort()
    const star = (cookie: string, board: string, favorite: boolean) =>
      app.inject({
        method: 'PUT',
        url: `/api/boards/${board}/favorite`,
        headers: { cookie },
        payload: { favorite },
      })

    // The demo favorites belong to the local profile, not to the new accounts.
    assert.deepEqual(await starred(lucas), [])
    assert.equal((await star(lucas, 'board-marketing', true)).statusCode, 200)
    assert.equal((await star(leitor, 'board-ti', true)).statusCode, 200)
    assert.deepEqual(await starred(lucas), ['board-marketing'])
    assert.deepEqual(await starred(leitor), ['board-ti'])
    assert.deepEqual(await starred(admin), [])
    await star(lucas, 'board-marketing', false)
    assert.deepEqual(await starred(lucas), [])

    // A board the person cannot see cannot be starred either.
    await app.inject({
      method: 'PUT',
      url: '/api/boards/board-product/access',
      headers: { cookie: admin },
      payload: { visibility: 'private', members: [] },
    })
    assert.equal((await star(lucas, 'board-product', true)).statusCode, 404)
  } finally {
    await app.close()
    await db.close()
  }
})

test('shared favorites from before move to the local profile and every account', async () => {
  const db = await createDatabase({ path: 'memory://' })
  try {
    await migrate(db)
    await db.query(
      `INSERT INTO people VALUES ('person-you','Você','VC','#205c48','voce@quadro.local'),
       ('person-ana','Ana','AN','#205c48','ana@example.com')`,
    )
    await db.query(
      `INSERT INTO accounts (id,person_id,email,role,created_at) VALUES ('a1','person-ana','ana@example.com','admin','2026-01-01')`,
    )
    await db.query(
      `INSERT INTO boards (id,name,color,favorite) VALUES ('b1','Antigo','#000000',true),('b2','Outro','#000000',false)`,
    )
    await migrate(db)
    const rows = (
      await db.query<{ board_id: string; person_id: string }>(
        'SELECT board_id, person_id FROM board_favorites ORDER BY person_id',
      )
    ).rows
    assert.deepEqual(rows, [
      { board_id: 'b1', person_id: 'person-ana' },
      { board_id: 'b1', person_id: 'person-you' },
    ])
    assert.equal(
      (await db.query('SELECT id FROM boards WHERE favorite')).rows.length,
      0,
      'the shared flag is cleared once moved',
    )
  } finally {
    await db.close()
  }
})
