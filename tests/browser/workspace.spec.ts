import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

interface TaskDropSample {
  start: number
  end: number
  textStartX: number
  textEndX: number
  textEndY: number
}

async function choose(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
  await expect(page.getByRole('listbox')).not.toBeVisible()
}

async function accessibilityFindings(page: Page, scan: Awaited<ReturnType<AxeBuilder['analyze']>>) {
  const findings: typeof scan.violations = []
  for (const violation of scan.violations) {
    if (violation.id !== 'color-contrast') {
      findings.push(violation)
      continue
    }
    const nodes: typeof violation.nodes = []
    for (const node of violation.nodes) {
      const selector = node.target[0]
      // The requested white text keeps the original label palette. Retain the raw
      // axe report, while allowing this specific contrast choice in assertions.
      const requestedLabel =
        typeof selector === 'string' &&
        (await page
          .locator(selector)
          .evaluateAll(
            (elements) =>
              elements.length > 0 &&
              elements.every(
                (element) =>
                  !!element.closest(
                    '.monday-choice-trigger, .monday-choice-option, .monday-badge, .automation-label, [title="Pré-visualização da etiqueta"]',
                  ),
              ),
          ))
      if (!requestedLabel) nodes.push(node)
    }
    if (nodes.length) findings.push({ ...violation, nodes })
  }
  return findings
}

test('desktop: edit, create, persist, comment and change views', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Assuntos de TI', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  await page.screenshot({ path: 'test-results/preview.png' })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  await writeFile('test-results/axe-desktop.json', JSON.stringify(axe.violations, null, 2))
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      count: v.nodes.length,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('button', { name: 'Novo item', exact: true }).click()
  const formAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, formAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByLabel('O que precisa acontecer?').fill('Entrega criada no navegador')
  await choose(page, 'Prioridade da nova tarefa', 'Alta')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click()
  const title = page.getByLabel('Título: Entrega criada no navegador', { exact: true })
  await expect(title).toBeVisible()
  await choose(page, 'Status: Entrega criada no navegador', 'Aguardando')
  await expect(
    page.getByLabel('Status: Entrega criada no navegador', { exact: true }),
  ).toContainText('Aguardando')
  await title.dblclick()
  await title.fill('Entrega revisada no navegador')
  await title.press('Enter')
  await expect(
    page.getByLabel('Título: Entrega revisada no navegador', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByLabel('Status: Entrega revisada no navegador', { exact: true }),
  ).toContainText('Aguardando')
  await page
    .getByRole('button', {
      name: 'Abrir atualizações de Entrega revisada no navegador',
      exact: true,
    })
    .click()
  const drawerAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, drawerAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  await choose(page, 'Status da tarefa', 'Em andamento')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('tab', { name: /Atualizações/ }).click()
  await page.getByLabel('Novo comentário').fill('Tudo pronto para validar.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Tudo pronto para validar.', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Entrega revisada no navegador', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Visão geral', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Progresso do quadro', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: /Tabela/ }).click()
  await page.getByLabel('Buscar neste quadro').fill('sem resultado de busca')
  await expect(page.getByRole('heading', { name: 'Nenhuma tarefa por aqui.' })).toBeVisible()
  expect(errors).toEqual([])
})

test('subitems, group editing, animated completion and reopening persist together', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Entregas com subitens' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const original = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const done = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && g.isCompleted,
  )
  for (const [optionId, groupId] of [
    ['status-done', done.id],
    ['status-progress', original.id],
  ])
    expect(
      (
        await page.request.post(`/api/boards/${board.id}/automations`, {
          data: { columnId: 'status', optionId, groupId },
        })
      ).status(),
    ).toBe(201)
  const parent = await (
    await page.request.post('/api/tasks', {
      data: { boardId: board.id, groupId: original.id, title: 'Publicar QuadroOS' },
    })
  ).json()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    const start = document.startViewTransition?.bind(document)
    Object.assign(window, { transitions: 0, readyTransitions: 0 })
    if (start)
      document.startViewTransition = ((callback: () => void) => {
        const transition = start(callback)
        Object.assign(window, {
          transitions: (window as unknown as { transitions: number }).transitions + 1,
        })
        void transition.ready
          .then(() =>
            Object.assign(window, {
              readyTransitions:
                (window as unknown as { readyTransitions: number }).readyTransitions + 1,
            }),
          )
          .catch(() => undefined)
        return transition
      }) as typeof document.startViewTransition
  })
  await page.goto(`/#/board/${board.id}/table`)
  await page
    .getByRole('button', { name: 'Expandir subitens de Publicar QuadroOS', exact: true })
    .click()
  const panel = page.getByRole('region', { name: 'Subitens de Publicar QuadroOS', exact: true })
  const creationConnector = panel.locator('.subitem-create-connector')
  const groupColor = await page
    .locator(`[data-group-id="${original.id}"] .group-table-wrap`)
    .evaluate((element) => getComputedStyle(element).borderLeftColor)
  await expect(panel.locator('.subitems-scroll')).toHaveCSS('border-left-color', groupColor)
  await expect(panel.locator('.subitems-connectors')).toHaveCSS('border-left-color', groupColor)
  await expect(panel.locator('.subitems-connectors i')).toHaveCount(1)
  await expect(creationConnector).toHaveCSS('border-bottom-color', groupColor)
  const emptyBranch = (await creationConnector.boundingBox())!
  const emptyAddRow = (await panel.locator('.subitem-create').boundingBox())!
  expect(
    Math.abs(emptyBranch.y + emptyBranch.height - emptyAddRow.y - emptyAddRow.height / 2),
  ).toBeLessThanOrEqual(2)
  await panel.getByRole('textbox', { name: 'Nome do novo subitem' }).fill('Revisar documentação')
  await panel.getByRole('button', { name: 'Adicionar subitem', exact: true }).click()
  await expect(panel.getByLabel('Título: Revisar documentação', { exact: true })).toBeVisible()
  await expect(panel.locator('.subitems-connectors i')).toHaveCount(2)
  await panel.getByRole('button', { name: 'Colunas dos subitens', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Prioridade', exact: true }).click()
  await expect(panel.getByLabel('Prioridade: Revisar documentação', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await choose(page, 'Prioridade: Revisar documentação', 'Alta')
  await choose(page, 'Status: Revisar documentação', 'Feito')
  await expect(panel.getByText('1 de 1 feitos', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Status: Publicar QuadroOS', { exact: true })).toContainText(
    'Não iniciado',
  )
  await expect(page.locator('.board-scope strong')).toHaveText('0')
  await page.screenshot({ path: 'test-results/subitems.png', fullPage: true })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('button', { name: 'Opções do grupo Primeiros passos', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Editar grupo', exact: true }).click()
  await page.getByLabel('Nome do grupo', { exact: true }).fill('Preparação')
  await page.getByRole('button', { name: 'Roxo', exact: true }).click()
  await page.screenshot({ path: 'test-results/group-editor.png' })
  const groupAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, groupAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preparação', exact: true })).toBeVisible()
  await expect(page.locator(`[data-group-id="${original.id}"]`)).toHaveCSS(
    '--group-color',
    '#8b79bd',
  )
  await expect(panel.locator('.subitems-scroll')).toHaveCSS(
    'border-left-color',
    'rgb(139, 121, 189)',
  )
  await expect(panel.locator('.subitems-connectors')).toHaveCSS(
    'border-left-color',
    'rgb(139, 121, 189)',
  )
  for (const branch of await panel.locator('.subitems-connectors i').all()) {
    await expect(branch).toHaveCSS('border-bottom-color', 'rgb(139, 121, 189)')
  }
  await page.locator(`[data-group-id="${done.id}"] .group-toggle`).click()
  await choose(page, 'Status: Publicar QuadroOS', 'Feito')
  await expect(
    page.locator(`[data-group-id="${done.id}"] [data-task-id="${parent.id}"]`),
  ).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Tarefa movida para Concluídas.' }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { readyTransitions: number }).readyTransitions),
    )
    .toBe(1)
  await expect(
    page.getByRole('region', { name: 'Subitens de Publicar QuadroOS', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.locator(`[data-group-id="${done.id}"] [data-task-id="${parent.id}"]`),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Expandir subitens de Publicar QuadroOS', exact: true })
    .click()
  await expect(page.getByLabel('Status: Revisar documentação', { exact: true })).toContainText(
    'Feito',
  )
  // Radix select remains inside the native task dialog and supports keyboard selection.
  await page
    .getByRole('button', { name: 'Abrir atualizações de Publicar QuadroOS', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  await expect(page.getByRole('dialog').locator('.subitems-panel')).toHaveCSS(
    '--subitem-color',
    done.color,
  )
  const trigger = page.getByRole('combobox', { name: 'Status da tarefa', exact: true })
  await trigger.focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('option', { name: 'Feito', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Feito', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Em andamento', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(trigger).toContainText('Em andamento')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').locator('.subitems-scroll')).toHaveCSS(
    'border-left-color',
    'rgb(139, 121, 189)',
  )
  await page.keyboard.press('Escape')
  await expect(
    page.locator(`[data-group-id="${original.id}"] [data-task-id="${parent.id}"]`),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Preparação', exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const prior = await page.evaluate(
    () => (window as unknown as { transitions: number }).transitions,
  )
  await choose(page, 'Status: Publicar QuadroOS', 'Feito')
  await expect(
    page.locator(`[data-group-id="${done.id}"] [data-task-id="${parent.id}"]`),
  ).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { transitions: number }).transitions),
  ).toBe(prior)
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(
    page.getByRole('region', { name: 'Subitens de Publicar QuadroOS', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const mobileBranch = (await creationConnector.boundingBox())!
  const mobileAddRow = (await panel.locator('.subitem-create').boundingBox())!
  expect(
    Math.abs(mobileBranch.y + mobileBranch.height - mobileAddRow.y - mobileAddRow.height / 2),
  ).toBeLessThanOrEqual(2)
  expect(
    (await page.locator(`[data-task-id="${parent.id}"] .title-cell`).boundingBox())!.width,
  ).toBeGreaterThan(100)
  await page.screenshot({ path: 'test-results/subitems-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('CSV import maps columns, keeps extra data and reports duplicate rows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  const csv =
    'ID;Tarefa;Status;Prazo;Orçamento\n101;Entrega importada;Em andamento;23/10/2026;200\n101;Entrega repetida;Feito;24/10/2026;300'
  await page.getByLabel('Arquivo para importação').setInputFiles({
    name: 'Teste de importação.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(page.getByText('2 tarefas encontradas · 5 colunas')).toBeVisible()
  const mappingAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, mappingAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('button', { name: 'Importar 2 tarefas', exact: true }).click()
  await expect(page.getByText('1 tarefas importadas', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir meu quadro', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Teste de importação', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Título: Entrega importada', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Orçamento: Entrega importada', { exact: true })).toHaveValue('200')
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Exportar quadro em CSV' }).click()
  expect((await download).suggestedFilename()).toBe('quadroos-export.csv')
})

test('workspace navigation, quick creation and custom labels remain usable after redesign', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Buscar quadros', exact: true }).fill('Produto')
  await expect(
    page.getByRole('navigation', { name: 'Quadros', exact: true }).getByRole('button'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Limpar busca de quadros', exact: true }).click()
  await page.getByRole('button', { name: 'Recolher lista de quadros', exact: true }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/is-compact/)
  expect((await page.locator('.app-main').boundingBox())!.x).toBeLessThan(100)
  await page.getByRole('button', { name: 'Expandir lista de quadros', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Buscar quadros', exact: true })).toBeVisible()
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Visual de equipe' } })
  ).json()
  await page.goto(`/#/board/${board.id}/table`)
  await page.reload()
  const quick = page.getByRole('textbox', { name: 'Novo item em Primeiros passos', exact: true })
  await quick.fill('Validar nova interface')
  await quick.press('Enter')
  await expect(page.getByLabel('Título: Validar nova interface', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Status: Validar nova interface', exact: true }).click()
  await page.getByRole('option', { name: 'Editar etiquetas', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Adicionar nova etiqueta', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Nome da etiqueta 7', exact: true })
    .fill('Em homologação')
  await page
    .getByRole('textbox', { name: 'Código da cor da etiqueta 7', exact: true })
    .fill('#ffcb00')
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('button', { name: 'Salvar etiquetas', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await choose(page, 'Status: Validar nova interface', 'Em homologação')
  await expect(
    page.getByRole('combobox', { name: 'Status: Validar nova interface', exact: true }),
  ).toHaveCSS('background-color', 'rgb(255, 203, 0)')
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: 'Status: Validar nova interface', exact: true }),
  ).toContainText('Em homologação')
  await choose(page, 'Agrupar tarefas', 'Por status')
  await expect(page.getByRole('heading', { name: 'Em homologação', exact: true })).toBeVisible()
})

test('create board, group and numeric column; Escape cancels an edit; batch actions persist', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Novo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Criar novo quadro', exact: true }).click()
  await page.getByLabel('Nome do quadro', { exact: true }).fill('Quadro de validação')
  await page.getByRole('dialog').getByRole('button', { name: 'Criar quadro', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Quadro de validação', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Adicionar grupo', exact: true }).click()
  await page.getByLabel('Nome do grupo', { exact: true }).fill('Planejamento')
  await page.getByRole('dialog').getByRole('button', { name: 'Criar grupo', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Planejamento', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Novo item', exact: true }).click()
  await page.getByLabel('O que precisa acontecer?').fill('Tarefa com estimativa')
  await page.getByRole('dialog').getByRole('button', { name: 'Criar tarefa', exact: true }).click()
  const title = page.getByLabel('Título: Tarefa com estimativa', { exact: true })
  await title.dblclick()
  await title.fill('Uma alteração cancelada')
  await title.press('Escape')
  await expect(title).toHaveValue('Tarefa com estimativa')
  await page.getByRole('button', { name: 'Colunas', exact: true }).click()
  await page.getByRole('button', { name: 'Adicionar coluna', exact: true }).click()
  await page.getByLabel('Nome da coluna').fill('Estimativa')
  await page.getByRole('radio', { name: 'Números', exact: true }).check()
  await page.getByRole('dialog').getByRole('button', { name: 'Criar coluna', exact: true }).click()
  const estimate = page.getByLabel('Estimativa: Tarefa com estimativa', { exact: true })
  await estimate.fill('8.5')
  const saved = page.waitForResponse(
    (response) => response.url().includes('/api/tasks/') && response.request().method() === 'PATCH',
  )
  await estimate.press('Enter')
  expect((await saved).status()).toBe(200)
  await page.reload()
  await expect(page.getByLabel('Estimativa: Tarefa com estimativa', { exact: true })).toHaveValue(
    '8.5',
  )
  await page.getByLabel('Selecionar Tarefa com estimativa', { exact: true }).check()
  await choose(page, 'Alterar status das tarefas selecionadas', 'Feito')
  await expect(page.getByLabel('Status: Tarefa com estimativa', { exact: true })).toContainText(
    'Feito',
  )
  await page.getByLabel('Selecionar Tarefa com estimativa', { exact: true }).check()
  await page.getByRole('button', { name: 'Excluir', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Excluir tarefas', exact: true })
    .click()
  await expect(page.getByLabel('Título: Tarefa com estimativa', { exact: true })).toHaveCount(0)
})

test('mobile: readable layout, working navigation, modal keyboard escape and reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/board/board-ti/table')
  await expect(page.getByRole('heading', { name: 'Assuntos de TI', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  await writeFile('test-results/axe-mobile.json', JSON.stringify(axe.violations, null, 2))
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      count: v.nodes.length,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('button', { name: 'Abrir navegação' }).click()
  await page
    .getByRole('navigation', { name: 'Quadros', exact: true })
    .getByRole('button', { name: 'Produto & Design' })
    .click()
  await expect(page.getByRole('heading', { name: 'Produto & Design', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Pular para o conteúdo' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Produto & Design', exact: true })).toBeVisible()
  await expect(page.locator('#main-content')).toBeFocused()
  await page.getByRole('button', { name: 'Novo item', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.setViewportSize({ width: 812, height: 375 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('six reference statuses save with their colors, update progress and appear in Kanban', async ({
  page,
}) => {
  const create = await page.request.post('/api/boards', { data: { name: 'Ciclo de status' } })
  expect(create.status()).toBe(201)
  const board = await create.json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find((g: { boardId: string }) => g.boardId === board.id)
  const created = await page.request.post('/api/tasks', {
    data: {
      boardId: board.id,
      groupId: group.id,
      title: 'Validar os seis status',
      dueDate: '2000-01-01',
    },
  })
  expect(created.status()).toBe(201)
  await page.goto(`/#/board/${board.id}/table`)
  const select = page.getByLabel('Status: Validar os seis status', { exact: true })
  const statuses = [
    ['Feito', 'rgb(0, 200, 117)'],
    ['Em andamento', 'rgb(253, 171, 61)'],
    ['Parado', 'rgb(226, 68, 92)'],
    ['Não iniciado', 'rgb(121, 128, 153)'],
    ['Aguardando', 'rgb(0, 160, 233)'],
    ['Contínuo', 'rgb(162, 93, 220)'],
  ]
  await select.click()
  await expect(page.getByRole('option')).toHaveText([
    ...statuses.map(([status]) => status),
    'Editar etiquetas',
  ])
  for (const option of await page.locator('.monday-choice-option').all())
    await expect(option).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.keyboard.press('Escape')
  for (const [status, color] of statuses) {
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/tasks/') && response.request().method() === 'PATCH',
    )
    await choose(page, 'Status: Validar os seis status', status)
    expect((await saved).status()).toBe(200)
    await expect(select).toContainText(status)
    await expect(select).toHaveCSS('background-color', color)
    await expect(select).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(page.locator('.board-scope strong')).toHaveText(status === 'Feito' ? '1' : '0')
  }
  await page.reload()
  await expect(page.getByLabel('Status: Validar os seis status', { exact: true })).toContainText(
    'Contínuo',
  )
  await choose(page, 'Agrupar tarefas', 'Por status')
  await expect(page.locator('.group-heading h2')).toHaveText(statuses.map(([status]) => status))
  const groupedAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, groupedAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  await expect(page.locator('.kanban-column')).toHaveCount(6)
  await expect(page.locator('.kanban-column h2')).toHaveText(statuses.map(([status]) => status))
  await expect(
    page
      .locator('.kanban-column')
      .filter({ has: page.getByRole('heading', { name: 'Contínuo', exact: true }) })
      .locator('.kanban-task-title'),
  ).toHaveText('Validar os seis status')
})

test('resize columns by pointer and keyboard, cancel with Escape and persist widths across groups', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Colunas ajustáveis' } })
  ).json()
  await page.request.post('/api/boards/' + board.id + '/columns', {
    data: { name: 'Observações', type: 'text' },
  })
  await page.goto('/#/board/' + board.id + '/table')
  const headers = page.locator('.task-table thead .title-cell')
  const separator = page
    .getByRole('separator', { name: 'Redimensionar coluna Tarefa', exact: true })
    .first()
  await expect(separator).toBeVisible()
  const start = Number(await separator.getAttribute('aria-valuenow'))
  const box = (await separator.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 130, box.y + box.height / 2, { steps: 10 })
  await expect(separator).toHaveAttribute('aria-valuenow', String(start + 130))
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/column-widths') && r.request().method() === 'PATCH',
  )
  await page.mouse.up()
  expect((await saved).status()).toBe(200)
  for (const header of await headers.all())
    expect(Math.abs((await header.boundingBox())!.width - start - 130)).toBeLessThan(2)
  await page.reload()
  await expect(separator).toHaveAttribute('aria-valuenow', String(start + 130))
  await separator.focus()
  const keyed = page.waitForResponse((r) => r.url().endsWith('/column-widths'))
  await separator.press('ArrowLeft')
  expect((await keyed).status()).toBe(200)
  await expect(separator).toHaveAttribute('aria-valuenow', String(start + 120))
  const next = (await separator.boundingBox())!
  await page.mouse.move(next.x + 5, next.y + 10)
  await page.mouse.down()
  await page.mouse.move(next.x + 75, next.y + 10, { steps: 6 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(separator).toHaveAttribute('aria-valuenow', String(start + 120))
  await expect(page.locator('body')).not.toHaveClass(/resizing-columns/)
  const custom = page
    .getByRole('separator', { name: 'Redimensionar coluna Observações', exact: true })
    .first()
  await custom.scrollIntoViewIfNeeded()
  await custom.focus()
  const customSave = page.waitForResponse((r) => r.url().endsWith('/column-widths'))
  await custom.press('ArrowRight')
  expect((await customSave).status()).toBe(200)
  await page.reload()
  await expect(custom).toHaveAttribute('aria-valuenow', '145')
  await expect(separator).toHaveAttribute('aria-valuenow', String(start + 120))
  const reset = page.waitForResponse(
    (r) => r.url().endsWith('/column-widths') && r.request().postDataJSON().widths.title === 360,
  )
  await separator.dblclick()
  expect((await reset).status()).toBe(200)
  await expect(separator).toHaveAttribute('aria-valuenow', '360')
})

test('click and immediately drag task names, double click to edit, keyboard sorting and subitems persist', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Tarefas móveis' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const create = async (title: string, parentId?: string) =>
    (
      await page.request.post('/api/tasks', {
        data: { boardId: board.id, groupId: group.id, title, parentId },
      })
    ).json()
  const a = await create('Visível A')
  const b = await create('Intermediária B')
  const c = await create('Visível C')
  const d = await create('Última D')
  const child = await create('Subitem um', c.id)
  const childTwo = await create('Subitem dois', c.id)
  await page.goto('/#/board/' + board.id + '/table')
  const section = page.locator('[data-group-id="' + group.id + '"]')
  const rows = section.locator('table.task-table > tbody > tr[data-task-id]')
  const order = async () =>
    rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-task-id')))
  const title = page.getByLabel('Título: Visível A', { exact: true })
  await title.click()
  await expect(title).toHaveAttribute('readonly', '')
  await title.press('x')
  await expect(title).toHaveValue('Visível A')
  await title.dblclick()
  await expect(title).not.toHaveAttribute('readonly', '')
  await title.fill('Visível A revisada')
  await title.press('Enter')
  await expect(page.getByLabel('Título: Visível A revisada', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  )
  expect(await order()).toEqual([a.id, b.id, c.id, d.id])
  async function drag(sourceId: string, targetId: string, cancel = false) {
    const source = section.locator('[data-task-id="' + sourceId + '"] .sortable-task-name').first()
    const target = section.locator('[data-task-id="' + targetId + '"]').first()
    // Measure only after the previous reorder has settled; keep the next
    // pointer movement immediate once the mouse button is pressed.
    await target.scrollIntoViewIfNeeded()
    await source.scrollIntoViewIfNeeded()
    const from = (await source.boundingBox())!
    const to = (await target.boundingBox())!
    await page.mouse.move(from.x + Math.min(50, from.width / 2), from.y + from.height / 2)
    await page.mouse.down()
    // Move immediately: a press-and-hold timer would cancel this gesture.
    await page.mouse.move(from.x + Math.min(50, from.width / 2) + 8, from.y + from.height / 2)
    await expect(page.locator('.task-drag-preview')).toBeVisible()
    await page.mouse.move(from.x + 50, to.y + to.height / 2, { steps: 12 })
    if (cancel) {
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(page.locator('.task-drag-preview')).toHaveCount(0)
      return
    }
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/move') && r.request().method() === 'POST',
    )
    await page.mouse.up()
    expect((await saved).status()).toBe(200)
    await expect(page.locator('.task-drag-preview')).toHaveCount(0)
  }
  await drag(c.id, a.id)
  await expect.poll(order).toEqual([c.id, a.id, b.id, d.id])
  await page.reload()
  await expect.poll(order).toEqual([c.id, a.id, b.id, d.id])
  // Filtering never removes the hidden siblings from the saved ordering.
  await page.getByLabel('Buscar neste quadro').fill('Visível')
  await drag(c.id, a.id)
  await expect.poll(order).toEqual([a.id, c.id])
  await page.getByLabel('Buscar neste quadro').clear()
  await expect.poll(order).toEqual([a.id, c.id, b.id, d.id])
  await drag(d.id, a.id, true)
  await expect.poll(order).toEqual([a.id, c.id, b.id, d.id])
  const handle = page.getByRole('button', { name: 'Mover tarefa Última D', exact: true })
  await handle.scrollIntoViewIfNeeded()
  await handle.focus()
  await handle.press('Space')
  await expect(page.locator('.task-drag-preview')).toBeVisible()
  await expect(page.getByText('Última D, posição 4 de 4.', { exact: true })).toBeAttached()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText('Última D, posição 3 de 4.', { exact: true })).toBeAttached()
  const keyboardSave = page.waitForResponse((r) => r.url().endsWith('/move'))
  await page.keyboard.press('Space')
  expect((await keyboardSave).status()).toBe(200)
  await expect(page.getByText('Última D solto na posição 3.', { exact: true })).toBeAttached()
  await expect(page.locator('.task-drag-preview')).toHaveCount(0)
  await expect.poll(order).toEqual([a.id, c.id, d.id, b.id])
  await page.getByRole('button', { name: 'Expandir subitens de Visível C', exact: true }).click()
  const subitems = page.getByRole('region', { name: 'Subitens de Visível C', exact: true })
  const childHandle = subitems.getByRole('button', {
    name: 'Mover tarefa Subitem dois',
    exact: true,
  })
  await childHandle.scrollIntoViewIfNeeded()
  await childHandle.focus()
  await childHandle.press('Space')
  await expect(page.locator('.task-drag-preview')).toBeVisible()
  await expect(page.getByText('Subitem dois, posição 2 de 2.', { exact: true })).toBeAttached()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText('Subitem dois, posição 1 de 2.', { exact: true })).toBeAttached()
  const childSave = page.waitForResponse((r) => r.url().endsWith('/move'))
  await page.keyboard.press('Space')
  expect((await childSave).status()).toBe(200)
  await expect(page.locator('.task-drag-preview')).toHaveCount(0)
  await expect
    .poll(() =>
      subitems
        .locator('tr[data-task-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-task-id'))),
    )
    .toEqual([childTwo.id, child.id])
  await drag(c.id, b.id)
  await expect.poll(order).toEqual([a.id, d.id, b.id, c.id])
  await expect(subitems).toBeVisible()
  await page.reload()
  await expect.poll(order).toEqual([a.id, d.id, b.id, c.id])
  await page.getByRole('button', { name: 'Expandir subitens de Visível C', exact: true }).click()
  await expect
    .poll(() =>
      subitems
        .locator('tr[data-task-id]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-task-id'))),
    )
    .toEqual([childTwo.id, child.id])
  await choose(page, 'Ordenar tarefas', 'Título: A–Z')
  await expect(handle).toHaveAttribute('aria-disabled', 'true')
  expect(errors).toEqual([])
})

test('drop animation lands in the new position while saves are queued, and failed moves roll back', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const drops: TaskDropSample[] = []
    Object.assign(window, { taskDropAnimations: drops })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (keyframes, options) {
      if (this.querySelector('.task-drag-preview') && Array.isArray(keyframes)) {
        const rect = this.getBoundingClientRect()
        const initial = new DOMMatrix(getComputedStyle(this).transform)
        const final = new DOMMatrix(String(keyframes.at(-1)?.transform || 'none'))
        const text = this.querySelector('.task-drag-preview span')!.getBoundingClientRect()
        drops.push({
          start: rect.top,
          end: rect.top - initial.m42 + final.m42,
          textStartX: text.left,
          textEndX: text.left - initial.m41 + final.m41,
          textEndY: text.top + text.height / 2 - initial.m42 + final.m42,
        })
      }
      return animate.call(this, keyframes, options)
    }
  })
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Soltura suave' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const create = async (title: string) =>
    (
      await page.request.post('/api/tasks', {
        data: { boardId: board.id, groupId: group.id, title },
      })
    ).json()
  const a = await create('Animação A')
  const b = await create('Animação B')
  const c = await create('Animação C')
  await page.goto('/#/board/' + board.id + '/table')
  const rows = page.locator('.task-table > tbody > tr[data-task-id]')
  const order = () =>
    rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-task-id')))
  await expect.poll(order).toEqual([a.id, b.id, c.id])
  const top = (await rows.first().boundingBox())!.y
  const height = (await rows.first().boundingBox())!.height
  let releaseEdit!: () => void
  let releaseMove!: () => void
  const editGate = new Promise<void>((resolve) => {
    releaseEdit = resolve
  })
  const moveGate = new Promise<void>((resolve) => {
    releaseMove = resolve
  })
  await page.route('**/api/tasks/' + a.id, async (route) => {
    await editGate
    await route.continue()
  })
  await page.route('**/api/tasks/*/move', async (route) => {
    const response = await route.fetch()
    await moveGate
    await route.fulfill({ response })
  })
  async function drag(sourceId: string, targetId: string) {
    const sourceName = page.locator('[data-task-id="' + sourceId + '"] .sortable-task-name')
    await sourceName.click({ trial: true })
    const source = (await sourceName.boundingBox())!
    const target = (await page.locator('[data-task-id="' + targetId + '"]').boundingBox())!
    await page.mouse.move(source.x + 50, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + 58, source.y + source.height / 2)
    await expect(page.locator('.task-drag-preview')).toBeVisible()
    const textLeft = await sourceName.locator('input').evaluate((node) => {
      const style = getComputedStyle(node)
      return (
        node.getBoundingClientRect().left +
        parseFloat(style.paddingLeft) +
        parseFloat(style.borderLeftWidth)
      )
    })
    expect(
      Math.abs((await page.locator('.task-drag-preview span').boundingBox())!.x - textLeft),
    ).toBeLessThan(1)
    await page.mouse.move(source.x + 140, target.y + target.height / 2 + 6, { steps: 10 })
    expect(
      Math.abs((await page.locator('.task-drag-preview span').boundingBox())!.x - textLeft),
    ).toBeLessThan(1)
    if (sourceId === c.id) await page.screenshot({ path: 'test-results/drop-preview.png' })
    await page.mouse.up()
  }
  async function samplePosition(taskId: string) {
    return page.evaluate(async (id) => {
      const tops: number[] = []
      const horizontalOffsets: number[] = []
      const start = performance.now()
      do {
        await new Promise(requestAnimationFrame)
        tops.push(
          document.querySelector('[data-task-id="' + id + '"]')!.getBoundingClientRect().top,
        )
        const previewText = document.querySelector('.task-drag-preview span')
        const input = document.querySelector(
          '[data-task-id="' + id + '"] .sortable-task-name input',
        )!
        if (previewText) {
          const style = getComputedStyle(input)
          const contentLeft =
            input.getBoundingClientRect().left +
            parseFloat(style.paddingLeft) +
            parseFloat(style.borderLeftWidth)
          horizontalOffsets.push(Math.abs(previewText.getBoundingClientRect().left - contentLeft))
        }
      } while (performance.now() - start < 350)
      return { tops, horizontalOffsets }
    }, taskId)
  }
  try {
    // Hold an earlier save so the move cannot update workspace data yet.
    const editStarted = page.waitForRequest(
      (r) => r.url().endsWith('/tasks/' + a.id) && r.method() === 'PATCH',
    )
    await choose(page, 'Status: Animação A', 'Aguardando')
    await editStarted
    await drag(c.id, a.id)
    const firstFrames = await samplePosition(c.id)
    expect(firstFrames.tops.every((y) => Math.abs(y - top) < 2)).toBe(true)
    expect(Math.max(0, ...firstFrames.horizontalOffsets)).toBeLessThan(1)
    await page.screenshot({ path: 'test-results/drop-landed.png' })
    expect(await order()).toEqual([c.id, a.id, b.id])
    const firstDrop = await page.evaluate(
      () =>
        (
          window as typeof window & {
            taskDropAnimations: TaskDropSample[]
          }
        ).taskDropAnimations[0],
    )
    expect(firstDrop).toBeDefined()
    expect(Math.abs(firstDrop.end - top)).toBeLessThan(2)
    const landing = await page
      .locator('[data-task-id="' + c.id + '"] .sortable-task-name input')
      .evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          x: rect.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
          y: rect.top + rect.height / 2,
        }
      })
    expect(Math.abs(firstDrop.textEndX - landing.x)).toBeLessThan(1)
    expect(Math.abs(firstDrop.textStartX - firstDrop.textEndX)).toBeLessThan(1)
    expect(Math.abs(firstDrop.textEndY - landing.y)).toBeLessThan(1)
    await expect(page.locator('.task-drag-preview')).toHaveCount(0)
    // A second drop stays visible even when the first request completes later.
    await drag(b.id, a.id)
    const secondFrames = await samplePosition(b.id)
    expect(secondFrames.tops.every((y) => Math.abs(y - top - height) < 2)).toBe(true)
    expect(Math.max(0, ...secondFrames.horizontalOffsets)).toBeLessThan(1)
    expect(await order()).toEqual([c.id, b.id, a.id])
    const secondDrop = await page.evaluate(
      () =>
        (window as typeof window & { taskDropAnimations: TaskDropSample[] }).taskDropAnimations[1],
    )
    expect(Math.abs(secondDrop.end - top - height)).toBeLessThan(2)
    expect(Math.abs(secondDrop.textEndX - landing.x)).toBeLessThan(1)
    expect(Math.abs(secondDrop.textStartX - secondDrop.textEndX)).toBeLessThan(1)
    const firstMoveResponse = page.waitForResponse((r) =>
      r.url().endsWith('/tasks/' + c.id + '/move'),
    )
    const secondMoveResponse = page.waitForResponse((r) =>
      r.url().endsWith('/tasks/' + b.id + '/move'),
    )
    releaseEdit()
    releaseMove()
    expect((await firstMoveResponse).status()).toBe(200)
    expect((await secondMoveResponse).status()).toBe(200)
    await expect.poll(order).toEqual([c.id, b.id, a.id])
    await page.reload()
    await expect.poll(order).toEqual([c.id, b.id, a.id])
    await page.route('**/api/tasks/' + a.id + '/move', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Conflito de versão simulado.' }),
      }),
    )
    await drag(a.id, c.id)
    await expect(page.getByRole('alert')).toContainText('Conflito de versão simulado.')
    await expect.poll(order).toEqual([c.id, b.id, a.id])
  } finally {
    releaseEdit()
    releaseMove()
  }
})

test('Monday-style subitems support selection, quick creation, comments and persistent column preferences', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Subitens da equipe' } })
  ).json()
  await page.request.patch('/api/boards/' + board.id, {
    data: {
      settings: {
        statusOptions: [
          { id: 'status-open', label: 'Não iniciado', color: '#798099' },
          { id: 'status-done', label: 'Feito', color: '#00c875' },
          { id: 'status-planned', label: 'Planejado', color: '#0086c0' },
        ],
      },
    },
  })
  const column = await (
    await page.request.post('/api/boards/' + board.id + '/columns', {
      data: { name: 'Estimativa', type: 'number' },
    })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const parent = await (
    await page.request.post('/api/tasks', {
      data: {
        boardId: board.id,
        groupId: group.id,
        title: 'Refazer as permissões das pastas',
        ownerId: 'person-you',
      },
    })
  ).json()
  const children: { id: string; title: string }[] = []
  for (const title of ['Projetos', 'Compras', 'Financeiro', 'Contábil', 'Controladoria', 'RH'])
    children.push(
      await (
        await page.request.post('/api/tasks', {
          data: {
            boardId: board.id,
            groupId: group.id,
            parentId: parent.id,
            title,
            ownerId: 'person-you',
            status: title === 'Projetos' ? 'Feito' : 'Planejado',
          },
        })
      ).json(),
    )
  await page.goto('/#/board/' + board.id + '/table')
  await page
    .getByRole('button', { name: 'Expandir subitens de ' + parent.title, exact: true })
    .click()
  const panel = page.getByRole('region', { name: 'Subitens de ' + parent.title, exact: true })
  await expect(panel.getByRole('columnheader', { name: 'Responsável', exact: true })).toBeVisible()
  await expect(panel.getByRole('columnheader', { name: 'Prioridade', exact: true })).toHaveCount(0)
  await expect(panel.getByText('1 de 6 feitos', { exact: true })).toBeVisible()
  await expect(panel.locator('.subitems-connectors i')).toHaveCount(7)
  await expect(panel.getByRole('checkbox')).toHaveCount(7)
  await page.screenshot({ path: 'test-results/subitems-reference.png' })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await panel.getByLabel('Selecionar subitem Compras', { exact: true }).check()
  await expect(panel.getByRole('toolbar')).toContainText('1 subitem selecionado')
  await expect(page.getByLabel('Selecionar ' + parent.title, { exact: true })).not.toBeChecked()
  const all = panel.getByRole('checkbox', {
    name: 'Selecionar todos os subitens de ' + parent.title,
    exact: true,
  })
  expect(await all.evaluate((node) => (node as HTMLInputElement).indeterminate)).toBe(true)
  await all.check()
  await expect(panel.getByRole('toolbar')).toContainText('6 subitens selecionados')
  await choose(page, 'Alterar status dos subitens selecionados', 'Planejado')
  await expect(panel.getByRole('toolbar')).toHaveCount(0)
  await expect(panel.getByText('0 de 6 feitos', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Status: ' + parent.title, { exact: true })).toContainText(
    'Não iniciado',
  )
  const rh = panel.getByLabel('Título: RH', { exact: true })
  await rh.dblclick()
  await rh.fill('Recursos humanos')
  await rh.press('Enter')
  await expect(panel.getByLabel('Título: Recursos humanos', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Abrir atualizações de Compras', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('tab', { name: /Atualizações/ })).toHaveAttribute(
    'data-state',
    'active',
  )
  await page.getByLabel('Novo comentário').fill('Permissões conferidas pela equipe.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(page.getByText('Permissões conferidas pela equipe.', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    panel.getByRole('button', { name: 'Abrir atualizações de Compras', exact: true }),
  ).toHaveAttribute('title', '1 comentário')
  await panel.getByRole('button', { name: 'Colunas dos subitens', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Prioridade', exact: true }).click()
  await expect(panel.getByLabel('Prioridade: Compras', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Estimativa', exact: true }),
  ).toBeEnabled()
  await page.getByRole('menuitemcheckbox', { name: 'Estimativa', exact: true }).click()
  await expect(panel.getByLabel('Estimativa: Compras', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await choose(page, 'Prioridade: Compras', 'Alta')
  await expect(panel.getByLabel('Prioridade: Compras', { exact: true })).toContainText('Alta')
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0)
  const estimate = panel.getByLabel('Estimativa: Compras', { exact: true })
  const estimated = page.waitForResponse(
    (r) => r.url().endsWith('/tasks/' + children[1].id) && r.request().method() === 'PATCH',
  )
  await estimate.fill('8.5')
  await estimate.press('Enter')
  expect((await estimated).status()).toBe(200)
  await page.reload()
  await page
    .getByRole('button', { name: 'Expandir subitens de ' + parent.title, exact: true })
    .click()
  await expect(estimate).toHaveValue('8.5')
  await expect(panel.getByLabel('Prioridade: Compras', { exact: true })).toContainText('Alta')
  await page
    .getByRole('button', { name: 'Abrir atualizações de ' + parent.title, exact: true })
    .click()
  await page.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('button', { name: 'Colunas dos subitens', exact: true }).click()
  const field = drawer.getByRole('menuitemcheckbox', { name: 'Estimativa', exact: true })
  await expect(field).toBeVisible()
  await field.click()
  await expect(drawer.getByLabel('Estimativa: Compras', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeVisible()
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(panel.getByLabel('Estimativa: Compras', { exact: true })).toHaveCount(0)
  await panel.getByLabel('Selecionar subitem Financeiro', { exact: true }).check()
  await panel.getByRole('toolbar').getByRole('button', { name: 'Excluir', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Excluir tarefas', exact: true })
    .click()
  await expect(panel.getByLabel('Título: Financeiro', { exact: true })).toHaveCount(0)
  const quick = panel.getByLabel('Nome do novo subitem', { exact: true })
  await quick.fill('Segurança')
  await quick.press('Enter')
  await expect(panel.getByLabel('Título: Segurança', { exact: true })).toBeVisible()
  await expect(quick).toBeEmpty()
  await expect(quick).toBeFocused()
  const persisted = await (await page.request.get('/api/workspace')).json()
  const created = persisted.tasks.find(
    (t: { title: string; parentId: string }) => t.title === 'Segurança' && t.parentId === parent.id,
  )
  expect(created.ownerId).toBe('person-you')
  expect(
    persisted.tasks.find((t: { id: string }) => t.id === children[1].id).customValues[column.id],
  ).toBe('8.5')
  expect(persisted.tasks.find((t: { id: string }) => t.id === parent.id).groupId).toBe(group.id)
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const scroll = panel.getByRole('region', {
    name: 'Tabela de subitens de ' + parent.title,
    exact: true,
  })
  const mobileRowHeights = await panel
    .locator('tr[data-task-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  expect(mobileRowHeights.every((height) => Math.abs(height - 36) < 1)).toBe(true)
  expect(await scroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/subitems-reference-mobile.png', fullPage: true })
})

test('column positions can be dragged or moved by menu and persist independently for subitems', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Posição das colunas' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const custom = await (
    await page.request.post('/api/boards/' + board.id + '/columns', {
      data: { name: 'Estimativa', type: 'number' },
    })
  ).json()
  const parent = await (
    await page.request.post('/api/tasks', {
      data: {
        boardId: board.id,
        groupId: group.id,
        title: 'Organizar colunas',
        ownerId: 'person-you',
        dueDate: '2030-05-15',
        customValues: { [custom.id]: '8.5' },
      },
    })
  ).json()
  await page.goto('/#/board/' + board.id + '/table')
  const table = page.locator('[data-group-id="' + group.id + '"] .group-table-wrap > table')
  const headings = table.locator(':scope > thead [data-column-key]')
  const order = () =>
    headings.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-column-key')),
    )
  const save = page.waitForResponse(
    (response) =>
      response.url().endsWith('/column-order') && response.request().method() === 'PATCH',
  )
  await table
    .locator(':scope > thead [data-column-key="status"] .column-heading-label')
    .dragTo(table.locator(':scope > thead [data-column-key="owner"]'), {
      targetPosition: { x: 8, y: 16 },
    })
  expect((await save).status()).toBe(200)
  await expect.poll(order).toEqual(['status', 'owner', 'priority', 'date', custom.id])
  await expect(
    table
      .locator(':scope > thead')
      .getByRole('button', { name: 'Posição da coluna Status', exact: true }),
  ).toBeEnabled()
  const row = table.locator('[data-task-id="' + parent.id + '"]')
  expect(
    await row.locator('td').evaluateAll((cells) => cells.map((cell) => cell.className)),
  ).toEqual([
    'check-cell',
    'title-cell',
    'status-cell',
    'owner-cell',
    'priority-cell',
    'date-cell',
    'custom-cell',
    'detail-cell',
  ])
  await expect(row.getByLabel('Estimativa: Organizar colunas', { exact: true })).toHaveValue('8.5')
  await expect(
    table.locator(':scope > tfoot .monday-summary-row td').nth(2).locator('.monday-summary-bar'),
  ).toHaveAttribute('aria-label', 'Distribuição de status')
  await page.reload()
  await expect.poll(order).toEqual(['status', 'owner', 'priority', 'date', custom.id])
  await table
    .locator(':scope > thead')
    .getByRole('button', { name: 'Posição da coluna Prazo', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Mover para a esquerda', exact: true }).click()
  await expect.poll(order).toEqual(['status', 'owner', 'date', 'priority', custom.id])
  await expect(
    table
      .locator(':scope > thead')
      .getByRole('button', { name: 'Posição da coluna Prazo', exact: true }),
  ).toBeEnabled()
  const resize = table.getByRole('separator', { name: 'Redimensionar coluna Status', exact: true })
  await resize.focus()
  const beforeWidth = Number(await resize.getAttribute('aria-valuenow'))
  await resize.press('ArrowRight')
  await expect(resize).toHaveAttribute('aria-valuenow', String(beforeWidth + 10))
  await page
    .getByRole('button', { name: 'Expandir subitens de Organizar colunas', exact: true })
    .click()
  const panel = page.getByRole('region', { name: 'Subitens de Organizar colunas', exact: true })
  await panel.getByRole('button', { name: 'Posição da coluna Status', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mover para a esquerda', exact: true }).click()
  const subOrder = () =>
    panel
      .locator('thead [data-column-key]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-column-key')))
  await expect.poll(subOrder).toEqual(['status', 'owner', 'date'])
  await expect(
    panel.getByRole('button', { name: 'Posição da coluna Status', exact: true }),
  ).toBeEnabled()
  await expect.poll(order).toEqual(['status', 'owner', 'date', 'priority', custom.id])
  await page.reload()
  await page
    .getByRole('button', { name: 'Expandir subitens de Organizar colunas', exact: true })
    .click()
  await expect.poll(subOrder).toEqual(['status', 'owner', 'date'])
  await expect(resize).toHaveAttribute('aria-valuenow', String(beforeWidth + 10))
  await page.screenshot({ path: 'test-results/column-positions.png' })
  await page.route('**/api/boards/' + board.id + '/column-order', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Falha simulada ao salvar a posição.' }),
    }),
  )
  await table
    .locator(':scope > thead')
    .getByRole('button', { name: 'Posição da coluna Status', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Mover para a direita', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Falha simulada ao salvar a posição.')
  await expect.poll(order).toEqual(['status', 'owner', 'date', 'priority', custom.id])
})

test('multiple assignees and clickable deadline calendars work in tables, subitems, drawers and creation', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Equipe e calendário' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const parent = await (
    await page.request.post('/api/tasks', {
      data: {
        boardId: board.id,
        groupId: group.id,
        title: 'Entrega compartilhada',
        ownerIds: ['person-ana'],
        dueDate: '2030-05-15',
      },
    })
  ).json()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#/board/' + board.id + '/table')
  const owner = page.getByRole('button', {
    name: 'Responsável: Entrega compartilhada',
    exact: true,
  })
  await owner.click()
  let picker = page.locator('.assignee-popover')
  await expect(picker.getByRole('checkbox', { name: 'Ana Costa', exact: true })).toBeChecked()
  await picker.getByRole('checkbox', { name: 'Você', exact: true }).check()
  await expect(picker.getByRole('checkbox', { name: 'Você', exact: true })).toBeEnabled()
  await expect(owner).toContainText('2 pessoas')
  const assigneeAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, assigneeAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.screenshot({ path: 'test-results/multiple-assignees.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
  await choose(page, 'Responsável', 'Você')
  await expect(page.getByLabel('Título: Entrega compartilhada', { exact: true })).toBeVisible()
  await choose(page, 'Responsável', 'Todas as pessoas')
  await page.getByRole('button', { name: 'Prazo: Entrega compartilhada', exact: true }).click()
  let calendar = page.locator('.date-picker-popover')
  await expect(calendar.getByRole('grid')).toBeVisible()
  await calendar.locator('[data-day="20/05/2030"]').click()
  await expect(calendar).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Prazo: Entrega compartilhada', exact: true }),
  ).toContainText('20 de mai')
  await page.reload()
  await expect(owner).toContainText('2 pessoas')
  await page
    .getByRole('button', { name: 'Expandir subitens de Entrega compartilhada', exact: true })
    .click()
  const panel = page.getByRole('region', { name: 'Subitens de Entrega compartilhada', exact: true })
  await panel.getByRole('textbox', { name: 'Nome do novo subitem' }).fill('Entrega da equipe')
  await panel.getByRole('textbox', { name: 'Nome do novo subitem' }).press('Enter')
  await expect(panel.getByLabel('Título: Entrega da equipe', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Responsável: Entrega da equipe', exact: true }).click()
  picker = page.locator('.assignee-popover')
  await expect(picker.getByRole('checkbox', { name: 'Ana Costa', exact: true })).toBeChecked()
  await expect(picker.getByRole('checkbox', { name: 'Você', exact: true })).toBeChecked()
  await picker.getByRole('checkbox', { name: 'Ana Costa', exact: true }).uncheck()
  await expect(picker.getByRole('checkbox', { name: 'Ana Costa', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await panel.getByRole('button', { name: 'Prazo: Entrega da equipe', exact: true }).click()
  calendar = page.locator('.date-picker-popover')
  await calendar.getByLabel('Data do prazo', { exact: true }).fill('2030-06-21')
  await calendar.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(calendar).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Abrir atualizações de Entrega compartilhada', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Detalhes', exact: true }).click()
  const drawer = page.locator('dialog.drawer-modal')
  await drawer.getByRole('button', { name: 'Prazo da tarefa', exact: true }).click()
  calendar = drawer.locator('.date-picker-popover')
  await expect(calendar.getByRole('grid')).toBeVisible()
  const calendarAxe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    (await accessibilityFindings(page, calendarAxe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.screenshot({ path: 'test-results/deadline-calendar.png' })
  await page.keyboard.press('Escape')
  await expect(calendar).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: 'Responsável da tarefa', exact: true }).click()
  await expect(
    drawer.locator('.assignee-popover').getByRole('checkbox', { name: 'Você', exact: true }),
  ).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(drawer.locator('.assignee-popover')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: 'Prazo: Entrega compartilhada', exact: true }).click()
  await page
    .locator('.date-picker-popover')
    .getByRole('button', { name: 'Remover prazo', exact: true })
    .click()
  await expect(page.locator('.date-picker-popover')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Prazo: Entrega compartilhada', exact: true }),
  ).toContainText('Sem prazo')
  await page.getByRole('button', { name: 'Novo item', exact: true }).click()
  const form = page
    .locator('dialog.modal')
    .filter({ has: page.getByRole('heading', { name: 'Nova tarefa', exact: true }) })
  await page.getByLabel('O que precisa acontecer?').fill('Criada com equipe')
  await form.getByRole('button', { name: 'Responsáveis da nova tarefa', exact: true }).click()
  await form
    .locator('.assignee-popover')
    .getByRole('checkbox', { name: 'Lucas Martins', exact: true })
    .check()
  await expect(
    form.locator('.assignee-popover').getByRole('checkbox', { name: 'Lucas Martins', exact: true }),
  ).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(form.locator('.assignee-popover')).toHaveCount(0)
  await form.getByRole('button', { name: 'Prazo da nova tarefa', exact: true }).click()
  await form
    .locator('.date-picker-popover')
    .getByLabel('Data do prazo', { exact: true })
    .fill('2030-07-01')
  await form
    .locator('.date-picker-popover')
    .getByRole('button', { name: 'Aplicar', exact: true })
    .click()
  await expect(form.locator('.date-picker-popover')).toHaveCount(0)
  await form.getByRole('button', { name: 'Criar tarefa', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Responsável: Criada com equipe', exact: true }),
  ).toContainText('2 pessoas')
  const final = await (await page.request.get('/api/workspace')).json()
  expect(final.tasks.find((t: { id: string }) => t.id === parent.id).ownerIds).toEqual([
    'person-ana',
    'person-you',
  ])
  expect(
    final.tasks.find((t: { title: string }) => t.title === 'Criada com equipe').ownerIds,
  ).toEqual(['person-you', 'person-lucas'])
  expect(
    final.tasks.find((t: { title: string }) => t.title === 'Entrega da equipe').ownerIds,
  ).toEqual(['person-you'])
  expect(final.tasks.find((t: { title: string }) => t.title === 'Entrega da equipe').dueDate).toBe(
    '2030-06-21',
  )
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Mais detalhes: Criada com equipe', exact: true }).click()
  await page
    .locator('dialog.drawer-modal')
    .getByRole('button', { name: 'Prazo da tarefa', exact: true })
    .click()
  await expect(page.locator('.date-picker-popover').getByRole('grid')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const mobileCalendar = page.locator('.date-picker-popover')
  await expect
    .poll(async () => {
      const box = (await mobileCalendar.boundingBox())!
      return box.y >= 0 && box.y + box.height <= page.viewportSize()!.height
    })
    .toBe(true)
  await mobileCalendar.getByRole('button', { name: 'Hoje', exact: true }).scrollIntoViewIfNeeded()
  await expect(mobileCalendar.getByRole('button', { name: 'Hoje', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/deadline-calendar-mobile.png' })
  await mobileCalendar.getByRole('button', { name: 'Hoje', exact: true }).click()
  await expect(mobileCalendar).toHaveCount(0)
  expect(errors).toEqual([])
})

test('column catalog creates all six types and saves values, options and renamed headers', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Meu quadro flexível' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const task = await (
    await page.request.post('/api/tasks', {
      data: { boardId: board.id, groupId: group.id, title: 'Organizar minha entrega' },
    })
  ).json()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/#/board/' + board.id + '/table')
  const table = page.locator('[data-group-id="' + group.id + '"] .group-table-wrap > table')
  for (const [type, name] of [
    ['Status', 'Aprovação'],
    ['Texto', 'Notas'],
    ['Pessoas', 'Revisores'],
    ['Lista suspensa', 'Departamentos'],
    ['Data', 'Reunião'],
    ['Números', 'Estimativa'],
  ]) {
    await table
      .getByRole('button', { name: 'Adicionar coluna em Primeiros passos', exact: true })
      .click()
    const catalog = page.getByRole('dialog', { name: 'Tipos de coluna', exact: true })
    await expect(catalog.getByRole('button')).toHaveCount(12)
    await catalog.getByRole('button', { name: type, exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Nova coluna', exact: true })
    await expect(editor.getByRole('radio', { name: type, exact: true })).toBeChecked()
    await editor.getByLabel('Nome da coluna', { exact: true }).fill(name)
    await editor.getByRole('button', { name: 'Criar coluna', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(
      table.locator(':scope > thead').getByRole('columnheader', { name, exact: true }),
    ).toBeVisible()
  }
  const notes = page.getByLabel('Notas: Organizar minha entrega', { exact: true })
  await notes.fill('Revisar com o time')
  await notes.press('Enter')
  await expect(notes).toBeEnabled()
  const estimate = page.getByLabel('Estimativa: Organizar minha entrega', { exact: true })
  await estimate.fill('8.5')
  await estimate.press('Enter')
  await expect(estimate).toBeEnabled()
  await choose(page, 'Aprovação: Organizar minha entrega', 'Feito')
  await expect(page.getByLabel('Status: Organizar minha entrega', { exact: true })).toContainText(
    'Não iniciado',
  )
  await page
    .getByRole('button', { name: 'Revisores: Organizar minha entrega', exact: true })
    .click()
  let picker = page.locator('.assignee-popover')
  await picker.getByRole('checkbox', { name: 'Você', exact: true }).check()
  await expect(picker.getByRole('checkbox', { name: 'Você', exact: true })).toBeEnabled()
  await picker.getByRole('checkbox', { name: 'Ana Costa', exact: true }).check()
  await expect(picker.getByRole('checkbox', { name: 'Ana Costa', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Departamentos: Organizar minha entrega', exact: true })
    .click()
  const dropdown = page.locator('.custom-dropdown-popover')
  await dropdown.getByRole('checkbox', { name: 'Opção 1', exact: true }).check()
  await expect(dropdown.getByRole('checkbox', { name: 'Opção 1', exact: true })).toBeEnabled()
  await dropdown.getByRole('checkbox', { name: 'Opção 2', exact: true }).check()
  await expect(dropdown.getByRole('checkbox', { name: 'Opção 2', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(dropdown).toHaveCount(0)
  await page.getByRole('button', { name: 'Reunião: Organizar minha entrega', exact: true }).click()
  await page.locator('.date-picker-popover').getByLabel('Data', { exact: true }).fill('2030-08-10')
  await page
    .locator('.date-picker-popover')
    .getByRole('button', { name: 'Aplicar', exact: true })
    .click()
  await expect(page.locator('.date-picker-popover')).toHaveCount(0)
  await table
    .locator(':scope > thead')
    .getByRole('button', { name: 'Posição da coluna Aprovação', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Editar coluna', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Editar coluna', exact: true })
  await editor.getByLabel('Nome da coluna', { exact: true }).fill('Validação')
  await editor.getByLabel('Nome da opção 1', { exact: true }).fill('Aprovado')
  await page.screenshot({ path: 'test-results/column-editor.png' })
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await editor.getByRole('button', { name: 'Salvar coluna', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByLabel('Validação: Organizar minha entrega', { exact: true }),
  ).toContainText('Aprovado')
  await expect(notes).toHaveValue('Revisar com o time')
  await expect(estimate).toHaveValue('8.5')
  const final = await (await page.request.get('/api/workspace')).json()
  const columns = final.boards.find((b: { id: string }) => b.id === board.id).columns
  const values = final.tasks.find((t: { id: string }) => t.id === task.id).customValues
  const id = (name: string) => columns.find((c: { name: string }) => c.name === name).id
  expect(JSON.parse(values[id('Revisores')])).toEqual(['person-you', 'person-ana'])
  expect(JSON.parse(values[id('Departamentos')])).toEqual(['Opção 1', 'Opção 2'])
  expect(values[id('Reunião')]).toBe('2030-08-10')
  await page.screenshot({ path: 'test-results/flexible-columns.png' })
  expect(errors).toEqual([])
})

test('column editing preserves data on invalid conversions, supports deletion and independent subitem fields', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Editar minhas colunas' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const column = await (
    await page.request.post('/api/boards/' + board.id + '/columns', {
      data: { name: 'Observação', type: 'text' },
    })
  ).json()
  const task = await (
    await page.request.post('/api/tasks', {
      data: {
        boardId: board.id,
        groupId: group.id,
        title: 'Preservar informações',
        customValues: { [column.id]: 'Texto importante' },
      },
    })
  ).json()
  await page.goto('/#/board/' + board.id + '/table')
  const table = page.locator('[data-group-id="' + group.id + '"] .group-table-wrap > table')
  async function edit(name: string) {
    await table
      .locator(':scope > thead')
      .getByRole('button', { name: 'Posição da coluna ' + name, exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Editar coluna', exact: true }).click()
    return page.getByRole('dialog', { name: 'Editar coluna', exact: true })
  }
  let editor = await edit('Observação')
  await editor.getByRole('radio', { name: 'Números', exact: true }).check()
  await editor.getByRole('button', { name: 'Salvar coluna', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('números válidos')
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByLabel('Observação: Preservar informações', { exact: true })).toHaveValue(
    'Texto importante',
  )
  editor = await edit('Responsável')
  await editor.getByLabel('Nome da coluna', { exact: true }).fill('Equipe')
  await editor.getByRole('button', { name: 'Salvar coluna', exact: true }).click()
  await expect(
    table.locator(':scope > thead').getByRole('columnheader', { name: 'Equipe', exact: true }),
  ).toBeVisible()
  editor = await edit('Equipe')
  await editor.getByRole('button', { name: 'Ocultar coluna', exact: true }).click()
  await expect(
    table.locator(':scope > thead').getByRole('columnheader', { name: 'Equipe', exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Colunas', exact: true }).click()
  await page
    .locator('.columns-popover')
    .getByRole('checkbox', { name: 'Equipe', exact: true })
    .check()
  await expect(
    page.locator('.columns-popover').getByRole('checkbox', { name: 'Equipe', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Colunas', exact: true }).click()
  await expect(
    table.locator(':scope > thead').getByRole('columnheader', { name: 'Equipe', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Expandir subitens de Preservar informações', exact: true })
    .click()
  const panel = page.getByRole('region', { name: 'Subitens de Preservar informações', exact: true })
  await panel.getByRole('button', { name: 'Colunas dos subitens', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Texto', exact: true }).click()
  editor = page.getByRole('dialog', { name: 'Nova coluna', exact: true })
  await editor.getByLabel('Nome da coluna', { exact: true }).fill('Checklist')
  await editor.getByRole('button', { name: 'Criar coluna', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(panel.getByRole('columnheader', { name: 'Checklist', exact: true })).toBeVisible()
  await expect(
    table.locator(':scope > thead').getByRole('columnheader', { name: 'Checklist', exact: true }),
  ).toHaveCount(0)
  await panel.getByRole('textbox', { name: 'Nome do novo subitem' }).fill('Detalhar entrega')
  await panel.getByRole('textbox', { name: 'Nome do novo subitem' }).press('Enter')
  const checklist = panel.getByLabel('Checklist: Detalhar entrega', { exact: true })
  await checklist.fill('Confirmar acessos')
  await checklist.press('Enter')
  await expect(checklist).toBeEnabled()
  editor = await edit('Observação')
  await editor.getByRole('button', { name: 'Excluir coluna', exact: true }).click()
  await expect(
    editor.getByRole('group', { name: 'Confirmar exclusão da coluna', exact: true }),
  ).toBeVisible()
  await editor.getByRole('button', { name: 'Voltar', exact: true }).click()
  await expect(
    editor.getByRole('group', { name: 'Confirmar exclusão da coluna', exact: true }),
  ).toHaveCount(0)
  await editor.getByRole('button', { name: 'Excluir coluna', exact: true }).click()
  await editor.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByLabel('Título: Preservar informações', { exact: true })).toBeVisible()
  const final = await (await page.request.get('/api/workspace')).json()
  expect(
    final.tasks.find((t: { id: string }) => t.id === task.id).customValues[column.id],
  ).toBeUndefined()
  expect(
    Object.values(
      final.tasks.find((t: { title: string }) => t.title === 'Detalhar entrega').customValues,
    ),
  ).toContain('Confirmar acessos')
  await page.setViewportSize({ width: 375, height: 812 })
  await table
    .locator(':scope > thead')
    .getByRole('button', { name: 'Adicionar coluna em Primeiros passos', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: 'Tipos de coluna', exact: true })
    .getByRole('button', { name: 'Lista suspensa', exact: true })
    .click()
  editor = page.getByRole('dialog', { name: 'Nova coluna', exact: true })
  await expect(editor.getByLabel('Nome da coluna', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/column-editor-mobile.png' })
})

test('automations start empty, are managed by the user and move tasks only while active', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Meu fluxo de trabalho' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const original = state.groups.find(
    (group: { boardId: string; isCompleted: boolean }) =>
      group.boardId === board.id && !group.isCompleted,
  )
  const done = state.groups.find(
    (group: { boardId: string; isCompleted: boolean }) =>
      group.boardId === board.id && group.isCompleted,
  )
  const review = await (
    await page.request.post(`/api/boards/${board.id}/groups`, {
      data: { name: 'Revisão', color: '#a25ddc' },
    })
  ).json()
  for (const title of ['Publicar versão', 'Revisar acessos'])
    expect(
      (
        await page.request.post('/api/tasks', {
          data: { boardId: board.id, groupId: original.id, title },
        })
      ).status(),
    ).toBe(201)
  await page.goto(`/#/board/${board.id}/table`)
  await choose(page, 'Status: Publicar versão', 'Feito')
  await expect(
    page
      .locator(`[data-group-id="${original.id}"]`)
      .getByLabel('Status: Publicar versão', { exact: true }),
  ).toContainText('Feito')
  await page.getByRole('button', { name: 'Automação', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Seu quadro, suas regras.' })).toBeVisible()
  await page.getByRole('button', { name: 'Criar automação', exact: true }).click()
  let editor = page.getByRole('dialog', { name: 'Criar automação', exact: true })
  await choose(page, 'Quando mudar para', 'Feito')
  await choose(page, 'Mover para o grupo', done.name)
  await editor.getByLabel('Descrição (opcional)', { exact: true }).fill('Organizar nossas entregas')
  await editor.getByRole('button', { name: 'Criar automação', exact: true }).click()
  await expect(page.locator('.automation-card')).toHaveCount(1)
  await expect(page.getByRole('switch')).toBeChecked()
  await page.reload()
  await expect(page.locator('.automation-card')).toContainText('Organizar nossas entregas')
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((violation) => ({
      id: violation.id,
      first: violation.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.screenshot({ path: 'test-results/automations-desktop.png' })
  await page.getByRole('tab', { name: /Tabela principal/ }).click()
  await expect(
    page
      .locator(`[data-group-id="${original.id}"]`)
      .getByLabel('Status: Publicar versão', { exact: true }),
  ).toContainText('Feito')
  await choose(page, 'Status: Publicar versão', 'Em andamento')
  await choose(page, 'Status: Publicar versão', 'Feito')
  await expect(
    page
      .locator(`[data-group-id="${done.id}"]`)
      .getByLabel('Status: Publicar versão', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Automação', exact: true }).click()
  await page.getByRole('tab', { name: 'Histórico de execuções', exact: true }).click()
  await expect(page.locator('.automation-run')).toHaveCount(1)
  await expect(page.locator('.automation-run')).toContainText('Publicar versão')
  await page.getByRole('tab', { name: /Automações/ }).click()
  await page.getByRole('switch').click()
  await expect(page.getByRole('switch')).not.toBeChecked()
  await page.getByRole('tab', { name: /Tabela principal/ }).click()
  await choose(page, 'Status: Revisar acessos', 'Feito')
  await expect(
    page
      .locator(`[data-group-id="${original.id}"]`)
      .getByLabel('Status: Revisar acessos', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Automação', exact: true }).click()
  await page.getByRole('button', { name: 'Opções da automação: Feito', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Editar automação', exact: true }).click()
  editor = page.getByRole('dialog', { name: 'Editar automação', exact: true })
  await choose(page, 'Mover para o grupo', review.name)
  await editor.getByRole('button', { name: 'Salvar alterações', exact: true }).click()
  await expect(page.getByRole('switch')).not.toBeChecked()
  await expect(page.locator('.automation-sentence')).toContainText('Revisão')
  await page.getByRole('switch').click()
  await expect(page.getByRole('switch')).toBeChecked()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/automations-mobile.png', animations: 'disabled' })
  await page.getByRole('tab', { name: /Tabela principal/ }).click()
  await choose(page, 'Status: Revisar acessos', 'Em andamento')
  await choose(page, 'Status: Revisar acessos', 'Feito')
  await expect(
    page
      .locator(`[data-group-id="${review.id}"]`)
      .getByLabel('Status: Revisar acessos', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Automação', exact: true }).click()
  await page.getByRole('button', { name: 'Opções da automação: Feito', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Excluir automação', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Excluir automação', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Seu quadro, suas regras.' })).toBeVisible()
  await page.getByRole('tab', { name: 'Histórico de execuções', exact: true }).click()
  await expect(page.locator('.automation-run')).toHaveCount(2)
})

test('workspace dialogs and column menu support accessible navigation on desktop and mobile', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#/board/board-ti/table')
  const columns = page.getByRole('button', { name: 'Colunas', exact: true })
  await columns.click()
  await expect(page.getByRole('dialog', { name: 'Visibilidade das colunas' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Status', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(columns).toBeFocused()

  async function checkDialog(name: string, artifact: string) {
    const dialog = page.getByRole('dialog', { name, exact: true })
    await expect(dialog).toBeVisible()
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    await writeFile(`test-results/axe-${artifact}.json`, JSON.stringify(scan.violations, null, 2))
    expect(
      (await accessibilityFindings(page, scan)).map((v) => ({
        id: v.id,
        first: v.nodes[0]?.failureSummary,
      })),
    ).toEqual([])
    const box = (await dialog.boundingBox())!
    const viewport = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.height).toBeLessThanOrEqual(viewport.height)
    return dialog
  }

  await page.getByRole('button', { name: 'Abrir guia rápido', exact: true }).click()
  await checkDialog('Guia do QuadroOS', 'workspace-guide')
  await page.getByRole('button', { name: 'Importar meus dados', exact: true }).click()
  await checkDialog('Importar dados', 'workspace-import')
  await page.getByRole('tab', { name: 'monday.com', exact: true }).click()
  await expect(page.getByLabel('Token de acesso', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Histórico', exact: true }).click()
  await checkDialog('Importar dados', 'workspace-import-history')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Configurações do workspace', exact: true }).click()
  await checkDialog('Configurações do workspace', 'workspace-settings')
  await page.getByRole('button', { name: 'Conhecer o QuadroOS', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Guia do QuadroOS', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Notificações:/ }).click()
  await checkDialog('Notificações', 'workspace-notifications')
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: 'Abrir guia rápido', exact: true }).click()
  const guide = await checkDialog('Guia do QuadroOS', 'workspace-guide-mobile')
  await guide.getByRole('button', { name: 'Importar meus dados', exact: true }).click()
  await checkDialog('Importar dados', 'workspace-import-mobile')
  await page.keyboard.press('Escape')
  await columns.click()
  await expect(page.getByRole('dialog', { name: 'Visibilidade das colunas' })).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(columns).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('group summaries follow quick creation, show rich hover and keyboard details and stay aligned on mobile', async ({
  page,
  browser,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Resumo dos grupos' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const custom = await (
    await page.request.post(`/api/boards/${board.id}/columns`, {
      data: {
        name: 'Aprovação',
        type: 'status',
        options: [{ id: 'approved', label: 'Aprovado', color: '#00a86b' }],
      },
    })
  ).json()
  const first = await (
    await page.request.post('/api/tasks', {
      data: {
        boardId: board.id,
        groupId: group.id,
        title: 'Primeira entrega',
        status: 'Feito',
        priority: 'Alta',
        customValues: { [custom.id]: 'Aprovado' },
      },
    })
  ).json()
  await page.request.post('/api/tasks', {
    data: {
      boardId: board.id,
      groupId: group.id,
      title: 'Segunda entrega',
      status: 'Feito',
      priority: 'Alta',
    },
  })
  await page.request.post('/api/tasks', {
    data: {
      boardId: board.id,
      groupId: group.id,
      title: 'Terceira entrega',
      status: 'Parado',
      priority: 'Baixa',
    },
  })
  await page.request.post('/api/tasks', {
    data: {
      boardId: board.id,
      groupId: group.id,
      parentId: first.id,
      title: 'Subitem fora do total',
      status: 'Feito',
    },
  })
  await page.goto(`/#/board/${board.id}/table`)
  const section = page.locator(`[data-group-id="${group.id}"]`)
  const table = section.locator('.group-table-wrap > table')
  const summary = table.locator(':scope > tfoot .monday-summary-row')
  const creation = table.locator(':scope > tfoot .monday-add-row')
  const creationBox = (await creation.boundingBox())!,
    summaryBox = (await summary.boundingBox())!
  expect(summaryBox.y).toBeGreaterThanOrEqual(creationBox.y + creationBox.height)
  await expect(summary.locator('.title-cell')).toHaveText('3 itens')
  const statuses = summary.getByRole('group', { name: 'Distribuição de status', exact: true })
  const done = statuses.getByRole('button', { name: 'Feito: 2 itens (67%)', exact: true })
  const normal = (await done.boundingBox())!
  await done.hover()
  const tooltip = page.locator('.summary-tooltip:not([data-state="closed"])')
  await expect(tooltip.locator('.summary-tooltip-label > strong')).toHaveText('Feito')
  await expect(tooltip.locator('.summary-tooltip-count > strong')).toHaveText('2')
  await expect(tooltip.locator('.summary-tooltip-label > span')).toHaveText('67%')
  await expect
    .poll(async () => (await done.boundingBox())!.height)
    .toBeGreaterThan(normal.height * 1.2)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.screenshot({ path: 'test-results/group-summary.png', animations: 'disabled' })
  const priority = summary.getByRole('group', { name: 'Distribuição de prioridade', exact: true })
  await priority.getByRole('button', { name: 'Alta: 2 itens (67%)', exact: true }).hover()
  await expect(tooltip.locator('.summary-tooltip-label > strong')).toHaveText('Alta')
  const approval = summary.getByRole('group', { name: 'Distribuição de Aprovação', exact: true })
  await approval.getByRole('button', { name: 'Sem etiqueta: 2 itens (67%)', exact: true }).hover()
  await expect(tooltip.locator('.summary-tooltip-label > strong')).toHaveText('Sem etiqueta')
  await page.mouse.move(0, 0)
  await choose(page, 'Status: Primeira entrega', 'Parado')
  await expect(
    statuses.getByRole('button', { name: 'Parado: 2 itens (67%)', exact: true }),
  ).toBeVisible()
  const quick = section.getByRole('textbox', { name: 'Novo item em Primeiros passos', exact: true })
  await quick.fill('Criada abaixo das tarefas')
  await quick.press('Enter')
  await expect(
    section.getByLabel('Título: Criada abaixo das tarefas', { exact: true }),
  ).toBeVisible()
  await expect(summary.locator('.title-cell')).toHaveText('4 itens')
  await expect(
    statuses.getByRole('button', { name: 'Não iniciado: 1 item (25%)', exact: true }),
  ).toBeVisible()
  const empty = page
    .locator('.task-group')
    .filter({ has: page.getByRole('heading', { name: 'Concluídas', exact: true }) })
  await expect(empty.locator('.monday-add-row')).toBeVisible()
  await expect(empty.locator('.monday-summary-row')).toHaveCount(0)
  await page.setViewportSize({ width: 375, height: 812 })
  await section.getByRole('button', { name: 'Abrir formulário', exact: true }).focus()
  await page.keyboard.press('Tab')
  const focused = statuses.getByRole('button').first()
  await expect(focused).toBeFocused()
  await expect(tooltip).toBeVisible()
  const bounds = (await tooltip.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375)
  const head = (await table.locator(':scope > thead .status-cell').boundingBox())!
  const foot = (await summary.locator('.status-cell').boundingBox())!
  expect(Math.abs(head.x - foot.x)).toBeLessThan(1)
  expect(Math.abs(head.width - foot.width)).toBeLessThan(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/group-summary-mobile.png', animations: 'disabled' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(
    await focused.evaluate((element) =>
      Math.max(
        ...getComputedStyle(element)
          .transitionDuration.split(',')
          .map((value) => parseFloat(value)),
      ),
    ),
  ).toBeLessThanOrEqual(0.001)
  const touch = await browser.newContext({ hasTouch: true, viewport: { width: 375, height: 812 } })
  try {
    const touchPage = await touch.newPage()
    await touchPage.goto(page.url())
    const segment = touchPage
      .locator(
        `[data-group-id="${group.id}"] .monday-summary-row .status-cell .monday-summary-segment`,
      )
      .first()
    await segment.tap()
    await expect(touchPage.locator('.summary-tooltip:not([data-state="closed"])')).toBeVisible()
    await segment.tap()
    await expect(touchPage.locator('.summary-tooltip:not([data-state="closed"])')).toHaveCount(0)
  } finally {
    await touch.close()
  }
})

test('formula columns calculate parents and subitems, recalculate edited numbers and retain references after renaming', async ({
  page,
}) => {
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Cálculos do quadro' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const qty = await (
    await page.request.post(`/api/boards/${board.id}/columns`, {
      data: { name: 'Quantidade', type: 'number' },
    })
  ).json()
  const price = await (
    await page.request.post(`/api/boards/${board.id}/columns`, {
      data: { name: 'Preço', type: 'number' },
    })
  ).json()
  const parent = await (
    await page.request.post('/api/tasks', {
      data: {
        boardId: board.id,
        groupId: group.id,
        title: 'Calcular proposta',
        customValues: { [qty.id]: '3', [price.id]: '12.5' },
      },
    })
  ).json()
  await page.request.post('/api/tasks', {
    data: {
      boardId: board.id,
      groupId: group.id,
      parentId: parent.id,
      title: 'Etapa de cálculo',
      customValues: { [qty.id]: '2', [price.id]: '8' },
    },
  })
  await page.goto(`/#/board/${board.id}/table`)
  const table = page.locator(`[data-group-id="${group.id}"] .group-table-wrap > table`)
  await table
    .getByRole('button', { name: 'Adicionar coluna em Primeiros passos', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Tipos de coluna' }).getByRole('button'),
  ).toHaveCount(12)
  await page.getByRole('button', { name: 'Fórmula', exact: true }).click()
  let editor = page.getByRole('dialog', { name: 'Nova coluna', exact: true })
  await editor.getByLabel('Nome da coluna', { exact: true }).fill('Total')
  await editor.getByLabel('Expressão da fórmula', { exact: true }).fill('SOMA(')
  await expect(editor.getByRole('button', { name: 'Criar coluna', exact: true })).toBeDisabled()
  await editor
    .getByLabel('Expressão da fórmula', { exact: true })
    .fill('ARRED({Quantidade} * {Preço}; 2)')
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, axe)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.screenshot({ path: 'test-results/formula-editor.png' })
  await editor.getByRole('button', { name: 'Criar coluna', exact: true }).click()
  await expect(page.getByLabel('Total: Calcular proposta', { exact: true })).toHaveText('37,5')
  const quantity = page.getByLabel('Quantidade: Calcular proposta', { exact: true })
  await quantity.fill('4')
  await quantity.press('Enter')
  await expect(page.getByLabel('Total: Calcular proposta', { exact: true })).toHaveText('50')
  await table
    .locator(':scope > thead')
    .getByRole('button', { name: 'Posição da coluna Quantidade', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Editar coluna', exact: true }).click()
  editor = page.getByRole('dialog', { name: 'Editar coluna', exact: true })
  await editor.getByLabel('Nome da coluna', { exact: true }).fill('Unidades')
  await editor.getByRole('button', { name: 'Salvar coluna', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(page.getByLabel('Total: Calcular proposta', { exact: true })).toHaveText('50')
  await table
    .locator(':scope > thead')
    .getByRole('button', { name: 'Posição da coluna Total', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Editar coluna', exact: true }).click()
  await expect(editor.getByLabel('Expressão da fórmula', { exact: true })).toHaveValue(
    /\{Unidades\}/,
  )
  await editor
    .getByLabel('Expressão da fórmula', { exact: true })
    .fill('ARRED({Unidades} * {Preço} * 1.1; 2)')
  await editor.getByRole('button', { name: 'Salvar coluna', exact: true }).click()
  await expect(page.getByLabel('Total: Calcular proposta', { exact: true })).toHaveText('55')
  await page
    .getByRole('button', { name: 'Expandir subitens de Calcular proposta', exact: true })
    .click()
  const subitems = page.getByRole('region', { name: 'Subitens de Calcular proposta', exact: true })
  await subitems.getByRole('button', { name: 'Colunas dos subitens', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Total', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(subitems.getByLabel('Total: Etapa de cálculo', { exact: true })).toHaveText('17,6')
  await page.reload()
  await expect(page.getByLabel('Total: Calcular proposta', { exact: true })).toHaveText('55')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  await page.getByRole('button', { name: 'Calcular proposta', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByLabel('Total: Calcular proposta', { exact: true }),
  ).toHaveText('55')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('file columns upload, download and delete files, persist after reload and work in subitems and mobile drawers', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const board = await (
    await page.request.post('/api/boards', { data: { name: 'Documentos da equipe' } })
  ).json()
  const state = await (await page.request.get('/api/workspace')).json()
  const group = state.groups.find(
    (g: { boardId: string; isCompleted: boolean }) => g.boardId === board.id && !g.isCompleted,
  )
  const parent = await (
    await page.request.post('/api/tasks', {
      data: { boardId: board.id, groupId: group.id, title: 'Anexar documentos' },
    })
  ).json()
  await page.request.post('/api/tasks', {
    data: {
      boardId: board.id,
      groupId: group.id,
      parentId: parent.id,
      title: 'Documentos do subitem',
    },
  })
  await page.goto(`/#/board/${board.id}/table`)
  await page
    .getByRole('button', { name: 'Adicionar coluna em Primeiros passos', exact: true })
    .click()
  await page.getByRole('button', { name: 'Arquivos', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Nova coluna', exact: true })
  await editor.getByLabel('Nome da coluna', { exact: true }).fill('Anexos')
  await editor.getByRole('button', { name: 'Criar coluna', exact: true }).click()
  await page.getByRole('button', { name: 'Anexos: Anexar documentos', exact: true }).click()
  let popover = page.getByRole('dialog', { name: 'Arquivos em Anexos', exact: true })
  await popover.getByLabel('Adicionar arquivos em Anexos', { exact: true }).setInputFiles([
    { name: 'contrato.txt', mimeType: 'text/plain', buffer: Buffer.from('Contrato de exemplo') },
    {
      name: 'especificação.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Detalhes da entrega'),
    },
  ])
  await expect(popover.getByRole('link', { name: /contrato.txt/ })).toBeVisible()
  await expect(popover.getByRole('link', { name: /especificação.txt/ })).toBeVisible()
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(
    (await accessibilityFindings(page, scan)).map((v) => ({
      id: v.id,
      first: v.nodes[0]?.failureSummary,
    })),
  ).toEqual([])
  await page.screenshot({ path: 'test-results/files-column.png' })
  const downloadReady = page.waitForEvent('download')
  await popover.getByRole('link', { name: /contrato.txt/ }).click()
  const download = await downloadReady
  expect(download.suggestedFilename()).toBe('contrato.txt')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toBe('Contrato de exemplo')
  await popover.getByLabel('Adicionar arquivos em Anexos', { exact: true }).setInputFiles({
    name: 'grande.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  })
  await expect(popover.getByRole('alert')).toContainText('até 5 MB')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Anexos: Anexar documentos', exact: true }),
  ).toContainText('2 arquivos')
  await page
    .getByRole('button', { name: 'Expandir subitens de Anexar documentos', exact: true })
    .click()
  const subitems = page.getByRole('region', { name: 'Subitens de Anexar documentos', exact: true })
  await subitems.getByRole('button', { name: 'Colunas dos subitens', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Anexos', exact: true }).click()
  await page.keyboard.press('Escape')
  await subitems.getByRole('button', { name: 'Anexos: Documentos do subitem', exact: true }).click()
  popover = page.getByRole('dialog', { name: 'Arquivos em Anexos', exact: true })
  await popover.getByLabel('Adicionar arquivos em Anexos', { exact: true }).setInputFiles({
    name: 'subitem.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Arquivo independente'),
  })
  await expect(popover.getByRole('link', { name: /subitem.txt/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Anexos: Anexar documentos', exact: true }),
  ).toContainText('2 arquivos')
  await page.getByRole('button', { name: 'Anexos: Anexar documentos', exact: true }).click()
  await popover.getByRole('button', { name: 'Excluir contrato.txt', exact: true }).click()
  await popover.getByRole('button', { name: 'Excluir arquivo', exact: true }).click()
  await expect(popover.getByRole('link', { name: /contrato.txt/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  await page.getByRole('button', { name: 'Anexar documentos', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Anexos: Anexar documentos', exact: true })
    .click()
  await expect(popover.getByRole('link', { name: /especificação.txt/ })).toBeVisible()
  const bounds = (await popover.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'test-results/files-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Detalhes da tarefa', exact: true })).toBeVisible()
})

test.describe('modern form controls', () => {
  test.use({ hasTouch: true })
  test('modern selectors support keyboard, pointer and touch inside task forms without submitting early', async ({
    page,
  }) => {
    const board = await (
      await page.request.post('/api/boards', { data: { name: 'Seletores do quadro' } })
    ).json()
    const review = await (
      await page.request.post(`/api/boards/${board.id}/groups`, {
        data: { name: 'Revisão da equipe', color: '#a25ddc' },
      })
    ).json()
    await page.goto(`/#/board/${board.id}/table`)
    await page.getByRole('button', { name: 'Novo item', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nova tarefa', exact: true })
    const group = dialog.getByRole('combobox', { name: 'Grupo da nova tarefa', exact: true })
    await group.focus()
    await group.press('Space')
    await expect(page.getByRole('option', { name: 'Primeiros passos', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('option', { name: review.name, exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(group).toContainText(review.name)
    await expect(dialog).toBeVisible()
    await group.click()
    await page.getByRole('option', { name: 'Concluídas', exact: true }).hover()
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(
      (await accessibilityFindings(page, axe)).map((v) => ({
        id: v.id,
        first: v.nodes[0]?.failureSummary,
      })),
    ).toEqual([])
    await page.screenshot({ path: 'test-results/modern-selectors.png', animations: 'disabled' })
    await page.getByRole('option', { name: 'Concluídas', exact: true }).click()
    await expect(group).toHaveCSS('outline-style', 'none')
    await expect(
      dialog.getByRole('combobox', { name: 'Status da nova tarefa', exact: true }),
    ).toContainText('Não iniciado')
    await dialog.getByLabel('O que precisa acontecer?').fill('Escolher meu grupo')
    await dialog.getByRole('button', { name: 'Criar tarefa', exact: true }).click()
    await expect(
      page
        .locator('.task-group')
        .filter({ has: page.getByRole('heading', { name: 'Concluídas', exact: true }) })
        .getByLabel('Título: Escolher meu grupo', { exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'Novo item', exact: true }).click()
    await group.tap()
    const menu = page.locator('.field-select-menu')
    await expect(menu).toBeVisible()
    const bounds = (await menu.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(375)
    await page.getByRole('option', { name: review.name, exact: true }).tap()
    await expect(group).toContainText(review.name)
    await group.click()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(group).toBeFocused()
    await page.screenshot({ path: 'test-results/modern-form-mobile.png', animations: 'disabled' })
  })
})
