import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase } from '../server/database.ts'
import { buildApp } from '../server/app.ts'
import { workspace, moveGroup } from '../server/repository.ts'

test('group moves persist a complete unique order, isolate boards and preserve group metadata and tasks', async () => {
  const db = await createDatabase({ path: 'memory://' }),
    app = await buildApp(db, { demo: false })
  try {
    const board = (
      await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Grupos' } })
    ).json()
    const first = (await workspace(db)).groups.find((group) => group.boardId === board.id)!
    const third = (
      await app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/groups`,
        payload: { name: 'Importado', color: '#0073ea' },
      })
    ).json()
    await db.query('UPDATE groups SET source=$1,external_id=$2 WHERE id=$3', [
      'monday',
      'source-group',
      third.id,
    ])
    const task = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { boardId: board.id, groupId: first.id, title: 'Preservar tarefa' },
      })
    ).json()
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        boardId: board.id,
        groupId: first.id,
        parentId: task.id,
        title: 'Preservar subitem',
      },
    })
    const before = await workspace(db)
    const moved = await app.inject({
      method: 'POST',
      url: `/api/groups/${third.id}/move`,
      payload: { targetId: first.id, placement: 'before' },
    })
    assert.equal(moved.statusCode, 200)
    let state = await workspace(db)
    let groups = state.groups.filter((group) => group.boardId === board.id)
    assert.equal(groups[0].id, third.id)
    assert.deepEqual(
      groups.map((group) => group.position),
      [0, 1, 2],
    )
    for (const group of groups) {
      const original = before.groups.find((item) => item.id === group.id)!
      assert.deepEqual({ ...group, position: original.position }, original)
    }
    assert.deepEqual(state.tasks, before.tasks)
    const other = (
      await app.inject({ method: 'POST', url: '/api/boards', payload: { name: 'Outro quadro' } })
    ).json()
    const foreign = (await workspace(db)).groups.find((group) => group.boardId === other.id)!
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/groups/${third.id}/move`,
          payload: { targetId: foreign.id, placement: 'after' },
        })
      ).statusCode,
      400,
    )
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/groups/missing/move`,
          payload: { targetId: first.id, placement: 'after' },
        })
      ).statusCode,
      404,
    )
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/groups/${third.id}/move`,
          payload: { targetId: first.id, placement: 'sideways' },
        })
      ).statusCode,
      400,
    )
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/groups/${third.id}/move`,
          payload: { targetId: first.id, placement: 'after', position: -1 },
        })
      ).statusCode,
      400,
    )
    assert.deepEqual(
      (await workspace(db)).groups.filter((group) => group.boardId === board.id),
      groups,
    )
    await assert.rejects(
      db.transaction(async (tx) => {
        await moveGroup(tx, first.id, third.id, 'before')
        throw new Error('rollback')
      }),
      /rollback/,
    )
    assert.deepEqual(
      (await workspace(db)).groups.filter((group) => group.boardId === board.id),
      groups,
    )
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/groups/${first.id}/move`,
          payload: { targetId: first.id, placement: 'after' },
        })
      ).statusCode,
      200,
    )
    const concurrent = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/groups/${first.id}/move`,
        payload: { targetId: third.id, placement: 'before' },
      }),
      app.inject({
        method: 'POST',
        url: `/api/boards/${board.id}/groups`,
        payload: { name: 'Novo grupo' },
      }),
    ])
    assert.deepEqual(
      concurrent.map((response) => response.statusCode),
      [200, 201],
    )
    state = await workspace(db)
    groups = state.groups.filter((group) => group.boardId === board.id)
    assert.equal(new Set(groups.map((group) => group.position)).size, 4)
    assert.deepEqual(state.tasks, before.tasks)
  } finally {
    await app.close()
    await db.close()
  }
})
