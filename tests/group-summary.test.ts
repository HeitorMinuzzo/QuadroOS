import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Task } from '../shared/domain.ts'
import { groupDateRange, summaryNumber, taskDescendantCounts } from '../shared/group-summary.ts'

function task(id: string, parentId: string | null = null, changes: Partial<Task> = {}): Task {
  return {
    id,
    parentId,
    boardId: 'board',
    groupId: 'group',
    title: id,
    description: '',
    status: 'Não iniciado',
    priority: 'Média',
    ownerId: null,
    ownerIds: [],
    dueDate: null,
    position: 0,
    version: 1,
    createdAt: '',
    updatedAt: '',
    source: null,
    externalId: null,
    previousGroupId: null,
    customValues: {},
    ...changes,
  }
}

test('collapsed group counts include nested descendants without crossing boards or cycling', () => {
  const counts = taskDescendantCounts([
    task('root'),
    task('child', 'root'),
    task('nested', 'child'),
    task('sibling', 'root'),
    task('other'),
    task('orphan', 'missing'),
    task('foreign', 'root', { boardId: 'elsewhere' }),
    task('cycle-a', 'cycle-b'),
    task('cycle-b', 'cycle-a'),
  ])
  assert.equal(counts.get('root'), 3)
  assert.equal(counts.get('child'), 1)
  assert.equal(counts.get('other'), undefined)
  assert.equal(counts.get('cycle-a'), 1)
})

test('date ranges handle missing dates, local instants and timeline endpoints; numeric blanks stay absent', () => {
  const tasks = [
    task('one', null, {
      dueDate: '2030-02-10',
      customValues: { period: '{"from":"2030-01-01","to":"2030-02-15"}' },
    }),
    task('two', null, { dueDate: '2030-01-05', customValues: { period: '{"to":"2030-03-01"}' } }),
    task('none'),
    task('invalid', null, { dueDate: '2030-02-30' }),
  ]
  assert.deepEqual(groupDateRange(tasks, 'date'), {
    from: '2030-01-05',
    to: '2030-02-10',
    count: 2,
  })
  assert.deepEqual(groupDateRange(tasks, 'period', true), {
    from: '2030-01-01',
    to: '2030-03-01',
    count: 2,
  })
  const instant = '2030-01-01T00:30:00Z'
  const date = new Date(instant)
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  assert.equal(
    groupDateRange([task('instant', null, { dueDate: '2030-01-01', dueAt: instant })], 'date')
      ?.from,
    local,
  )
  assert.equal(groupDateRange([], 'date'), null)
  assert.equal(summaryNumber(''), null)
  assert.equal(summaryNumber('n/a'), null)
  assert.equal(summaryNumber('Infinity'), null)
  assert.equal(summaryNumber('0'), 0)
  assert.equal(summaryNumber(' -10,25 '), -10.25)
})
