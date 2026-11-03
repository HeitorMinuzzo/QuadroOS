import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import { buildApp } from '../server/app.ts'
import { createDatabase } from '../server/database.ts'
import { listMondayBoards } from '../server/monday.ts'
import type { MondayBatch, Workspace } from '../shared/domain.ts'
import { richDownloadFetch, richMondayFetch } from './fixtures/monday-rich.ts'

test('board discovery keeps paginating beyond the previous thousand-board cutoff', async () => {
  const boards = await listMondayBoards('synthetic-token', async (_url, init) => {
    const {
      variables: { page },
    } = JSON.parse(String(init?.body))
    const boards = Array.from({ length: page <= 20 ? 50 : 1 }, (_, index) => ({
      id: String((page - 1) * 50 + index + 1),
      name: 'Quadro',
      type: 'board',
    }))
    return Response.json({ data: { boards } })
  })
  assert.equal(boards.length, 1001)
})

test('batch imports each accessible board independently, keeps folders and reuses destinations on retry', async () => {
  const db = await createDatabase({ path: 'memory://' })
  let releaseListing!: () => void
  const held = new Promise<void>((resolve) => {
    releaseListing = resolve
  })
  let app = await buildApp(db, {
    demo: false,
    mondayDownload: richDownloadFetch,
    mondayFetch: async (url, init) => {
      if (String(init?.body).includes('boards(limit:')) await held
      return richMondayFetch(url, init)
    },
  })
  const start = () =>
    app.inject({
      method: 'POST',
      url: '/api/monday/batch',
      payload: { token: 'synthetic-batch-token' },
    })
  const status = () => app.inject('/api/monday/batch')
  async function finish() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await status()
      assert.ok(!response.body.includes('synthetic-batch-token'))
      const { batch } = response.json<{ batch: MondayBatch }>()
      if (batch.status !== 'running') return batch
      await setTimeout(50)
    }
    assert.fail('A importação em lote não terminou.')
  }
  try {
    assert.equal((await start()).statusCode, 202)
    assert.equal((await start()).statusCode, 409)
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/imports/apply', payload: {} })).statusCode,
      409,
    )
    releaseListing()
    const first = await finish()
    assert.equal(first.status, 'complete')
    assert.equal(first.total, 3)
    assert.deepEqual(
      first.results.map((item) => item.sourceBoardId),
      ['910', '911', '912'],
    )
    assert.equal(first.results[0].imported, 4)
    assert.ok(first.results[0].reportId)
    assert.ok(first.results[1].error)
    assert.equal(first.results[2].imported, 0)
    assert.ok(first.results[2].boardId)
    await db.query("UPDATE boards SET settings=settings-'monday'-'mondayFolderPath' WHERE id=$1", [
      first.results[0].boardId,
    ])
    await db.query("UPDATE tasks SET title=$1 WHERE board_id=$2 AND external_id='101'", [
      'Edição local',
      first.results[0].boardId,
    ])
    assert.equal((await start()).statusCode, 202)
    const second = await finish()
    assert.equal(second.results[0].boardId, first.results[0].boardId)
    assert.equal(second.results[0].skipped, 4)
    assert.equal(second.results[2].boardId, first.results[2].boardId)
    const state = (await app.inject('/api/workspace')).json<Workspace>()
    assert.equal(state.boards.length, 2)
    assert.equal(state.tasks.length, 4)
    assert.equal(state.tasks.find((task) => task.externalId === '101')?.title, 'Edição local')
    assert.deepEqual(
      state.boards
        .find((board) => board.id === first.results[0].boardId)
        ?.settings?.mondayFolderPath?.map((folder) => folder.name),
      ['TI', 'Infraestrutura'],
    )
    await app.close()
    // Simulate the checkpoint left behind by a server exit halfway through the batch.
    await db.query('UPDATE monday_batch_checkpoint SET snapshot=$1::jsonb WHERE id=1', [
      JSON.stringify({
        ...second,
        status: 'running',
        currentBoard: 'Lote - Falha',
        results: second.results.slice(0, 1),
      }),
    ])
    app = await buildApp(db, {
      demo: false,
      mondayDownload: richDownloadFetch,
      mondayFetch: richMondayFetch,
    })
    const interrupted = (await status()).json<{ batch: MondayBatch }>().batch
    assert.equal(interrupted.status, 'interrupted')
    assert.equal(interrupted.currentBoard, null)
    assert.equal(interrupted.results.length, 1)
    const resumed = await app.inject({
      method: 'POST',
      url: '/api/monday/batch',
      payload: { token: 'synthetic-batch-token', resumeId: interrupted.id },
    })
    assert.equal(resumed.statusCode, 202)
    const final = await finish()
    assert.equal(final.status, 'complete')
    assert.equal(final.results.length, 3)
    assert.equal(final.results[0].reportId, interrupted.results[0].reportId)
    assert.equal(final.results[2].boardId, first.results[2].boardId)
  } finally {
    releaseListing()
    await app.close()
    await db.close()
  }
})
