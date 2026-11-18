import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp, trustProxy } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'

test('TRUST_PROXY: one proxy hop by default, or what the setting says', () => {
  assert.equal(trustProxy(undefined), 1)
  assert.equal(trustProxy(''), 1)
  assert.equal(trustProxy('2'), 2)
  assert.equal(trustProxy('true'), true)
  assert.equal(trustProxy('false'), false)
  assert.equal(trustProxy('10.0.0.5,10.0.0.6'), '10.0.0.5,10.0.0.6')
})

async function attempts(setting: false | 1) {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: false, auth: 'local', trustProxy: setting })
  // Every request reaches the app from the proxy; the proxy adds who actually called.
  const login = (client: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': client },
      payload: { email: 'ninguem@empresa.com', password: 'errada' },
    })
  try {
    for (let i = 0; i < 10; i++) assert.equal((await login('192.168.0.10')).statusCode, 401)
    return {
      sameClient: (await login('192.168.0.10')).statusCode,
      otherClient: (await login('192.168.0.11')).statusCode,
    }
  } finally {
    await app.close()
    await db.close()
  }
}

test('behind the proxy the sign-in limit counts each person, not the whole company', async () => {
  assert.deepEqual(await attempts(1), { sameClient: 429, otherClient: 401 })
  // Without trusting the proxy everyone shares its address and the next person is blocked too.
  assert.deepEqual(await attempts(false), { sameClient: 429, otherClient: 429 })
})
