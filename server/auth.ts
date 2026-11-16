// Accounts, sessions and the request's signed-in person.
//
// AUTH_MODE selects how people sign in:
//   none  — no sign-in; every request acts as the built-in "Você" profile (the original behaviour).
//   local — email and password stored here (scrypt), with an admin creating the other accounts.
//   oidc  — user and password of the company account, checked with Keycloak (see oidc.ts);
//           accounts are linked through external_id and roles stay here.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { initials, type AccountRole, type SessionInfo } from '../shared/domain.ts'
import type { Database } from './database.ts'
import { DomainError } from './errors.ts'
import { companySignIn, oidcConfig, type OidcConfig } from './oidc.ts'

export type AuthMode = 'none' | 'local' | 'oidc'
export interface Viewer {
  personId: string
  role: AccountRole
  accountId: string | null
}
declare module 'fastify' {
  interface FastifyRequest {
    viewer: Viewer
  }
}

const SESSION_COOKIE = 'quadroos_session'
const SESSION_DAYS = 14
const LOCAL_PROFILE: Viewer = { personId: 'person-you', role: 'admin', accountId: null }
const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, 64)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}
export async function verifyPassword(password: string, stored: string | null) {
  const [scheme, salt, hash] = (stored ?? '').split('$')
  if (scheme !== 'scrypt' || !salt || !hash) {
    // Same work for unknown accounts, so response time does not reveal which emails exist.
    await derive(password, randomBytes(16), 64)
    return false
  }
  const expected = Buffer.from(hash, 'base64url')
  const actual = await derive(password, Buffer.from(salt, 'base64url'), expected.length)
  return timingSafeEqual(actual, expected)
}
/** A readable temporary password for invitations and resets, shown once to the admin. */
function temporaryPassword() {
  return randomBytes(9).toString('base64url')
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function readCookie(request: FastifyRequest, name: string) {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}
function sessionCookie(request: FastifyRequest, value: string, maxAge: number) {
  const secure =
    request.protocol === 'https' || (process.env.APP_ORIGIN ?? '').startsWith('https://')
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ')
}

const password = z.string().min(8, 'Use uma senha com pelo menos 8 caracteres.').max(200)
const email = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(200)
const name = z.string().trim().min(1).max(120)
const role = z.enum(['admin', 'member', 'viewer'])

interface AccountRow {
  id: string
  person_id: string
  email: string
  role: AccountRole
  active: boolean
  password_hash: string | null
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
  name?: string
}
const publicAccount = (row: AccountRow) => ({
  id: row.id,
  personId: row.person_id,
  email: row.email,
  name: row.name ?? '',
  role: row.role,
  active: row.active,
  mustChangePassword: row.must_change_password,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
})

/** Finds the person with this email, or creates one, so imported assignees keep their tasks. */
export async function personFor(db: Database, address: string, displayName: string) {
  const existing = (
    await db.query<{ id: string }>('SELECT id FROM people WHERE lower(email)=$1', [address])
  ).rows[0]
  if (existing) return existing.id
  const id = `person-${randomUUID()}`
  const palette = ['#0073ea', '#9d50dd', '#037f4c', '#bd653c', '#647ac1']
  await db.query('INSERT INTO people (id,name,initials,color,email) VALUES ($1,$2,$3,$4,$5)', [
    id,
    displayName,
    initials(displayName),
    palette[address.length % palette.length],
    address,
  ])
  return id
}
export async function startSession(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  await db.query(
    'INSERT INTO sessions (id,account_id,created_at,expires_at) VALUES ($1,$2,$3,$4)',
    [tokenHash(token), accountId, now.toISOString(), expires.toISOString()],
  )
  await db.query('UPDATE accounts SET last_login_at=$1 WHERE id=$2', [now.toISOString(), accountId])
  reply.header('Set-Cookie', sessionCookie(request, token, SESSION_DAYS * 86_400))
}
async function activeAdmins(db: Database, except?: string) {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) n FROM accounts WHERE role='admin' AND active AND ($1::text IS NULL OR id<>$1)`,
    [except ?? null],
  )
  return Number(rows[0].n)
}

export function registerAuth(
  app: FastifyInstance,
  db: Database,
  mode: AuthMode,
  options: { oidc?: OidcConfig; oidcFetch?: typeof fetch } = {},
) {
  app.decorateRequest('viewer', null as unknown as Viewer)

  // Resolves who is calling. In local mode every API route except sign-in needs a session,
  // and viewers can read but not change anything.
  app.addHook('onRequest', async (request, reply) => {
    if (mode === 'none') {
      request.viewer = LOCAL_PROFILE
      return
    }
    const token = readCookie(request, SESSION_COOKIE)
    if (token) {
      const row = (
        await db.query<{ account_id: string; person_id: string; role: AccountRole }>(
          `SELECT s.account_id, a.person_id, a.role FROM sessions s JOIN accounts a ON a.id=s.account_id
           WHERE s.id=$1 AND s.expires_at>$2 AND a.active`,
          [tokenHash(token), new Date().toISOString()],
        )
      ).rows[0]
      if (row)
        request.viewer = { personId: row.person_id, role: row.role, accountId: row.account_id }
    }
    const path = request.url.split('?')[0]
    if (!path.startsWith('/api/') || path === '/api/health' || path.startsWith('/api/auth/')) return
    if (!request.viewer)
      return reply.status(401).send({ message: 'Entre com sua conta para continuar.' })
    // Favorites are personal, so read-only accounts may still star the boards they see.
    const personal = /^\/api\/boards\/[^/]+\/favorite$/.test(path)
    if (request.viewer.role === 'viewer' && !personal && !['GET', 'HEAD'].includes(request.method))
      return reply.status(403).send({ message: 'Seu acesso é somente de leitura.' })
  })

  const requireAdmin = (request: FastifyRequest) => {
    if (request.viewer?.role !== 'admin')
      throw new DomainError('Somente administradores podem gerenciar usuários.', 403)
  }

  const company =
    mode === 'oidc' ? companySignIn(db, options.oidc ?? oidcConfig(), options.oidcFetch) : null

  app.get('/api/auth/session', async (request): Promise<SessionInfo> => {
    if (mode === 'none')
      return { mode, needsSetup: false, account: null, personId: LOCAL_PROFILE.personId }
    // With Keycloak the first person to sign in becomes the administrator; no setup screen.
    const needsSetup =
      mode === 'local' && !(await db.query('SELECT id FROM accounts LIMIT 1')).rows.length
    if (!request.viewer?.accountId) return { mode, needsSetup, account: null, personId: null }
    const row = (
      await db.query<AccountRow>(
        'SELECT a.*, p.name FROM accounts a JOIN people p ON p.id=a.person_id WHERE a.id=$1',
        [request.viewer.accountId],
      )
    ).rows[0]
    return { mode, needsSetup, account: publicAccount(row), personId: row.person_id }
  })

  if (mode === 'none') return
  // Passwords only exist with local sign-in.
  const local = () => {
    if (mode !== 'local')
      throw new DomainError(
        'O acesso é pelo login da empresa (Keycloak); senhas não ficam no QuadroOS.',
        400,
      )
  }

  // First run: the first person to open the app creates the administrator account.
  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      local()
      const data = z.object({ name, email, password }).strict().parse(request.body)
      const accountId = await db.transaction(async (tx) => {
        await tx.query('LOCK TABLE accounts IN EXCLUSIVE MODE')
        if ((await tx.query('SELECT id FROM accounts LIMIT 1')).rows.length)
          throw new DomainError('O administrador já foi configurado. Entre com sua conta.', 409)
        const personId = await personFor(tx, data.email, data.name)
        const id = randomUUID()
        await tx.query(
          `INSERT INTO accounts (id,person_id,email,role,password_hash,created_at) VALUES ($1,$2,$3,'admin',$4,$5)`,
          [id, personId, data.email, await hashPassword(data.password), new Date().toISOString()],
        )
        return id
      })
      await startSession(db, request, reply, accountId)
      return reply.status(201).send({ ok: true })
    },
  )

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (company) {
        const data = z
          .object({
            username: z.string().trim().min(1, 'Informe o usuário.').max(200),
            password: z.string().min(1, 'Informe a senha.').max(200),
          })
          .strict()
          .parse(request.body)
        // A domain prefix (ATHENAS then a backslash) or suffix (@athenas.local) is dropped:
        // Keycloak knows the person by the network login alone.
        const username = data.username.split(/[\\/]/).pop()!.split('@')[0]
        await company(request, reply, username, data.password)
        return { ok: true }
      }
      local()
      const data = z
        .object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) })
        .strict()
        .parse(request.body)
      const row = (
        await db.query<AccountRow>('SELECT * FROM accounts WHERE email=$1', [data.email])
      ).rows[0]
      const valid = await verifyPassword(data.password, row?.password_hash ?? null)
      if (!row || !valid || !row.active) throw new DomainError('E-mail ou senha incorretos.', 401)
      await startSession(db, request, reply, row.id)
      return { ok: true }
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    const token = readCookie(request, SESSION_COOKIE)
    if (token) await db.query('DELETE FROM sessions WHERE id=$1', [tokenHash(token)])
    reply.header('Set-Cookie', sessionCookie(request, '', 0))
    return { ok: true }
  })

  app.post(
    '/api/auth/password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      local()
      if (!request.viewer?.accountId)
        throw new DomainError('Entre com sua conta para continuar.', 401)
      const data = z
        .object({ current: z.string().max(200), next: password })
        .strict()
        .parse(request.body)
      const row = (
        await db.query<AccountRow>('SELECT * FROM accounts WHERE id=$1', [request.viewer.accountId])
      ).rows[0]
      if (!(await verifyPassword(data.current, row.password_hash)))
        throw new DomainError('A senha atual não confere.', 400)
      if (data.current === data.next)
        throw new DomainError('Escolha uma senha diferente da atual.', 400)
      await db.query(
        'UPDATE accounts SET password_hash=$1, must_change_password=false WHERE id=$2',
        [await hashPassword(data.next), row.id],
      )
      // Other devices signed in with the old password are signed out.
      const current = tokenHash(readCookie(request, SESSION_COOKIE) ?? '')
      await db.query('DELETE FROM sessions WHERE account_id=$1 AND id<>$2', [row.id, current])
      return { ok: true }
    },
  )

  app.get('/api/accounts', async (request) => {
    requireAdmin(request)
    const { rows } = await db.query<AccountRow>(
      'SELECT a.*, p.name FROM accounts a JOIN people p ON p.id=a.person_id ORDER BY lower(p.name)',
    )
    return rows.map(publicAccount)
  })

  // Admins create accounts with a temporary password, shown once, that must be changed on sign-in.
  app.post('/api/accounts', async (request, reply) => {
    requireAdmin(request)
    local()
    const data = z.object({ name, email, role }).strict().parse(request.body)
    const temporary = temporaryPassword()
    const account = await db.transaction(async (tx) => {
      if ((await tx.query('SELECT id FROM accounts WHERE email=$1', [data.email])).rows.length)
        throw new DomainError('Já existe uma conta com este e-mail.', 409)
      const personId = await personFor(tx, data.email, data.name)
      if ((await tx.query('SELECT id FROM accounts WHERE person_id=$1', [personId])).rows.length)
        throw new DomainError('Esta pessoa já tem uma conta.', 409)
      const id = randomUUID()
      await tx.query(
        `INSERT INTO accounts (id,person_id,email,role,password_hash,must_change_password,created_at)
         VALUES ($1,$2,$3,$4,$5,true,$6)`,
        [
          id,
          personId,
          data.email,
          data.role,
          await hashPassword(temporary),
          new Date().toISOString(),
        ],
      )
      return (
        await tx.query<AccountRow>(
          'SELECT a.*, p.name FROM accounts a JOIN people p ON p.id=a.person_id WHERE a.id=$1',
          [id],
        )
      ).rows[0]
    })
    return reply.status(201).send({ account: publicAccount(account), temporaryPassword: temporary })
  })

  app.patch<{ Params: { id: string } }>('/api/accounts/:id', async (request) => {
    requireAdmin(request)
    const data = z
      .object({ role: role.optional(), active: z.boolean().optional() })
      .strict()
      .parse(request.body)
    const target = (
      await db.query<AccountRow>('SELECT * FROM accounts WHERE id=$1', [request.params.id])
    ).rows[0]
    if (!target) throw new DomainError('Conta não encontrada.', 404)
    const losesAdmin =
      target.role === 'admin' &&
      target.active &&
      ((data.role && data.role !== 'admin') || data.active === false)
    if (losesAdmin && (await activeAdmins(db, target.id)) === 0)
      throw new DomainError('Mantenha pelo menos um administrador ativo.', 400)
    await db.query(
      'UPDATE accounts SET role=COALESCE($1,role), active=COALESCE($2,active) WHERE id=$3',
      [data.role ?? null, data.active ?? null, target.id],
    )
    if (data.active === false)
      await db.query('DELETE FROM sessions WHERE account_id=$1', [target.id])
    const row = (
      await db.query<AccountRow>(
        'SELECT a.*, p.name FROM accounts a JOIN people p ON p.id=a.person_id WHERE a.id=$1',
        [target.id],
      )
    ).rows[0]
    return publicAccount(row)
  })

  app.post<{ Params: { id: string } }>('/api/accounts/:id/reset-password', async (request) => {
    requireAdmin(request)
    local()
    const temporary = temporaryPassword()
    const { rows } = await db.query(
      'UPDATE accounts SET password_hash=$1, must_change_password=true WHERE id=$2 RETURNING id',
      [await hashPassword(temporary), request.params.id],
    )
    if (!rows.length) throw new DomainError('Conta não encontrada.', 404)
    await db.query('DELETE FROM sessions WHERE account_id=$1', [request.params.id])
    return { temporaryPassword: temporary }
  })
}

export function authMode(value = process.env.AUTH_MODE): AuthMode {
  return value === 'local' || value === 'oidc' ? value : 'none'
}
