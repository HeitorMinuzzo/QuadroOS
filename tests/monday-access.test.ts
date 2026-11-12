import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'
import { guessImportMapping } from '../shared/imports.ts'
import type { ImportPreview } from '../shared/domain.ts'
import { richDownloadFetch, richMondayFetch } from './fixtures/monday-rich.ts'

test('monday board kind and members become board visibility and members, merged on re-import', async () => {
  let subscribers = [
    { id: '501', name: 'Dona do Quadro', email: 'dona@example.com' },
    { id: '502', name: 'Membro Um', email: 'membro1@example.com' },
  ]
  const owners = [{ id: '501', name: 'Dona do Quadro', email: 'dona@example.com' }]
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, {
    demo: false,
    auth: 'none',
    mondayDownload: richDownloadFetch,
    mondayFetch: async (url, init) => {
      const response = await richMondayFetch(url, init)
      if (!String(init?.body).includes('boards(ids:')) return response
      const body = await response.json()
      for (const board of body.data?.boards ?? [])
        Object.assign(board, { board_kind: 'private', owners, subscribers })
      return Response.json(body)
    },
  })
  const importBoard = async (boardId?: string) => {
    const preparing = await app.inject({
      method: 'POST',
      url: '/api/monday/preview',
      payload: { token: 'synthetic-token', boardId: '900' },
    })
    assert.equal(preparing.statusCode, 200, preparing.body)
    const client = preparing.json<ImportPreview>()
    const applying = await app.inject({
      method: 'POST',
      url: '/api/imports/apply',
      payload: {
        preview: { sessionId: client.sessionId },
        mapping: guessImportMapping(client),
        importPeople: true,
        ...(boardId ? { boardId } : { boardName: 'Quadro privado' }),
      },
    })
    assert.equal(applying.statusCode, 200, applying.body)
    return applying.json<{ boardId: string }>().boardId
  }
  const access = async (boardId: string) => {
    const visibility = (
      await db.query<{ visibility: string }>('SELECT visibility FROM boards WHERE id=$1', [boardId])
    ).rows[0].visibility
    const members = (
      await db.query<{ email: string; role: string }>(
        `SELECT p.email, m.role FROM board_members m JOIN people p ON p.id=m.person_id
         WHERE m.board_id=$1 ORDER BY p.email`,
        [boardId],
      )
    ).rows.map((row) => `${row.email}:${row.role}`)
    return { visibility, members }
  }
  try {
    const boardId = await importBoard()
    assert.deepEqual(await access(boardId), {
      visibility: 'private',
      members: ['dona@example.com:owner', 'membro1@example.com:editor'],
    })

    // Local changes survive a re-import, which only adds people who were missing.
    await db.query(`UPDATE boards SET visibility='public' WHERE id=$1`, [boardId])
    await db.query(
      `UPDATE board_members SET role='viewer' WHERE board_id=$1 AND person_id=(SELECT id FROM people WHERE email='membro1@example.com')`,
      [boardId],
    )
    subscribers = [...subscribers, { id: '503', name: 'Membro Dois', email: 'membro2@example.com' }]
    await importBoard(boardId)
    assert.deepEqual(await access(boardId), {
      visibility: 'public',
      members: [
        'dona@example.com:owner',
        'membro1@example.com:viewer',
        'membro2@example.com:editor',
      ],
    })
  } finally {
    await app.close()
    await db.close()
  }
})
