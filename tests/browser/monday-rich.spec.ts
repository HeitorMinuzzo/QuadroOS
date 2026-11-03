import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function importComplete(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  await page.getByRole('tab', { name: 'monday.com' }).click()
  await page.getByLabel('Token de acesso').fill('synthetic-token')
  await page.getByRole('button', { name: 'Buscar meus quadros' }).click()
  await page.getByRole('button', { name: 'Preparar importação' }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar dados' })
  await expect(dialog.locator('.import-resource-counts')).toContainText('2 subitens')
  await expect(dialog.locator('.import-resource-counts')).toContainText('3 comentários')
  await expect(dialog.getByText('Cobertura da importação', { exact: true })).toBeVisible()
  await expect(
    dialog.getByText('Pasta no Monday: TI / Infraestrutura', { exact: true }),
  ).toBeVisible()
  const appliedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/imports/apply') && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Importar 2 tarefas', exact: true }).click()
  const applied = await (await appliedResponse).json()
  await expect(
    dialog.getByRole('link', { name: 'Baixar relatório e dados originais' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Abrir meu quadro' }).click()
  return applied.boardId as string
}

test('complete import supports nested subitems, safe formatted conversations, local attachments and source rules', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const boardId = await importComplete(page)
  const folders = page.getByRole('navigation', { name: 'Pastas importadas do Monday' })
  const importedBoard = folders.getByRole('button', {
    name: 'Quadro completo de teste',
    exact: true,
  })
  await expect(importedBoard).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: 'Quadros', exact: true })
      .getByRole('button', { name: 'Quadro completo de teste' }),
  ).toHaveCount(0)
  await folders.getByRole('button', { name: 'Infraestrutura', exact: true }).click()
  await expect(importedBoard).toBeHidden()
  await folders.getByRole('button', { name: 'Infraestrutura', exact: true }).click()
  await expect(importedBoard).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Status: Entrega 1', exact: true }),
  ).toContainText('Concluído')
  await page.getByRole('button', { name: 'Expandir subitens de Entrega 1', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Status: Subitem importado', exact: true }),
  ).toContainText('Planejado')
  await page
    .getByRole('button', { name: 'Expandir subitens de Subitem importado', exact: true })
    .click()
  await expect(page.getByLabel('Título: Subitem de segundo nível', { exact: true })).toBeVisible()
  await page
    .getByRole('checkbox', { name: 'Verificado: Subitem de segundo nível', exact: true })
    .check()
  await page.getByLabel('Buscar neste quadro').fill('segundo nível')
  await expect(page.getByLabel('Título: Entrega 1', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Título: Subitem de segundo nível', { exact: true })).toBeVisible()
  await page.getByLabel('Buscar neste quadro').fill('')
  await page.getByRole('button', { name: 'Abrir atualizações de Entrega 1', exact: true }).click()
  const drawer = page.locator('dialog.drawer-modal')
  await expect(drawer.getByText('Conversa original', { exact: false })).toBeVisible()
  await expect(drawer.getByText('Resposta original', { exact: true })).toBeVisible()
  await expect(drawer.getByText('Comentário da segunda página', { exact: true })).toBeVisible()
  await expect(drawer.locator('.comment-attachments img')).toBeVisible()
  await expect
    .poll(() =>
      drawer
        .locator('.comment-attachments img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(
    drawer.locator(
      '.imported-comment-body script,.imported-comment-body iframe,.imported-comment-body img',
    ),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__quadroUnsafe),
  ).toBeUndefined()
  await drawer.getByRole('button', { name: 'Responder', exact: true }).first().click()
  await drawer.getByLabel('Escrever resposta').fill('Resposta criada no QuadroOS')
  await drawer
    .locator('.update-reply-editor')
    .getByRole('button', { name: 'Enviar', exact: true })
    .click()
  await expect(drawer.getByText('Resposta criada no QuadroOS', { exact: true })).toBeVisible()
  await drawer.screenshot({
    path: test.info().outputPath('monday-conversas.png'),
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  const status = page.getByRole('combobox', { name: 'Status: Entrega 1', exact: true })
  await status.click()
  await page.getByRole('option', { name: 'Em progresso', exact: true }).click()
  await status.click()
  await page.getByRole('option', { name: 'Concluído', exact: true }).click()
  const state = await (await page.request.get('/api/workspace')).json()
  const tasks = state.tasks.filter((task: { boardId: string }) => task.boardId === boardId)
  await expect
    .poll(async () => {
      const current = await (await page.request.get('/api/workspace')).json()
      return new Set(
        current.tasks
          .filter((task: { boardId: string }) => task.boardId === boardId)
          .map((task: { groupId: string }) => task.groupId),
      ).size
    })
    .toBe(1)
  expect(tasks).toHaveLength(4)
  await expect(status).toContainText('Concluído')
  const parentPanel = page.getByRole('region', { name: 'Subitens de Entrega 1', exact: true })
  const add = parentPanel.getByLabel('Nome do novo subitem', { exact: true }).last()
  await add.fill('Novo subitem local')
  await add.press('Enter')
  await expect(parentPanel.getByLabel('Título: Novo subitem local', { exact: true })).toBeVisible()
  const freshState = await (await page.request.get('/api/workspace')).json()
  const created = freshState.tasks.find(
    (task: { title: string; boardId: string }) =>
      task.boardId === boardId && task.title === 'Novo subitem local',
  )
  expect(created.status).toBe('')
  expect(created.priority).toBe('')
  await page.screenshot({
    path: test.info().outputPath('monday-completo.png'),
    fullPage: true,
    animations: 'disabled',
  })
  expect(errors).toEqual([])
})

test('imported calendar, period, checkbox, UTC deadline, rich text and timer remain editable after reload and on mobile', async ({
  page,
}) => {
  const boardId = await importComplete(page)
  const due = page.getByRole('button', { name: 'Prazo: Entrega 1', exact: true })
  await expect(due).toContainText('12:00')
  await due.click()
  const date = page.locator('.date-picker-popover')
  await expect(date.getByRole('checkbox', { name: 'Incluir horário', exact: true })).toBeChecked()
  await date.getByLabel('Horário', { exact: true }).fill('13:45')
  await date.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(date).not.toBeVisible()
  await expect(due).toContainText('13:45')
  const period = page.getByRole('button', { name: 'Cronograma: Entrega 1', exact: true })
  await period.click()
  const popover = page.getByRole('dialog', { name: 'Editar Cronograma', exact: true })
  await popover.getByRole('button', { name: 'Fim de Cronograma', exact: true }).click()
  await page.getByLabel('Data', { exact: true }).fill('2025-01-12')
  await page
    .locator('.date-picker-popover')
    .getByRole('button', { name: 'Aplicar', exact: true })
    .click()
  await popover.getByRole('button', { name: 'Salvar período', exact: true }).click()
  await expect(period).toContainText('12')
  const checked = page.getByRole('checkbox', { name: 'Conferido: Entrega 1', exact: true })
  await checked.uncheck()
  await page.getByRole('button', { name: 'Iniciar Horas: Entrega 1', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Pausar Horas: Entrega 1', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Pausar Horas: Entrega 1', exact: true }).click()
  await page.getByRole('button', { name: 'Histórico de Horas: Entrega 1', exact: true }).click()
  const timer = page.getByRole('dialog', { name: 'Histórico de Horas', exact: true })
  await timer.getByLabel('Adicionar horas manualmente').fill('0.5')
  await timer.getByRole('button', { name: 'Adicionar horas', exact: true }).click()
  await expect(timer.locator('.rich-timer-total')).toContainText('32m')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Contexto: Entrega 1', exact: true }).click()
  const text = page.getByRole('dialog', { name: 'Editar Contexto: Entrega 1', exact: true })
  await text
    .getByRole('textbox', { name: 'Contexto: Entrega 1', exact: true })
    .fill('Linha um\nLinha dois preservada')
  await text.getByRole('button', { name: 'Salvar texto', exact: true }).click()
  await page.reload()
  await expect(
    page.getByRole('checkbox', { name: 'Conferido: Entrega 1', exact: true }),
  ).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Prazo: Entrega 1', exact: true })).toContainText(
    '13:45',
  )
  await page.getByRole('tab', { name: 'Calendário', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Calendário do quadro' })).toBeVisible()
  await expect(
    page.locator('.board-calendar-grid').getByRole('button', { name: 'Entrega 1', exact: true }),
  ).toBeVisible()
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    scan.violations.map((violation) => ({
      id: violation.id,
      first: violation.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .locator('.board-calendar-grid')
    .getByRole('button', { name: 'Entrega 1', exact: true })
    .click()
  await expect(
    page
      .locator('dialog.drawer-modal')
      .getByRole('button', { name: 'Prazo da tarefa', exact: true }),
  ).toContainText('13:45')
  await page.screenshot({
    path: test.info().outputPath('monday-calendario-celular.png'),
    animations: 'disabled',
  })
  const state = await (await page.request.get('/api/workspace')).json()
  const task = state.tasks.find(
    (task: { boardId: string; externalId: string }) =>
      task.boardId === boardId && task.externalId === '101',
  )
  expect(task.dueAt).toBe('2025-01-05T16:45:00.000Z')
})
