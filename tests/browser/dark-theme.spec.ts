import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function contrastViolations(page: Page) {
  // Measure what settles on screen, not a frame of a screen fading in.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  // Label pills keep white text on the board's own colours in both themes, by request; the
  // light theme's accessibility checks make the same exception.
  const result = await new AxeBuilder({ page })
    .withRules(['color-contrast'])
    .exclude('.monday-choice-trigger')
    .exclude('.monday-choice-option')
    .exclude('.monday-badge')
    .exclude('.automation-label')
    .analyze()
  return result.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${node.target.join(' ')} — ${node.failureSummary}`),
  )
}

test('light is the default theme and the dark theme persists without a light flash', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Usar tema escuro', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // The saved theme is applied by the head script, before the app renders.
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Configurações do workspace', exact: true }).click()
  await page.getByRole('radio', { name: 'Claro', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('quadroos:theme'))).toBeNull()
})

test('dark theme keeps readable contrast on the board, overview, details and dialogs', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('quadroos:theme', 'dark'))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await contrastViolations(page)).toEqual([])

  await page.getByRole('tab', { name: /Visão geral/ }).click()
  expect(await contrastViolations(page)).toEqual([])
  await page.getByRole('tab', { name: /Kanban/ }).click()
  expect(await contrastViolations(page)).toEqual([])
  await page.getByRole('tab', { name: /Calendário/ }).click()
  expect(await contrastViolations(page)).toEqual([])
  await page.getByRole('button', { name: 'Automação', exact: true }).first().click()
  expect(await contrastViolations(page)).toEqual([])
  await page.getByRole('tab', { name: /Tabela principal/ }).click()
  await page
    .getByRole('button', { name: /^Expandir subitens de/ })
    .first()
    .click()
  expect(await contrastViolations(page)).toEqual([])

  await page
    .getByRole('button', { name: /^Mais detalhes:/ })
    .first()
    .click()
  const details = page.getByRole('dialog')
  await expect(details).toBeVisible()
  expect(await contrastViolations(page)).toEqual([])
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Configurações do workspace', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Escuro', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(await contrastViolations(page)).toEqual([])
  await page.keyboard.press('Escape')

  await page
    .getByRole('navigation', { name: 'Meu workspace', exact: true })
    .getByRole('button', { name: 'Início', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Meu espaço', exact: true })).toBeVisible()
  expect(await contrastViolations(page)).toEqual([])
  await page
    .getByRole('navigation', { name: 'Meu workspace', exact: true })
    .getByRole('button', { name: /Meu trabalho/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Meu trabalho', exact: true })).toBeVisible()
  expect(await contrastViolations(page)).toEqual([])
  await page.getByRole('button', { name: 'Novo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Importar dados', exact: true }).click()
  await page.getByRole('tab', { name: 'monday.com', exact: true }).click()
  expect(await contrastViolations(page)).toEqual([])
})
