import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INTERNAL_PROXIES, buildApp, trustProxy, type TrustProxy } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'

test('TRUST_PROXY: internal proxies by default, or what the setting says', () => {
  assert.equal(trustProxy(undefined), INTERNAL_PROXIES)
  assert.equal(trustProxy(''), INTERNAL_PROXIES)
  assert.equal(trustProxy('2'), 2)
  assert.equal(trustProxy('true'), true)
  assert.equal(trustProxy('false'), false)
  assert.equal(trustProxy('10.0.0.5,10.0.0.6'), '10.0.0.5,10.0.0.6')
})

/**
 * Ten wrong passwords from one person, then one more from them and one from a colleague.
 * The request reaches the app from `peer`; `forwarded` is what the proxies in between added.
 */
async function attempts(setting: TrustProxy, peer: string, forwarded: (client: string) => string) {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: false, auth: 'local', trustProxy: setting })
  const login = (client: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: peer,
      headers: { 'x-forwarded-for': forwarded(client) },
      payload: { email: 'ninguem@empresa.com', password: 'errada' },
    })
  try {
    for (let i = 0; i < 10; i++) assert.equal((await login('192.168.0.10')).statusCode, 401)
    const sameClient = await login('192.168.0.10')
    assert.match(sameClient.json().message, /Muitas tentativas/)
    return {
      sameClient: sameClient.statusCode,
      otherClient: (await login('192.168.0.11')).statusCode,
    }
  } finally {
    await app.close()
    await db.close()
  }
}

test('behind the proxies the sign-in limit counts each person, not the whole company', async () => {
  // Coolify: openresty (10.0.0.5) hands over to Coolify's proxy (172.18.0.2), which calls the app.
  const twoProxies = (client: string) => `${client}, 10.0.0.5`
  assert.deepEqual(await attempts(trustProxy(undefined), '172.18.0.2', twoProxies), {
    sameClient: 429,
    otherClient: 401,
  })
  // A single proxy works the same with the default.
  assert.deepEqual(await attempts(trustProxy(undefined), '10.0.0.5', (client) => client), {
    sameClient: 429,
    otherClient: 401,
  })
  // A hop count still works when it matches the chain.
  assert.deepEqual(await attempts(2, '172.18.0.2', twoProxies), {
    sameClient: 429,
    otherClient: 401,
  })
  // Without trusting the proxies everyone shares one address and the next person is blocked too.
  assert.deepEqual(await attempts(false, '172.18.0.2', twoProxies), {
    sameClient: 429,
    otherClient: 429,
  })
})
