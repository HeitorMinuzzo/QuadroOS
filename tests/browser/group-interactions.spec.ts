import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Group, Workspace } from '../../shared/domain'

test('group names edit on click and collapsed groups drag immediately, queue, roll back and persist with keyboard and touch', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Organização dos grupos' } })
  ).json()
  const state: Workspace = await (await page.request.get('/api/workspace')).json()
  const [a, b] = state.groups.filter((group) => group.boardId === board.id)
  const c: Group = await (
    await page.request.post(`/api/boards/${board.id}/groups`, {
      data: { name: 'Entregas', color: '#0073ea' },
    })
  ).json()
  await page.request.patch(`/api/groups/${a.id}`, { data: { name: 'Planejamento' } })
  await page.request.patch(`/api/groups/${b.id}`, { data: { name: 'Execução' } })
  await page.request.post('/api/tasks', {
    data: { boardId: board.id, groupId: a.id, title: 'Tarefa do planejamento' },
  })
  await page.goto(`/#/board/${board.id}/table`)
  const section = (id: string) => page.locator(`[data-group-id="${id}"]`)
  const order = () =>
    page
      .locator('.table-view > .task-group')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-group-id')))
  const savedOrder = async () =>
    ((await (await page.request.get('/api/workspace')).json()) as Workspace).groups
      .filter((group) => group.boardId === board.id)
      .map((group) => group.id)
  const collapseAll = async () => {
    for (const id of [a.id, b.id, c.id]) {
      const toggle = section(id).getByRole('button', { name: /^Recolher grupo / })
      if (await toggle.count()) await toggle.click()
    }
  }
  await section(a.id)
    .getByRole('button', { name: 'Editar nome do grupo Planejamento', exact: true })
    .click()
  let editor = section(a.id).getByRole('textbox', {
    name: 'Nome do grupo Planejamento',
    exact: true,
  })
  await expect(editor).toBeFocused()
  await expect(
    section(a.id).getByRole('button', { name: 'Recolher grupo Planejamento', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  await editor.fill('Nome cancelado')
  await editor.press('Escape')
  await expect(
    section(a.id).getByRole('button', { name: 'Editar nome do grupo Planejamento', exact: true }),
  ).toBeFocused()
  await section(a.id)
    .getByRole('button', { name: 'Editar nome do grupo Planejamento', exact: true })
    .click()
  editor = section(a.id).getByRole('textbox', { name: 'Nome do grupo Planejamento', exact: true })
  await editor.fill('  ')
  await editor.press('Enter')
  await expect(section(a.id).getByRole('alert')).toContainText('Informe o nome do grupo.')
  await editor.fill('Planejamento da equipe')
  await editor.press('Enter')
  await expect(
    section(a.id).getByRole('button', {
      name: 'Editar nome do grupo Planejamento da equipe',
      exact: true,
    }),
  ).toBeFocused()
  await expect(section(a.id).getByRole('button', { name: /^Mover grupo / })).toHaveCount(0)
  await collapseAll()
  // Failed renames preserve the draft for retry, and click editing does not expand the group.
  await page.route(`**/api/groups/${b.id}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, json: { message: 'Falha simulada no nome.' } })
      : route.continue(),
  )
  await section(b.id)
    .getByRole('button', { name: 'Editar nome do grupo Execução', exact: true })
    .click()
  editor = section(b.id).getByRole('textbox', { name: 'Nome do grupo Execução', exact: true })
  await editor.fill('Em execução')
  await editor.press('Enter')
  await expect(section(b.id).getByRole('alert')).toContainText('Falha simulada no nome.')
  await expect(editor).toHaveValue('Em execução')
  await page.unroute(`**/api/groups/${b.id}`)
  await editor.focus()
  await page.getByRole('heading', { name: board.name, exact: true }).click()
  await expect(
    section(b.id).getByRole('button', { name: 'Editar nome do grupo Em execução', exact: true }),
  ).toBeVisible()
  await expect(
    section(b.id).getByRole('button', { name: 'Expandir grupo Em execução', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')

  for (const id of [a.id, b.id, c.id]) {
    expect(
      await section(id)
        .locator('.group-name-button')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
  }

  const drag = async (id: string, targetId: string) => {
    const source = (await section(id).locator('.group-name-button').boundingBox())!
    const target = (await section(targetId).boundingBox())!
    await page.mouse.move(source.x + Math.min(40, source.width / 2), source.y + source.height / 2)
    await page.mouse.down()
    // Start moving in the same interaction, with no hold delay.
    await page.mouse.move(source.x + 30, target.y + target.height / 2, { steps: 12 })
    await expect(section(id)).toHaveClass(/is-dragging/)
    await page.mouse.up()
    await expect(section(id).locator('input.group-name-input')).toHaveCount(0)
  }
  let releaseMove!: () => void
  const held = new Promise<void>((resolve) => {
    releaseMove = resolve
  })
  let moveRequests = 0
  await page.route('**/api/groups/*/move', async (route) => {
    if (++moveRequests === 1) await held
    await route.continue()
  })
  const original = (await section(c.id).boundingBox())!
  await drag(a.id, c.id)
  await expect.poll(order).toEqual([b.id, c.id, a.id])
  const frames = await section(a.id).evaluate(
    (element) =>
      new Promise<{ x: number; y: number }[]>((resolve) => {
        const samples: { x: number; y: number }[] = []
        const sample = () => {
          const rect = element.getBoundingClientRect()
          samples.push({ x: rect.x, y: rect.y })
          if (samples.length < 12) requestAnimationFrame(sample)
          else resolve(samples)
        }
        requestAnimationFrame(sample)
      }),
  )
  expect(frames.every((frame) => Math.abs(frame.x - original.x) < 1)).toBe(true)
  expect(frames.every((frame) => Math.abs(frame.y - original.y) < 2)).toBe(true)
  await drag(b.id, a.id)
  await expect.poll(order).toEqual([c.id, a.id, b.id])
  releaseMove()
  await expect.poll(savedOrder).toEqual([c.id, a.id, b.id])
  await page.unroute('**/api/groups/*/move')
  await page.reload()
  await expect.poll(order).toEqual([c.id, a.id, b.id])
  await expect(
    section(a.id).getByRole('button', {
      name: 'Editar nome do grupo Planejamento da equipe',
      exact: true,
    }),
  ).toBeVisible()
  await collapseAll()
  await page.route(`**/api/groups/${c.id}/move`, (route) =>
    route.fulfill({ status: 409, json: { message: 'Falha simulada ao mover o grupo.' } }),
  )
  await drag(c.id, b.id)
  await expect.poll(order).toEqual([c.id, a.id, b.id])
  await expect.poll(savedOrder).toEqual([c.id, a.id, b.id])
  await page.unroute(`**/api/groups/${c.id}/move`)
  const handle = section(a.id).getByRole('button', {
    name: 'Mover grupo Planejamento da equipe',
    exact: true,
  })
  await handle.focus()
  const keyboardStart = (await section(a.id).boundingBox())!
  await page.keyboard.press('Space')
  await expect(section(a.id)).toHaveClass(/is-dragging/)
  await page.keyboard.press('ArrowUp')
  await expect
    .poll(async () => (await section(a.id).boundingBox())!.y)
    .toBeLessThan(keyboardStart.y - 20)
  await page.keyboard.press('Space')
  await expect.poll(order).toEqual([a.id, c.id, b.id])
  await expect.poll(savedOrder).toEqual([a.id, c.id, b.id])
  await expect(handle).toBeFocused()
  await page.keyboard.press('Space')
  await expect(section(a.id)).toHaveClass(/is-dragging/)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect.poll(savedOrder).toEqual([a.id, c.id, b.id])
  if (await page.getByRole('button', { name: 'Dispensar mensagem', exact: true }).count())
    await page.getByRole('button', { name: 'Dispensar mensagem', exact: true }).click()
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    scan.violations.map((item) => ({ id: item.id, message: item.nodes[0]?.failureSummary })),
  ).toEqual([])
  await page.getByRole('heading', { name: board.name, exact: true }).click()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: 'test-results/group-interactions.png', animations: 'disabled' })
  expect(errors).toEqual([])

  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  })
  try {
    const mobile = await mobileContext.newPage()
    await mobile.goto(`http://127.0.0.1:5174/#/board/${board.id}/table`)
    for (const id of [a.id, b.id, c.id])
      await mobile.locator(`[data-group-id="${id}"] .group-toggle`).tap()
    const source = (await mobile
      .getByRole('button', { name: 'Mover grupo Entregas', exact: true })
      .boundingBox())!
    const target = (await mobile.locator(`[data-group-id="${b.id}"]`).boundingBox())!
    const session = await mobileContext.newCDPSession(mobile)
    const x = source.x + source.width / 2,
      y = source.y + source.height / 2
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await mobile.waitForTimeout(300) // Touch activation preserves scrolling for an ordinary swipe.
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: target.y + target.height / 2 }],
    })
    await expect(mobile.locator(`[data-group-id="${c.id}"]`)).toHaveClass(/is-dragging/)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(savedOrder).toEqual([a.id, b.id, c.id])
    await mobile.getByRole('button', { name: 'Editar nome do grupo Entregas', exact: true }).tap()
    await mobile
      .getByRole('textbox', { name: 'Nome do grupo Entregas', exact: true })
      .fill('Entregas finais')
    await mobile
      .getByRole('textbox', { name: 'Nome do grupo Entregas', exact: true })
      .press('Enter')
    await expect(
      mobile.getByRole('button', { name: 'Editar nome do grupo Entregas finais', exact: true }),
    ).toBeVisible()
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await mobile.getByRole('heading', { name: board.name, exact: true }).tap()
    await mobile.screenshot({
      path: 'test-results/group-interactions-mobile.png',
      animations: 'disabled',
    })
  } finally {
    await mobileContext.close()
  }
})
