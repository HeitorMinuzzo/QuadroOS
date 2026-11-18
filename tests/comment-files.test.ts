import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { MAX_FILE_SIZE, UPDATE_FILES_COLUMN, type Workspace } from '../shared/domain.ts'

// The smallest valid PNG: enough for the preview route to recognise an image.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function multipart(fields: Record<string, string>, files: [string, Uint8Array][]) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.append(key, value)
  for (const [name, content] of files)
    body.append('files', new Blob([new Uint8Array(content)]), name)
  const request = new Request('http://localhost/upload', { method: 'POST', body })
  return {
    headers: { 'content-type': request.headers.get('content-type')! },
    payload: Buffer.from(await request.arrayBuffer()),
  }
}

test('updates carry attached and pasted files, saved with the comment and shown inline', async () => {
  const db = await createDatabase({ path: 'memory://' })
  const app = await buildApp(db, { demo: false })
  try {
    const board = (
      await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Obras' } })
    ).json()
    const group = (await app.inject('/api/workspace'))
      .json<Workspace>()
      .groups.find((item) => item.boardId === board.id)!
    const task = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { boardId: board.id, groupId: group.id, title: 'Telhado' },
      })
    ).json()
    const post = async (fields: Record<string, string>, files: [string, Uint8Array][]) =>
      app.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/comments`,
        ...(await multipart(fields, files)),
      })

    // Text with a pasted screenshot and a document: one comment, both files tied to it.
    const sent = await post({ body: 'Foto do vazamento' }, [
      ['imagem-colada-20261118-101500.png', PNG],
      ['orçamento.pdf', Buffer.from('%PDF-1.4 teste')],
    ])
    assert.equal(sent.statusCode, 201, sent.body)
    const comment = sent.json()
    assert.equal(comment.body, 'Foto do vazamento')
    let workspace = (await app.inject('/api/workspace')).json<Workspace>()
    const attached = workspace.attachments!.filter((file) => file.commentId === comment.id)
    assert.deepEqual(attached.map((file) => file.name).sort(), [
      'imagem-colada-20261118-101500.png',
      'orçamento.pdf',
    ])
    assert.ok(attached.every((file) => file.columnId === UPDATE_FILES_COLUMN))
    assert.ok(attached.every((file) => file.taskId === task.id))

    // The image opens inline (no download), byte for byte.
    const image = attached.find((file) => file.name.endsWith('.png'))!
    const preview = await app.inject(`/api/files/${image.id}/preview`)
    assert.equal(preview.statusCode, 200)
    assert.equal(preview.headers['content-type'], 'image/png')
    assert.equal(preview.headers['content-disposition'], 'inline')
    assert.deepEqual(preview.rawPayload, PNG)

    // An image alone is a valid update, and replies can carry files too.
    const onlyImage = await post({ body: '' }, [['foto.png', PNG]])
    assert.equal(onlyImage.statusCode, 201, onlyImage.body)
    assert.equal(onlyImage.json().body, '')
    const reply = await post({ body: 'Depois do conserto', parentId: comment.id }, [
      ['depois.png', PNG],
    ])
    assert.equal(reply.statusCode, 201, reply.body)
    assert.equal(reply.json().parentId, comment.id)

    // Nothing to say and nothing attached is refused; so is a file over the limit,
    // and in that case no half-saved comment is left behind.
    const empty = await post({ body: '   ' }, [])
    assert.equal(empty.statusCode, 400)
    const before = (await app.inject('/api/workspace')).json<Workspace>().comments.length
    const huge = await post({ body: 'Grande demais' }, [
      ['grande.png', Buffer.alloc(MAX_FILE_SIZE + 1)],
    ])
    assert.equal(huge.statusCode, 413, huge.body)
    assert.equal(huge.json().message, 'O arquivo excede o limite de 5 MB.')
    workspace = (await app.inject('/api/workspace')).json<Workspace>()
    assert.equal(workspace.comments.length, before)

    // Plain JSON comments keep working as before.
    const text = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/comments`,
      payload: { body: 'Só texto' },
    })
    assert.equal(text.statusCode, 201)
  } finally {
    await app.close()
    await db.close()
  }
})
