import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Board, CustomColumn, Task, Workspace } from '../../shared/domain'

test('collapsed groups show aligned live summaries, nested counts, dates, totals and files with keyboard and mobile support', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1920, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const board: Board = await (
    await page.request.post('/api/boards', { data: { name: 'Visão geral dos grupos' } })
  ).json()
  const state: Workspace = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find((group) => group.boardId === board.id && !group.isCompleted)!
  const empty = state.groups.find((group) => group.boardId === board.id && group.isCompleted)!
  async function column(data: Partial<CustomColumn>) {
    const response = await page.request.post(`/api/boards/${board.id}/columns`, { data })
    expect(response.ok()).toBe(true)
    return (await response.json()) as CustomColumn
  }
  const amount = await column({ name: 'Orçamento', type: 'number' })
  const files = await column({ name: 'Arquivos', type: 'files' })
  const approval = await column({
    name: 'Aprovação',
    type: 'status',
    options: [{ id: 'ok', label: 'Aprovado', color: '#00854d' }],
  })
  const formula = await column({
    name: 'Projeção',
    type: 'formula',
    formula: `{#${amount.id}} * 2`,
  })
  async function add(changes: Partial<Task>) {
    const response = await page.request.post('/api/tasks', {
      data: { boardId: board.id, groupId: group.id, title: 'Entrega', ...changes },
    })
    expect(response.ok()).toBe(true)
    return (await response.json()) as Task
  }
  const first = await add({
    title: 'Primeira entrega',
    status: 'Em andamento',
    priority: 'Alta',
    dueDate: '2030-01-05',
    ownerIds: ['person-you'],
    customValues: { [amount.id]: '1250.5', [approval.id]: 'Aprovado' },
  })
  await add({
    title: 'Segunda entrega',
    status: 'Feito',
    priority: 'Baixa',
    dueDate: '2030-02-10',
    customValues: { [amount.id]: '249.5' },
  })
  await add({ title: 'Terceira entrega', status: 'Parado', priority: 'Alta' })
  const child = await add({
    title: 'Planejamento',
    parentId: first.id,
    customValues: { [amount.id]: '90000' },
  })
  await add({ title: 'Etapa interna', parentId: child.id })
  await add({ title: 'Revisão', parentId: first.id })
  for (const task of [first, first, child]) {
    const response = await page.request.post(`/api/tasks/${task.id}/files/${files.id}`, {
      multipart: {
        file: {
          name: 'exemplo.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Documento fictício'),
        },
      },
    })
    expect(response.ok()).toBe(true)
  }
  const order = [
    'status',
    'date',
    'priority',
    'owner',
    amount.id,
    files.id,
    approval.id,
    formula.id,
  ]
  expect(
    (
      await page.request.patch(`/api/boards/${board.id}/column-order`, {
        data: { scope: 'tasks', keys: order },
      })
    ).ok(),
  ).toBe(true)
  await page.goto(`/#/board/${board.id}/table`)
  const section = page.locator(`[data-group-id="${group.id}"]`)
  // Resize through the real keyboard interaction before collapsing.
  await section
    .getByRole('separator', { name: 'Redimensionar coluna Status', exact: true })
    .press('ArrowRight')
  await expect(
    section.getByRole('separator', { name: 'Redimensionar coluna Status', exact: true }),
  ).toHaveAttribute('aria-valuenow', '155')
  const expanded = await section
    .locator(':scope > .group-table-wrap > table > thead [data-column-key]')
    .evaluateAll((cells) =>
      cells.map((cell) => ({
        key: cell.getAttribute('data-column-key'),
        x: cell.getBoundingClientRect().x,
        width: cell.getBoundingClientRect().width,
      })),
    )
  await section.getByRole('button', { name: `Recolher grupo ${group.name}`, exact: true }).click()
  const overview = section.locator('.group-overview-table')
  await expect(section.locator('.group-count')).toHaveText('3 Tarefas / 3 Subitens')
  await expect(section.locator('[data-task-id]')).toHaveCount(0)
  const cell = (key: string) => overview.locator(`[data-column-key="${key}"]`)
  const collapsed = await overview.locator('[data-column-key]').evaluateAll((cells) =>
    cells.map((cell) => ({
      key: cell.getAttribute('data-column-key'),
      x: cell.getBoundingClientRect().x,
      width: cell.getBoundingClientRect().width,
    })),
  )
  expect(collapsed.map((cell) => cell.key)).toEqual(order)
  for (let index = 0; index < expanded.length; index++) {
    expect(Math.abs(collapsed[index].x - expanded[index].x)).toBeLessThan(1)
    expect(Math.abs(collapsed[index].width - expanded[index].width)).toBeLessThan(1)
  }
  await expect(
    cell('status').getByRole('button', { name: 'Feito: 1 item (33%)', exact: true }),
  ).toBeVisible()
  await expect(cell(amount.id).locator('.group-summary-total > span')).toHaveText('1.500')
  await expect(cell(formula.id).locator('.group-summary-total > span')).toHaveText('3.000')
  await expect(cell(files.id).locator('.group-summary-total')).toHaveText('2Arquivos')
  await expect(cell('date').locator('.group-summary-date')).toHaveAttribute(
    'aria-label',
    /2 tarefas com datas: 5 de janeiro de 2030 a 10 de fevereiro de 2030/,
  )
  await expect(
    cell(approval.id).getByRole('button', { name: 'Sem etiqueta: 2 itens (67%)', exact: true }),
  ).toBeVisible()
  const segment = cell('status').getByRole('button', { name: 'Feito: 1 item (33%)', exact: true })
  await segment.hover()
  await expect(
    page.locator('.summary-tooltip:not([data-state="closed"]) .summary-tooltip-label > strong'),
  ).toHaveText('Feito')
  await page.mouse.move(0, 0)
  const emptySection = page.locator(`[data-group-id="${empty.id}"]`)
  await emptySection
    .getByRole('button', { name: `Recolher grupo ${empty.name}`, exact: true })
    .click()
  await expect(emptySection.locator('.group-count')).toHaveText('0 Tarefas / 0 Subitens')
  await expect(emptySection.locator('.group-summary-date')).toHaveCount(0)
  await expect(emptySection.locator('.monday-summary-segment')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/collapsed-groups.png', animations: 'disabled' })

  // Searching updates the same collapsed overview, without counting subitems as root values.
  await page
    .getByRole('textbox', { name: 'Buscar neste quadro', exact: true })
    .fill('Primeira entrega')
  await expect(section.locator('.group-count')).toHaveText('1 Tarefa / 3 Subitens')
  await expect(cell(amount.id).locator('.group-summary-total > span')).toHaveText('1.250,5')
  await expect(
    cell('status').getByRole('button', { name: 'Em andamento: 1 item (100%)', exact: true }),
  ).toBeVisible()
  await page.getByRole('textbox', { name: 'Buscar neste quadro', exact: true }).fill('')
  await expect(section.locator('.group-count')).toHaveText('3 Tarefas / 3 Subitens')
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    scan.violations.map((item) => ({ id: item.id, first: item.nodes[0]?.failureSummary })),
  ).toEqual([])

  // The existing group menu still opens while collapsed.
  await section.getByRole('button', { name: `Opções do grupo ${group.name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Editar grupo', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Editar grupo', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  const toggle = section.getByRole('button', { name: `Expandir grupo ${group.name}`, exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(
    section.getByRole('button', { name: `Recolher grupo ${group.name}`, exact: true }),
  ).toBeFocused()
  await expect(section.getByLabel('Status: Primeira entrega', { exact: true })).toBeVisible()
  await section.getByLabel('Status: Primeira entrega', { exact: true }).click()
  await page.getByRole('option', { name: 'Feito', exact: true }).click()
  await section.getByRole('button', { name: `Recolher grupo ${group.name}`, exact: true }).click()
  await expect(
    cell('status').getByRole('button', { name: 'Feito: 2 itens (67%)', exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(cell('status')).toBeVisible()
  await expect(cell('priority')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const mobileBounds = (await overview.boundingBox())!
  expect(mobileBounds.x + mobileBounds.width).toBeLessThanOrEqual(375)
  const mobileStatus = (await cell('status').boundingBox())!
  await page.screenshot({
    path: 'test-results/collapsed-groups-mobile.png',
    animations: 'disabled',
  })
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(
    section.getByRole('button', { name: `Recolher grupo ${group.name}`, exact: true }),
  ).toBeFocused()
  await expect(section.getByLabel('Título: Primeira entrega', { exact: true })).toBeVisible()
  const mobileHeader = (await section
    .locator(':scope > .group-table-wrap > table > thead .status-cell')
    .boundingBox())!
  expect(Math.abs(mobileStatus.x - mobileHeader.x)).toBeLessThan(1)
  expect(Math.abs(mobileStatus.width - mobileHeader.width)).toBeLessThan(1)
  expect(errors).toEqual([])
})
