// Sectors are teams of people. A board can belong to one sector, which gives every person in it a
// role on the board (see access.ts). Sectors can be created here, from the monday folders the
// boards were imported from, and later from Keycloak groups (source/external_id).
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { BoardSettings, MondayFolder } from '../shared/domain.ts'
import type { Database } from './database.ts'
import { DomainError } from './errors.ts'
import { id } from './repository.ts'
import { loadSectors } from './access.ts'

const COLORS = [
  '#0073ea',
  '#00c875',
  '#fdab3d',
  '#e2445c',
  '#a25ddc',
  '#579bfc',
  '#ff7575',
  '#037f4c',
]
const name = z.string().trim().min(1).max(80)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

function requireAdmin(request: FastifyRequest) {
  if (request.viewer?.role !== 'admin')
    throw new DomainError('Somente administradores podem gerenciar setores.', 403)
}

async function setMembers(db: Database, sectorId: string, memberIds: string[]) {
  await db.query('DELETE FROM sector_members WHERE sector_id=$1', [sectorId])
  for (const personId of new Set(memberIds))
    await db.query(
      `INSERT INTO sector_members (sector_id, person_id)
       SELECT $1, id FROM people WHERE id=$2 ON CONFLICT DO NOTHING`,
      [sectorId, personId],
    )
}

/** The first folder below the workspace (and below "Arquivados"), which is where teams live. */
export function sectorFolder(settings?: BoardSettings | null): MondayFolder | undefined {
  return (settings?.mondayFolderPath ?? []).find(
    (folder) => !folder.id.startsWith('workspace:') && !folder.id.startsWith('archived:'),
  )
}

/** Creates one sector per monday folder and puts the folder's boards (without a sector) in it. */
export async function sectorsFromFolders(db: Database, includeBoardMembers: boolean) {
  return db.transaction(async (tx) => {
    const boards = (
      await tx.query<{
        id: string
        settings: BoardSettings | string | null
        sector_id: string | null
      }>('SELECT id, settings, sector_id FROM boards ORDER BY id')
    ).rows
    const existing = new Map(
      (await tx.query<{ id: string; name: string }>('SELECT id, name FROM sectors')).rows.map(
        (row) => [row.name.toLocaleLowerCase('pt-BR'), row.id],
      ),
    )
    let created = 0
    let assigned = 0
    let members = 0
    for (const board of boards) {
      const settings =
        typeof board.settings === 'string' ? JSON.parse(board.settings) : board.settings
      const folder = sectorFolder(settings)
      if (!folder || board.sector_id) continue
      const key = folder.name.trim().toLocaleLowerCase('pt-BR')
      let sectorId = existing.get(key)
      if (!sectorId) {
        sectorId = id()
        await tx.query(
          `INSERT INTO sectors (id, name, color, source, external_id, created_at)
           VALUES ($1,$2,$3,'monday',$4,$5) ON CONFLICT (external_id) DO NOTHING`,
          [
            sectorId,
            folder.name.trim(),
            COLORS[existing.size % COLORS.length],
            `monday-folder:${folder.id}`,
            new Date().toISOString(),
          ],
        )
        existing.set(key, sectorId)
        created++
      }
      await tx.query('UPDATE boards SET sector_id=$1 WHERE id=$2', [sectorId, board.id])
      assigned++
      if (includeBoardMembers) {
        const added = await tx.query(
          `INSERT INTO sector_members (sector_id, person_id)
           SELECT $1, person_id FROM board_members WHERE board_id=$2
           ON CONFLICT DO NOTHING RETURNING person_id`,
          [sectorId, board.id],
        )
        members += added.rows.length
      }
    }
    return { created, assigned, members }
  })
}

export function registerSectors(app: FastifyInstance, db: Database) {
  app.get('/api/sectors', async () => loadSectors(db))

  app.post('/api/sectors', async (request, reply) => {
    requireAdmin(request)
    const data = z
      .object({
        name,
        color: color.optional(),
        memberIds: z.array(z.string()).max(5000).optional(),
      })
      .strict()
      .parse(request.body)
    const taken = (
      await db.query('SELECT id FROM sectors WHERE lower(name)=lower($1)', [data.name])
    ).rows
    if (taken.length) throw new DomainError('Já existe um setor com esse nome.', 409)
    const sectorId = id()
    const count = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM sectors')).rows[0]
      .n
    await db.query('INSERT INTO sectors (id, name, color, created_at) VALUES ($1,$2,$3,$4)', [
      sectorId,
      data.name,
      data.color ?? COLORS[count % COLORS.length],
      new Date().toISOString(),
    ])
    if (data.memberIds) await setMembers(db, sectorId, data.memberIds)
    return reply.status(201).send((await loadSectors(db)).find((s) => s.id === sectorId))
  })

  app.patch<{ Params: { id: string } }>('/api/sectors/:id', async (request) => {
    requireAdmin(request)
    const data = z
      .object({
        name: name.optional(),
        color: color.optional(),
        memberIds: z.array(z.string()).max(5000).optional(),
      })
      .strict()
      .parse(request.body)
    return db.transaction(async (tx) => {
      const found = (
        await tx.query('SELECT id FROM sectors WHERE id=$1 FOR UPDATE', [request.params.id])
      ).rows
      if (!found.length) throw new DomainError('Setor não encontrado.', 404)
      if (data.name) {
        const taken = (
          await tx.query('SELECT id FROM sectors WHERE lower(name)=lower($1) AND id<>$2', [
            data.name,
            request.params.id,
          ])
        ).rows
        if (taken.length) throw new DomainError('Já existe um setor com esse nome.', 409)
        await tx.query('UPDATE sectors SET name=$1 WHERE id=$2', [data.name, request.params.id])
      }
      if (data.color)
        await tx.query('UPDATE sectors SET color=$1 WHERE id=$2', [data.color, request.params.id])
      if (data.memberIds) await setMembers(tx, request.params.id, data.memberIds)
      return (await loadSectors(tx)).find((s) => s.id === request.params.id)
    })
  })

  app.delete<{ Params: { id: string } }>('/api/sectors/:id', async (request, reply) => {
    requireAdmin(request)
    const removed = await db.query('DELETE FROM sectors WHERE id=$1 RETURNING id', [
      request.params.id,
    ])
    if (!removed.rows.length) throw new DomainError('Setor não encontrado.', 404)
    return reply.status(204).send()
  })

  app.post('/api/sectors/from-folders', async (request) => {
    requireAdmin(request)
    const data = z
      .object({ includeBoardMembers: z.boolean().optional() })
      .strict()
      .parse(request.body ?? {})
    return sectorsFromFolders(db, data.includeBoardMembers ?? true)
  })
}
