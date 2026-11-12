import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'
import { hashPassword, verifyPassword } from '../server/auth.ts'
import type { SessionInfo, Workspace } from '../shared/domain.ts'

async function localApp() {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: true, auth: 'local' })
  return {
    app,
    async close() {
      await app.close()
      await db.close()
    },
  }
}
const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0]

test('passwords are stored as salted scrypt hashes and verified in constant time', async () => {
  const stored = await hashPassword('senha-segura-1')
  assert.match(stored, /^scrypt\$/)
  assert.notEqual(stored, await hashPassword('senha-segura-1'))
  assert.equal(await verifyPassword('senha-segura-1', stored), true)
  assert.equal(await verifyPassword('outra-senha', stored), false)
  assert.equal(await verifyPassword('qualquer', null), false)
})

test('without AUTH_MODE the app keeps working without sign-in as the local profile', async () => {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: true, auth: 'none' })
  try {
    const session = (await app.inject('/api/auth/session')).json<SessionInfo>()
    assert.deepEqual(session, {
      mode: 'none',
      needsSetup: false,
      account: null,
      personId: 'person-you',
    })
    assert.equal((await app.inject('/api/workspace')).statusCode, 200)
    const comment = await app.inject({
      method: 'POST',
      url: '/api/tasks/task-1/comments',
      payload: { body: 'Sem login' },
    })
    assert.equal(comment.json().authorId, 'person-you')
  } finally {
    await app.close()
    await db.close()
  }
})

test('local mode: first admin, sign-in, protected API, roles and temporary passwords', async () => {
  const { app, close } = await localApp()
  try {
    assert.equal((await app.inject('/api/workspace')).statusCode, 401)
    assert.equal((await app.inject('/api/health')).statusCode, 200)
    let session = (await app.inject('/api/auth/session')).json<SessionInfo>()
    assert.equal(session.needsSetup, true)

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { name: 'Ana Costa', email: 'ANA@example.com', password: 'senha-da-ana' },
    })
    assert.equal(setup.statusCode, 201)
    const admin = cookieOf(setup)
    assert.match(String(setup.headers['set-cookie']), /HttpOnly; SameSite=Lax/)
    session = (await app.inject({ url: '/api/auth/session', headers: { cookie: admin } })).json()
    // The admin is linked to the existing person with that email, keeping their tasks.
    assert.equal(session.personId, 'person-ana')
    assert.equal(session.account?.role, 'admin')
    assert.equal(session.needsSetup, false)
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { name: 'Outra', email: 'outra@example.com', password: 'senha-qualquer' },
    })
    assert.equal(again.statusCode, 409)

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'errada-123' },
    })
    assert.equal(wrong.statusCode, 401)
    assert.equal(wrong.json().message, 'E-mail ou senha incorretos.')
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ninguem@example.com', password: 'errada-123' },
    })
    assert.equal(unknown.json().message, wrong.json().message)

    const workspace = await app.inject({ url: '/api/workspace', headers: { cookie: admin } })
    assert.equal(workspace.statusCode, 200)
    const comment = await app.inject({
      method: 'POST',
      url: '/api/tasks/task-1/comments',
      headers: { cookie: admin },
      payload: { body: 'Comentário da Ana' },
    })
    assert.equal(comment.json().authorId, 'person-ana')

    const invited = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: { cookie: admin },
      payload: { name: 'Leitor Teste', email: 'leitor@example.com', role: 'viewer' },
    })
    assert.equal(invited.statusCode, 201)
    const { account, temporaryPassword } = invited.json()
    assert.equal(account.mustChangePassword, true)
    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'leitor@example.com', password: temporaryPassword },
    })
    const viewer = cookieOf(viewerLogin)
    assert.equal(
      (await app.inject({ url: '/api/workspace', headers: { cookie: viewer } })).statusCode,
      200,
    )
    const blocked = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/task-1',
      headers: { cookie: viewer },
      payload: { title: 'Alterado' },
    })
    assert.equal(blocked.statusCode, 403)
    assert.equal(
      (await app.inject({ url: '/api/accounts', headers: { cookie: viewer } })).statusCode,
      403,
    )

    // Viewers may still change their own password, which clears the temporary flag.
    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: viewer },
      payload: { current: temporaryPassword, next: 'senha-nova-do-leitor' },
    })
    assert.equal(changed.statusCode, 200)

    const promoted = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${account.id}`,
      headers: { cookie: admin },
      payload: { role: 'member' },
    })
    assert.equal(promoted.json().role, 'member')
    const edited = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/task-1',
      headers: { cookie: viewer },
      payload: { title: 'Alterado pelo membro', version: 1 },
    })
    assert.equal(edited.statusCode, 200)
    const accounts = await app.inject({ url: '/api/accounts', headers: { cookie: admin } })
    assert.equal(
      accounts.json().find((item: { id: string }) => item.id === account.id).mustChangePassword,
      false,
    )

    const adminId = session.account!.id
    const lastAdmin = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${adminId}`,
      headers: { cookie: admin },
      payload: { role: 'member' },
    })
    assert.equal(lastAdmin.statusCode, 400)

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${account.id}`,
      headers: { cookie: admin },
      payload: { active: false },
    })
    assert.equal(disabled.json().active, false)
    assert.equal(
      (await app.inject({ url: '/api/workspace', headers: { cookie: viewer } })).statusCode,
      401,
    )

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: admin } })
    assert.equal(
      (await app.inject({ url: '/api/workspace', headers: { cookie: admin } })).statusCode,
      401,
    )
    const state = (
      await app.inject({
        url: '/api/workspace',
        headers: {
          cookie: cookieOf(
            await app.inject({
              method: 'POST',
              url: '/api/auth/login',
              payload: { email: 'ana@example.com', password: 'senha-da-ana' },
            }),
          ),
        },
      })
    ).json<Workspace>()
    assert.ok(state.people.some((person) => person.email === 'leitor@example.com'))
  } finally {
    await close()
  }
})
