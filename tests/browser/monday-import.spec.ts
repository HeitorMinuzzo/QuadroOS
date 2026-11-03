import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { previewMonday } from '../../server/monday'
import { mondayFixture } from '../fixtures/monday'

test('monday import shows source types and palettes, imports editable cells and fits on mobile', async ({
  page,
}) => {
  const preview = await previewMonday('simulated-token-only', '900', async (_url, init) => {
    const query = JSON.parse(init!.body as string).query as string
    return new Response(
      JSON.stringify({
        data: query.includes('users(')
          ? { users: [{ id: '42', name: 'Você', email: 'voce@quadro.local' }] }
          : { boards: [mondayFixture()] },
      }),
    )
  })
  await page.route('**/api/monday/boards', (route) =>
    route.fulfill({ json: [{ id: '900', name: preview.name }] }),
  )
  await page.route('**/api/monday/preview', (route) => route.fulfill({ json: preview }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  await page.getByRole('tab', { name: 'monday.com' }).click()
  await page.getByLabel('Token de acesso').fill('simulated-token-only')
  await page.getByRole('button', { name: 'Buscar meus quadros' }).click()
  await page.getByRole('button', { name: 'Preparar importação' }).click()
  const modal = page.getByRole('dialog', { name: 'Importar dados' })
  const sector = modal
    .locator('.mapping-row')
    .filter({ has: page.locator('strong', { hasText: /^SETOR$/ }) })
  await expect(sector.locator('.import-column-type')).toHaveText('Status · 3 etiquetas')
  await expect(sector.getByRole('combobox')).toHaveText('Manter tipo: Status')
  await expect(sector.getByLabel('Etiquetas de SETOR')).toContainText('PCP')
  await expect(modal.getByRole('checkbox', { name: /Preservar os responsáveis/ })).toBeChecked()
  await expect(modal.getByText('monday-person:42', { exact: true })).toHaveCount(0)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(axe.violations.map((v) => ({ id: v.id, first: v.nodes[0]?.failureSummary }))).toEqual([])
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(sector.getByRole('combobox')).toBeVisible()
  await sector.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Manter tipo: Status', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await modal.screenshot({ path: test.info().outputPath('monday-mapeamento.png') })
  const applying = page.waitForRequest((request) => request.url().endsWith('/api/imports/apply'))
  await page.getByRole('button', { name: 'Importar 2 tarefas', exact: true }).click()
  expect((await applying).postData()).not.toContain('simulated-token-only')
  await expect(page.getByText('2 tarefas importadas', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir meu quadro', exact: true }).click()
  const cell = page.getByRole('combobox', { name: 'SETOR: Demanda de teste 1', exact: true })
  await expect(cell).toHaveText('FISCAL')
  await expect(cell).toHaveCSS('background-color', 'rgb(156, 211, 38)')
  await cell.click()
  await page.getByRole('option', { name: 'PCP', exact: true }).click()
  await expect(cell).toHaveText('PCP')
  await page.reload()
  await expect(cell).toHaveText('PCP')
  const state = await (await page.request.get('/api/workspace')).json()
  const board = state.boards.find((b: { name: string }) => b.name === preview.name)
  expect(board.columns.find((c: { name: string }) => c.name === 'SETOR').type).toBe('status')
  expect(board.columns.find((c: { name: string }) => c.name === 'Áreas').type).toBe('dropdown')
  await page.screenshot({ path: test.info().outputPath('monday-importado.png'), fullPage: true })
})
