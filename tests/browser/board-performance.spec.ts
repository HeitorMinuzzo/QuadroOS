import { test, expect } from '@playwright/test'
import type { Board, Task, Comment, Workspace } from '../../shared/domain'
// DOM snapshots from tracing distort timings on large tables; this scenario measures actual interaction.
test.use({ trace: 'off' })

test('large board stays responsive when searching, selecting and opening updates without changing saved data', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000)
  const base: Workspace = await (await page.request.get('/api/workspace')).json(),
    now = '2026-01-10T12:00:00.000Z'
  const board: Board = {
    ...base.boards[0],
    id: 'performance-board',
    name: 'Quadro de desempenho',
    favorite: false,
    settings: {},
    columns: [
      { id: 'notes', name: 'Notas', type: 'text' },
      { id: 'amount', name: 'Valor', type: 'number' },
      { id: 'files', name: 'Arquivos', type: 'files' },
      { id: 'period', name: 'Cronograma', type: 'timeline' },
      { id: 'updated', name: 'Última atualização', type: 'last_updated' },
      { id: 'timer', name: 'Horas', type: 'time_tracking' },
    ],
  }
  const group = {
    ...base.groups[0],
    id: 'performance-group',
    boardId: board.id,
    name: 'Demandas',
    position: 0,
  }
  const tasks: Task[] = Array.from({ length: 208 }, (_, index) => ({
    id: `performance-${index}`,
    boardId: board.id,
    groupId: group.id,
    parentId: null,
    previousGroupId: null,
    title: `Tarefa de teste ${String(index).padStart(3, '0')}`,
    description: 'Dados fictícios para medir o quadro.',
    status: 'Em andamento',
    priority: 'Média',
    ownerId: 'person-you',
    ownerIds: ['person-you'],
    dueDate: '2030-01-10',
    dueAt: null,
    createdAt: now,
    updatedAt: now,
    position: index,
    version: 1,
    source: null,
    externalId: null,
    customValues: {
      notes: 'Texto de teste',
      amount: '100',
      period: '{"from":"2030-01-01","to":"2030-01-10"}',
      timer: '{"duration":0,"startedAt":null,"sessions":[]}',
    },
  }))
  const comments: Comment[] = tasks.flatMap((task) => [
    {
      id: `comment-${task.id}`,
      taskId: task.id,
      authorId: 'person-you',
      body: 'Atualização de teste',
      createdAt: now,
      parentId: null,
    },
    {
      id: `reply-${task.id}`,
      taskId: task.id,
      authorId: 'person-you',
      body: 'Resposta de teste',
      createdAt: now,
      parentId: `comment-${task.id}`,
    },
  ])
  const fixture = {
    ...base,
    boards: [board],
    groups: [group],
    tasks,
    comments,
    attachments: [],
    imports: [],
  }
  await page.route('**/api/workspace', (route) => route.fulfill({ json: fixture }))
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
  const measurements: Record<string, number> = {}
  const measure = async (type: 'input' | 'click', action: () => Promise<unknown>) => {
    await page.evaluate((type) => {
      const target = window as typeof window & { __interactionMs: number | null }
      target.__interactionMs = null
      document.addEventListener(
        type,
        () => {
          const start = performance.now()
          const settled = () =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (document.querySelector('.table-view')?.getAttribute('aria-busy') === 'true')
                  settled()
                else target.__interactionMs = Math.round(performance.now() - start)
              }),
            )
          settled()
        },
        { once: true, capture: true },
      )
    }, type)
    await action()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { __interactionMs: number | null }).__interactionMs,
        ),
      )
      .not.toBeNull()
    return page.evaluate(
      () => (window as typeof window & { __interactionMs: number }).__interactionMs,
    )
  }
  const start = Date.now()
  await page.goto(`/#/board/${board.id}/table`)
  await expect(page.locator('tr[data-task-id]')).toHaveCount(208)
  await frames()
  measurements.loadMs = Date.now() - start
  measurements.searchMs = await measure('input', () => page.locator('#board-search').fill('Tarefa'))
  await expect(page.locator('.table-view')).toHaveAttribute('aria-busy', 'false')
  await frames()
  expect(measurements.searchMs).toBeLessThan(1500)
  measurements.selectionMs = await measure('click', () =>
    page.getByRole('checkbox', { name: `Selecionar ${tasks[0].title}`, exact: true }).check(),
  )
  await expect(page.getByText('1 selecionada', { exact: true })).toBeVisible()
  await frames()
  expect(measurements.selectionMs).toBeLessThan(1500)
  const bubble = page.getByRole('button', {
    name: `Abrir atualizações de ${tasks[0].title}`,
    exact: true,
  })
  await expect(bubble.locator('.task-comments-count')).toHaveText('1')
  measurements.openUpdatesMs = await measure('click', () => bubble.click())
  await expect(page.getByRole('region', { name: 'Atualizações do item' })).toBeVisible()
  await frames()
  expect(measurements.openUpdatesMs).toBeLessThan(2000)
  measurements.closeUpdatesMs = await measure('click', () =>
    page.getByRole('button', { name: 'Fechar janela', exact: true }).click(),
  )
  await frames()
  expect(measurements.closeUpdatesMs).toBeLessThan(1500)
  await expect(page.locator('tr[data-task-id]')).toHaveCount(208)
  await page.getByLabel('Buscar neste quadro').fill('teste 207')
  await expect(page.locator('tr[data-task-id]')).toHaveCount(1)
  await expect(page.getByLabel(`Título: ${tasks[207].title}`, { exact: true })).toBeVisible()
  await testInfo.attach('board-performance.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  })
  console.info('[board-performance]', JSON.stringify(measurements))
})

test('status menus load on demand and preserve closed-menu typeahead, arrow keys and focus', async ({
  page,
}) => {
  const board = await (
      await page.request.post('/api/boards', { data: { name: 'Seletores por teclado' } })
    ).json(),
    state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find((group: { boardId: string }) => group.boardId === board.id)
  await page.request.post('/api/tasks', {
    data: { boardId: board.id, groupId: group.id, title: 'Conferir atalhos' },
  })
  await page.goto(`/#/board/${board.id}/table`)
  const status = page.getByRole('combobox', { name: 'Status: Conferir atalhos', exact: true })
  await status.focus()
  await status.press('p')
  await expect(status).toContainText('Parado')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await status.press('ArrowDown')
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: 'Parado', exact: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('option', { name: 'Editar etiquetas', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('option', { name: 'Contínuo', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(status).toContainText('Contínuo')
  await expect(status).toBeFocused()
})
