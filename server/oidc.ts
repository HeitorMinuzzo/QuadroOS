// Sign-in with the company account (Keycloak, linked to the Active Directory), the same way as
// Hefesto: the QuadroOS sign-in screen sends user and password to this server, which checks
// them with Keycloak (Direct access grants) and opens a QuadroOS session. The browser never
// leaves the app and the password is not stored.
//
// Keycloak decides who may enter (the realm only has people of the AD group QuadroOS; an
// optional OIDC_REQUIRED_GROUP checks the `groups` claim as well). Everything else stays here: a
// new account starts as a member when its person already owns or edits a board (imported from
// monday, or given through a sector), otherwise as a reader; administrators change roles and
// sectors, and deactivating an account here also blocks it. The first account ever created
// becomes the administrator.
import { createPublicKey, randomUUID, verify } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from './database.ts'
import { DomainError } from './errors.ts'
import { personFor, startSession } from './auth.ts'

export interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret: string
  /** Group a person must have to enter; empty lets every person of the realm in. */
  requiredGroup: string
}

export function oidcConfig(env = process.env): OidcConfig {
  const missing = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].filter((key) => !env[key])
  if (missing.length) throw new Error(`AUTH_MODE=oidc precisa de ${missing.join(', ')} no .env.`)
  return {
    issuer: env.OIDC_ISSUER!.replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    requiredGroup: env.OIDC_REQUIRED_GROUP ?? '',
  }
}

interface Discovery {
  issuer: string
  token_endpoint: string
  jwks_uri: string
}
interface Jwk {
  kid?: string
  kty: string
}

const ALGORITHMS: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
}

export function companySignIn(db: Database, config: OidcConfig, fetcher: typeof fetch = fetch) {
  let discovery: Promise<Discovery> | null = null
  let keys: { at: number; list: Jwk[] } | null = null

  const json = async <T>(url: string) => {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`${url} respondeu ${response.status}`)
    return (await response.json()) as T
  }
  const provider = () => {
    discovery ??= json<Discovery>(`${config.issuer}/.well-known/openid-configuration`).catch(
      (error) => {
        discovery = null
        throw error
      },
    )
    return discovery
  }
  async function signingKey(kid: string | undefined) {
    const fresh = keys && Date.now() - keys.at < 3_600_000
    const find = () => keys?.list.find((key) => key.kty === 'RSA' && (!kid || key.kid === kid))
    if (!fresh || !find())
      keys = {
        at: Date.now(),
        list: (await json<{ keys: Jwk[] }>((await provider()).jwks_uri)).keys,
      }
    const jwk = find()
    if (!jwk) throw new Error('Chave do ID token não encontrada no Keycloak.')
    return createPublicKey({ key: jwk as never, format: 'jwk' })
  }

  /** Verifies the ID token (signature, issuer, client, expiry) and returns its claims. */
  async function claimsOf(idToken: string) {
    const [head, body, signature] = idToken.split('.')
    if (!head || !body || !signature) throw new Error('ID token malformado.')
    const header = JSON.parse(Buffer.from(head, 'base64url').toString()) as {
      alg: string
      kid?: string
    }
    const algorithm = ALGORITHMS[header.alg]
    if (!algorithm) throw new Error(`Algoritmo do ID token não aceito: ${header.alg}`)
    const valid = verify(
      algorithm,
      Buffer.from(`${head}.${body}`),
      await signingKey(header.kid),
      Buffer.from(signature, 'base64url'),
    )
    if (!valid) throw new Error('Assinatura do ID token inválida.')
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>
    if (claims.iss !== (await provider()).issuer) throw new Error('Emissor do ID token diferente.')
    if (!([] as unknown[]).concat(claims.aud).includes(config.clientId))
      throw new Error('ID token de outro client.')
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000 - 60)
      throw new Error('ID token vencido.')
    return claims
  }

  /** The QuadroOS account for this person, linked by Keycloak id (or by email the first time). */
  async function accountFor(claims: Record<string, unknown>) {
    const subject = String(claims.sub)
    const address = String(claims.email ?? claims.preferred_username ?? subject)
      .trim()
      .toLowerCase()
    const displayName =
      String(
        claims.name ||
          [claims.given_name, claims.family_name].filter(Boolean).join(' ') ||
          claims.preferred_username ||
          address,
      ).trim() || address
    return db.transaction(async (tx) => {
      await tx.query('LOCK TABLE accounts IN EXCLUSIVE MODE')
      const linked =
        (
          await tx.query<{ id: string; active: boolean }>(
            'SELECT id, active FROM accounts WHERE external_id=$1',
            [subject],
          )
        ).rows[0] ??
        (
          await tx.query<{ id: string; active: boolean }>(
            'SELECT id, active FROM accounts WHERE email=$1 AND external_id IS NULL',
            [address],
          )
        ).rows[0]
      if (linked) {
        await tx.query('UPDATE accounts SET external_id=$1 WHERE id=$2', [subject, linked.id])
        return linked
      }
      const first = !(await tx.query('SELECT id FROM accounts LIMIT 1')).rows.length
      const personId = await personFor(tx, address, displayName)
      const taken = (
        await tx.query('SELECT id FROM accounts WHERE person_id=$1 OR email=$2', [
          personId,
          address,
        ])
      ).rows.length
      if (taken) throw new DomainError('Já existe outra conta com este e-mail no QuadroOS.', 409)
      // Someone who already owns or edits boards (from monday, or through a sector) keeps editing
      // them on the first sign-in instead of arriving read-only everywhere.
      const editsBoards = (
        await tx.query(
          `SELECT 1 FROM board_members WHERE person_id=$1 AND role IN ('owner','editor')
           UNION ALL
           SELECT 1 FROM sector_members s JOIN boards b ON b.sector_id=s.sector_id
           WHERE s.person_id=$1 AND b.sector_role='editor'
           LIMIT 1`,
          [personId],
        )
      ).rows.length
      const id = randomUUID()
      await tx.query(
        `INSERT INTO accounts (id,person_id,email,role,external_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          personId,
          address,
          first ? 'admin' : editsBoards ? 'member' : 'viewer',
          subject,
          new Date().toISOString(),
        ],
      )
      return { id, active: true }
    })
  }

  /** Checks user and password with Keycloak and opens a QuadroOS session. */
  return async function signIn(
    request: FastifyRequest,
    reply: FastifyReply,
    username: string,
    password: string,
  ) {
    let tokens: { id_token?: string; error?: string; error_description?: string }
    let status: number
    try {
      const response = await fetcher((await provider()).token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          username,
          password,
          scope: 'openid email profile',
        }),
      })
      status = response.status
      tokens = await response.json().catch(() => ({}))
    } catch (error) {
      request.log.warn({ err: error }, 'Keycloak unreachable')
      throw new DomainError('O login da empresa está fora do ar. Tente de novo em instantes.', 503)
    }
    if (status !== 200 || !tokens.id_token) {
      request.log.warn(
        { status, error: tokens.error, description: tokens.error_description },
        'Keycloak refused the sign-in',
      )
      // Wrong password, unknown user and people outside the AD group all look the same here.
      if (tokens.error === 'invalid_grant')
        throw new DomainError('Usuário ou senha incorretos.', 401)
      throw new DomainError(
        'Não foi possível entrar com a conta da empresa. Avise a TI se continuar.',
        502,
      )
    }

    let claims: Record<string, unknown>
    try {
      claims = await claimsOf(tokens.id_token)
    } catch (error) {
      request.log.warn({ err: error }, 'Keycloak ID token rejected')
      throw new DomainError('Não foi possível entrar com a conta da empresa.', 502)
    }
    // Groups arrive as names ("QuadroOS") or full paths ("/TI/QuadroOS").
    const groups = (Array.isArray(claims.groups) ? claims.groups : []).map((group) =>
      String(group).split('/').pop()!.toLocaleLowerCase('pt-BR'),
    )
    if (config.requiredGroup && !groups.includes(config.requiredGroup.toLocaleLowerCase('pt-BR')))
      throw new DomainError('Sua conta não está no grupo do QuadroOS. Peça acesso à TI.', 403)

    const account = await accountFor(claims)
    if (!account.active)
      throw new DomainError(
        'Seu acesso ao QuadroOS foi desativado. Fale com um administrador.',
        403,
      )
    await startSession(db, request, reply, account.id)
  }
}
