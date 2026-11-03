import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { guessImportMapping } from '../../shared/imports'

test('comment bubble opens Monday-style updates, groups replies, likes persist, files and details remain accessible on mobile', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const preview = await (
    await page.request.post('/api/monday/preview', {
      data: { token: 'synthetic-token', boardId: '900' },
    })
  ).json()
  const imported = await (
    await page.request.post('/api/imports/apply', {
      data: {
        preview: { sessionId: preview.sessionId },
        mapping: guessImportMapping(preview),
        boardName: 'Atualizações da equipe',
      },
    })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json(),
    task = state.tasks.find(
      (task: { boardId: string; externalId: string }) =>
        task.boardId === imported.boardId && task.externalId === '101',
    )
  const update = await (
    await page.request.post(`/api/tasks/${task.id}/comments`, {
      data: { body: 'Adicionei os orçamentos. Podemos seguir com a revisão.' },
    })
  ).json()
  await page.request.post(`/api/tasks/${task.id}/comments`, {
    data: { body: 'Recebido, vou conferir os valores.', parentId: update.id },
  })
  await page.goto(`/#/board/${imported.boardId}/table`)
  const bubble = page.getByRole('button', { name: 'Abrir atualizações de Entrega 1', exact: true })
  await expect(bubble.locator('.task-comments-count')).toHaveText('3')
  await bubble.click()
  const drawer = page.locator('dialog.task-panel'),
    updates = drawer.getByRole('tab', { name: /Atualizações/ })
  await expect(updates).toHaveAttribute('data-state', 'active')
  await expect(drawer.getByRole('heading', { name: 'Entrega 1', exact: true })).toBeVisible()
  await expect(drawer.getByLabel('Status da tarefa', { exact: true })).toHaveCount(0)
  await expect(drawer.locator('.update-card')).toHaveCount(3)
  const card = drawer.locator('.update-card').filter({ hasText: 'Adicionei os orçamentos.' })
  await expect(card.getByText('Recebido, vou conferir os valores.', { exact: true })).toBeVisible()
  expect((await drawer.locator('.update-composer').first().boundingBox())!.y).toBeLessThan(
    (await card.boundingBox())!.y,
  )
  await card.getByRole('button', { name: 'Curtir', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Curtido', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(card.getByText('1 curtida', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Responder', exact: true }).click()
  const reply = card.getByRole('textbox', { name: 'Escrever resposta', exact: true })
  await expect(reply).toBeFocused()
  await reply.fill('Valores conferidos. Pode continuar.')
  await card.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(card.getByText('Valores conferidos. Pode continuar.', { exact: true })).toBeVisible()
  await expect(card.getByText('2 respostas', { exact: true })).toBeVisible()
  const body = drawer
    .locator('.update-card-body .imported-comment-body')
    .filter({ hasText: 'Conversa original' })
  await expect(body.locator('p')).toHaveCount(2)
  expect(
    await body
      .locator('p')
      .first()
      .evaluate((node) => getComputedStyle(node).borderTopWidth),
  ).toBe('0px')
  await expect(body.locator('script,iframe,img,[onclick]')).toHaveCount(0)
  await drawer.getByRole('tab', { name: /Arquivos/ }).click()
  await expect(
    drawer.getByRole('region', { name: 'Arquivos do item' }).getByRole('link'),
  ).toHaveCount(3)
  await drawer.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  await expect(drawer.getByLabel('Status da tarefa', { exact: true })).toContainText('Concluído')
  await updates.click()
  await drawer
    .getByLabel('Novo comentário', { exact: true })
    .fill('Texto mantido quando a conexão falha.')
  await page.route('**/api/tasks/*/comments', (route) =>
    route.fulfill({ status: 500, json: { message: 'Falha simulada' } }),
  )
  await drawer
    .locator('.task-updates > .update-composer')
    .getByRole('button', { name: 'Enviar', exact: true })
    .click()
  await expect(drawer.getByRole('alert')).toContainText('Seu texto foi mantido')
  await expect(drawer.getByLabel('Novo comentário', { exact: true })).toHaveValue(
    'Texto mantido quando a conexão falha.',
  )
  await page.unroute('**/api/tasks/*/comments')
  await drawer
    .locator('.task-updates > .update-composer')
    .getByRole('button', { name: 'Enviar', exact: true })
    .click()
  await expect(
    drawer.getByText('Texto mantido quando a conexão falha.', { exact: true }),
  ).toBeVisible()
  await expect(drawer.locator('.update-card')).toHaveCount(4)
  await drawer.locator('.task-updates > .update-composer textarea').focus()
  await page.screenshot({
    path: test.info().outputPath('atualizacoes-desktop.png'),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(bubble.locator('.task-comments-count')).toHaveText('4')
  await page.reload()
  await bubble.click()
  await expect(card.getByRole('button', { name: 'Curtido', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await drawer.boundingBox())!.width).toBe(375)
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    scan.violations.map((entry) => ({ id: entry.id, first: entry.nodes[0]?.failureSummary })),
  ).toEqual([])
  await page.screenshot({
    path: test.info().outputPath('atualizacoes-celular.png'),
    animations: 'disabled',
  })
  await drawer.getByRole('tab', { name: /Atualizações/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(drawer.getByRole('tab', { name: /Arquivos/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  expect(errors).toEqual([])
})
