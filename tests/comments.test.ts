import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { taskUpdateCount, taskUpdateCounts, type Comment } from '../shared/domain.ts'

test('update cards count threads, preserve imported metadata and persist idempotent local likes independently of replies', async () => {
  const db = await createDatabase({ path: 'memory://' }),
    app = await buildApp(db, { demo: false })
  try {
    const board = (
        await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Conversas' } })
      ).json(),
      group = (await app.inject('/api/workspace'))
        .json()
        .groups.find((group: { boardId: string }) => group.boardId === board.id)
    const task = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { boardId: board.id, groupId: group.id, title: 'Conferir proposta' },
      })
    ).json()
    const root = (
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/comments`,
        payload: { body: 'Proposta disponível.' },
      })
    ).json<Comment>()
    const reply = (
      await app.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/comments`,
        payload: { body: 'Vou conferir.', parentId: root.id },
      })
    ).json<Comment>()
    assert.equal(taskUpdateCount([root, reply], task.id), 1)
    assert.equal(taskUpdateCounts([root, reply]).get(task.id), 1)
    await db.query('UPDATE comments SET metadata=$1::jsonb WHERE id=$2', [
      JSON.stringify({
        likes: [{ id: 'source-like' }],
        html: '<p>Proposta disponível.</p>',
        sourceAuthor: { id: 'external', name: 'Autor original' },
      }),
      root.id,
    ])
    const like = () =>
      app.inject({ method: 'PUT', url: `/api/comments/${root.id}/like`, payload: { liked: true } })
    assert.equal((await like()).statusCode, 200)
    assert.equal((await like()).statusCode, 200)
    let saved = (await app.inject('/api/workspace'))
      .json()
      .comments.find((comment: Comment) => comment.id === root.id)
    assert.deepEqual(saved.metadata.localLikes, ['person-you'])
    assert.deepEqual(saved.metadata.likes, [{ id: 'source-like' }])
    assert.equal(saved.metadata.html, '<p>Proposta disponível.</p>')
    assert.equal(saved.metadata.sourceAuthor.name, 'Autor original')
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/comments/${root.id}/like`,
          payload: { liked: false },
        })
      ).statusCode,
      200,
    )
    saved = (await app.inject('/api/workspace'))
      .json()
      .comments.find((comment: Comment) => comment.id === root.id)
    assert.deepEqual(saved.metadata.localLikes, [])
    assert.equal(saved.metadata.likes.length, 1)
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/comments/missing/like',
          payload: { liked: true },
        })
      ).statusCode,
      404,
    )
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/comments/${root.id}/like`,
          payload: { liked: 'yes' },
        })
      ).statusCode,
      400,
    )
  } finally {
    await app.close()
    await db.close()
  }
})
