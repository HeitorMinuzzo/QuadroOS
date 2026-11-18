import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { buildApp } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'
import type { SessionInfo } from '../shared/domain.ts'

const ISSUER = 'https://sso.test/realms/quadroos'
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }

function token(claims: Record<string, unknown>, key = keys.privateKey) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${part({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${part(claims)}`
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`
}
const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  ([] as string[])
    .concat((response.headers['set-cookie'] as string | string[]) ?? [])
    .map((value) => value.split(';')[0])
    .find((value) => /^quadroos_session=.+/.test(value))

interface Person {
  password: string
  claims: Record<string, unknown>
  key?: typeof keys.privateKey
}

test('company sign-in: user and password checked with Keycloak, first account admin, then readers', async () => {
  // A stand-in for the Keycloak realm: discovery, keys and the password grant.
  const directory = new Map<string, Person>([
    [
      'heitor.teste',
      {
        password: 'senha-do-ad',
        claims: { sub: 'u1', email: 'Heitor@Empresa.com', name: 'Heitor Teste' },
      },
    ],
    ['maria', { password: 'senha-da-maria', claims: { sub: 'u2', email: 'maria@empresa.com' } }],
    ['joao', { password: 'senha-do-joao', claims: { sub: 'u3', email: 'Joao@Empresa.com' } }],
    ['ana', { password: 'senha-da-ana', claims: { sub: 'u4', email: 'ana@empresa.com' } }],
    [
      'falso',
      {
        password: 'x',
        claims: { sub: 'u9', email: 'falso@empresa.com' },
        key: stranger.privateKey,
      },
    ],
  ])
  let grantsDisabled = false
  const keycloak: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer: ISSUER,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        jwks_uri: `${ISSUER}/protocol/openid-connect/certs`,
      })
    if (url.endsWith('/certs')) return Response.json({ keys: [jwk] })
    if (url.endsWith('/token')) {
      const form = new URLSearchParams(String(init?.body))
      if (grantsDisabled) return Response.json({ error: 'unauthorized_client' }, { status: 400 })
      const person = directory.get(form.get('username')!)
      if (
        form.get('grant_type') !== 'password' ||
        form.get('client_secret') !== 'segredo' ||
        !person ||
        person.password !== form.get('password')
      )
        return Response.json(
          { error: 'invalid_grant', error_description: 'Invalid user credentials' },
          { status: 401 },
        )
      return Response.json({
        access_token: 'opaque',
        id_token: token(
          {
            iss: ISSUER,
            aud: 'quadroos',
            exp: Math.floor(Date.now() / 1000) + 300,
            ...person.claims,
          },
          person.key,
        ),
      })
    }
    return new Response('not found', { status: 404 })
  }

  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, {
    demo: false,
    auth: 'oidc',
    oidc: { issuer: ISSUER, clientId: 'quadroos', clientSecret: 'segredo', requiredGroup: '' },
    oidcFetch: keycloak,
  })
  // Each sign-in comes from its own computer, as through the proxy, so the per-person limit of
  // ten attempts a minute does not trip in this long scenario.
  let computer = 0
  const login = (username: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': `192.168.0.${++computer}` },
      payload: { username, password },
    })
  const sessionOf = async (cookie?: string) =>
    (
      await app.inject({ url: '/api/auth/session', headers: { cookie: cookie ?? '' } })
    ).json<SessionInfo>()

  try {
    assert.equal((await sessionOf()).mode, 'oidc')
    assert.equal((await sessionOf()).needsSetup, false)

    // Wrong password or someone outside the realm (not in the AD group): the same answer.
    const wrong = await login('heitor.teste', 'errada')
    assert.equal(wrong.statusCode, 401)
    assert.equal(wrong.json().message, 'Usuário ou senha incorretos.')
    assert.equal((await login('ninguem', 'x')).statusCode, 401)

    // The first person in becomes the administrator; the domain prefix is ignored.
    const heitor = await login('ATHENAS/heitor.teste', 'senha-do-ad')
    assert.equal(heitor.statusCode, 200, heitor.body)
    const admin = sessionCookie(heitor)!
    const first = await sessionOf(admin)
    assert.equal(first.account?.role, 'admin')
    assert.equal(first.account?.email, 'heitor@empresa.com')
    assert.equal(first.account?.name, 'Heitor Teste')

    // Everyone after that starts as a reader; signing in again keeps the same account.
    const maria = sessionCookie(await login('maria@athenas.local', 'senha-da-maria'))!
    const reader = await sessionOf(maria)
    assert.equal(reader.account?.role, 'viewer')
    const again = await sessionOf(sessionCookie(await login('maria', 'senha-da-maria')))
    assert.equal(again.account?.id, reader.account?.id)

    // People imported from monday who already edit a board keep editing it on their first sign-in,
    // linked by email to the imported person; viewers of a board still arrive as readers.
    await db.query(
      `INSERT INTO people (id,name,initials,color,email) VALUES
       ('monday-person-1','João','J','#0073ea','joao@empresa.com'),
       ('monday-person-2','Ana','A','#0073ea','ana@empresa.com')`,
    )
    const board = (
      await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { cookie: admin },
        payload: { name: 'Obras' },
      })
    ).json<{ id: string }>()
    const shared = await app.inject({
      method: 'PUT',
      url: `/api/boards/${board.id}/access`,
      headers: { cookie: admin },
      payload: {
        visibility: 'private',
        members: [
          { personId: 'monday-person-1', role: 'editor' },
          { personId: 'monday-person-2', role: 'viewer' },
        ],
      },
    })
    assert.equal(shared.statusCode, 200, shared.body)
    const joao = await sessionOf(sessionCookie(await login('joao', 'senha-do-joao')))
    assert.equal(joao.account?.role, 'member')
    assert.equal(joao.personId, 'monday-person-1')
    const ana = await sessionOf(sessionCookie(await login('ana', 'senha-da-ana')))
    assert.equal(ana.account?.role, 'viewer')
    assert.equal(ana.personId, 'monday-person-2')

    // Roles are changed here and survive the next sign-in.
    await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${reader.account!.id}`,
      headers: { cookie: admin },
      payload: { role: 'member' },
    })
    const promoted = await sessionOf(sessionCookie(await login('maria', 'senha-da-maria')))
    assert.equal(promoted.account?.role, 'member')

    // Deactivated here: the company account no longer gets in.
    await app.inject({
      method: 'PATCH',
      url: `/api/accounts/${reader.account!.id}`,
      headers: { cookie: admin },
      payload: { active: false },
    })
    const blocked = await login('maria', 'senha-da-maria')
    assert.equal(blocked.statusCode, 403)
    assert.equal(sessionCookie(blocked), undefined)

    // A token signed by anyone else is rejected.
    assert.equal((await login('falso', 'x')).statusCode, 502)

    // Direct access grants switched off in Keycloak: a clear error, nobody gets in.
    grantsDisabled = true
    assert.equal((await login('heitor.teste', 'senha-do-ad')).statusCode, 502)
    grantsDisabled = false

    // No passwords live in QuadroOS: they cannot be changed or reset here.
    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: admin },
      payload: { current: 'senha-do-ad', next: 'outra-senha-1' },
    })
    assert.equal(change.statusCode, 400)

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: admin } })
    assert.equal((await sessionOf(admin)).account, null)
  } finally {
    await app.close()
    await db.close()
  }
})
