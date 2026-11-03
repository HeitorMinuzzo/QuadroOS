import { test, expect } from '@playwright/test'
import type { Group, Workspace } from '../../shared/domain'

test('collapsed groups keep their size and pointer offset over expanded groups; expanded names stay readable', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1100 })
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Grupos de tamanhos diferentes' } })
  ).json()
  const state: Workspace = await (await page.request.get('/api/workspace')).json()
  const [a, b] = state.groups.filter((group) => group.boardId === board.id)
  const c: Group = await (
    await page.request.post(`/api/boards/${board.id}/groups`, { data: { name: 'Mais tarde' } })
  ).json()
  const longName = 'Próximas entregas e acompanhamento das atividades de infraestrutura da equipe'
  await page.request.patch(`/api/groups/${a.id}`, { data: { name: 'Este mês' } })
  await page.request.patch(`/api/groups/${b.id}`, { data: { name: longName } })
  for (let index = 0; index < 8; index++)
    await page.request.post('/api/tasks', {
      data: { boardId: board.id, groupId: b.id, title: `Entrega ${index + 1}` },
    })
  await page.goto(`/#/board/${board.id}/table`)
  const group = (id: string) => page.locator(`[data-group-id="${id}"]`)
  const readable = async (id: string) => {
    const button = group(id).locator('.group-name-button')
    expect(
      await button.evaluate((node) => ({
        clippedX: node.scrollWidth > node.clientWidth + 1,
        clippedY: node.scrollHeight > node.clientHeight + 1,
      })),
    ).toEqual({ clippedX: false, clippedY: false })
  }
  const singleLine = async (id: string) => {
    expect(
      await group(id)
        .locator('.group-name-button')
        .evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          return range.getClientRects().length
        }),
    ).toBe(1)
  }
  // The short title used to shrink to "Este m…" even on a wide screen.
  await readable(a.id)
  await singleLine(a.id)
  await readable(b.id)
  await group(a.id).getByRole('button', { name: 'Recolher grupo Este mês', exact: true }).click()
  await group(c.id).getByRole('button', { name: 'Recolher grupo Mais tarde', exact: true }).click()
  const initial = (await group(a.id).boundingBox())!
  const expanded = (await group(b.id).boundingBox())!
  const source = (await group(a.id).locator('.group-name-button').boundingBox())!
  const x = source.x + 30,
    y = source.y + source.height / 2
  const targetY = expanded.y + expanded.height / 2
  expect(expanded.height).toBeGreaterThan(initial.height * 3)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, targetY, { steps: 16 })
  await expect(group(a.id)).toHaveClass(/is-dragging/)
  const hovering = (await group(a.id).boundingBox())!
  expect(Math.abs(hovering.height - initial.height)).toBeLessThan(1)
  expect(Math.abs(hovering.width - initial.width)).toBeLessThan(1)
  expect(Math.abs(hovering.x - initial.x)).toBeLessThan(1)
  expect(Math.abs(hovering.y - (initial.y + targetY - y))).toBeLessThan(2)
  expect(Math.abs((await group(b.id).boundingBox())!.height - expanded.height)).toBeLessThan(1)
  await expect(
    group(b.id).getByRole('button', { name: `Recolher grupo ${longName}`, exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  await page.screenshot({ path: 'test-results/group-mixed-drag-hover.png', animations: 'disabled' })
  await page.mouse.up()
  const order = () =>
    page
      .locator('.table-view > .task-group')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-group-id')))
  const savedOrder = async () =>
    ((await (await page.request.get('/api/workspace')).json()) as Workspace).groups
      .filter((group) => group.boardId === board.id)
      .map((group) => group.id)
  await expect.poll(order).toEqual([b.id, a.id, c.id])
  await expect.poll(savedOrder).toEqual([b.id, a.id, c.id])
  await readable(b.id)
  // Cross the tall group in the other direction and return to the original order.
  const second = (await group(a.id).locator('.group-name-button').boundingBox())!
  const destination = (await group(b.id).boundingBox())!
  await page.mouse.move(second.x + 30, second.y + second.height / 2)
  await page.mouse.down()
  await page.mouse.move(second.x + 30, destination.y + destination.height / 2, { steps: 16 })
  await expect(group(a.id)).toHaveClass(/is-dragging/)
  expect(Math.abs((await group(a.id).boundingBox())!.height - initial.height)).toBeLessThan(1)
  await page.mouse.up()
  await expect.poll(savedOrder).toEqual([a.id, b.id, c.id])
  await group(a.id).getByRole('button', { name: 'Expandir grupo Este mês', exact: true }).click()
  await readable(a.id)
  await expect(group(b.id).getByRole('textbox', { name: /^Título: Entrega / })).toHaveCount(8)
  await singleLine(a.id)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'test-results/group-expanded-names.png', animations: 'disabled' })
  await page.setViewportSize({ width: 375, height: 812 })
  await readable(a.id)
  await singleLine(a.id)
  await readable(b.id)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await group(a.id)
    .getByRole('button', { name: 'Editar nome do grupo Este mês', exact: true })
    .click()
  const input = group(a.id).getByRole('textbox', { name: 'Nome do grupo Este mês', exact: true })
  await expect(input).toBeFocused()
  await input.fill('Este trimestre')
  await input.press('Enter')
  await expect(
    group(a.id).getByRole('button', { name: 'Editar nome do grupo Este trimestre', exact: true }),
  ).toBeFocused()
  await page.getByRole('heading', { name: board.name, exact: true }).click()
  await singleLine(a.id)
  await page.screenshot({
    path: 'test-results/group-expanded-names-mobile.png',
    animations: 'disabled',
  })
  await page.reload()
  await expect.poll(order).toEqual([a.id, b.id, c.id])
  await expect(
    group(a.id).getByRole('heading', { name: 'Este trimestre', exact: true }),
  ).toBeVisible()
})
