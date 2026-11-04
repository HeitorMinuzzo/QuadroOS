import { test, expect } from '@playwright/test'

test('imports all accessible Monday boards from one action and reports per-board failures', async ({
  page,
}) => {
  let interruptNextPoll = false
  await page.route('**/api/monday/batch', (route) => {
    if (route.request().method() === 'POST') interruptNextPoll = true
    else if (interruptNextPoll) {
      interruptNextPoll = false
      return route.fulfill({ status: 502, body: 'Bad Gateway' })
    }
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  await page.getByRole('tab', { name: 'monday.com' }).click()
  await page.getByLabel('Token de acesso').fill('synthetic-batch-token')
  await page.getByRole('button', { name: 'Buscar meus quadros' }).click()
  await page.getByRole('button', { name: 'Importar todos os quadros (3)', exact: true }).click()
  const batch = page.getByRole('region', { name: 'Importação em lote do Monday' })
  await expect(batch.getByRole('alert')).toContainText('O servidor está indisponível')
  await expect(batch.getByRole('heading', { name: 'Importação concluída' })).toBeVisible()
  await expect(batch.getByRole('status')).toContainText('3 de 3 quadros processados · 1 com falha')
  await expect(batch.getByRole('link', { name: 'Baixar relatório' })).toHaveCount(2)
  await expect(batch.getByText('Lote - Falha', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click()
  const folders = page.getByRole('navigation', { name: 'Pastas importadas do Monday' })
  // Folders start closed unless they lead to the open board.
  await folders.getByRole('button', { name: 'TI', exact: true }).click()
  await folders.getByRole('button', { name: 'Infraestrutura', exact: true }).click()
  await expect(
    folders.getByRole('button', { name: 'Lote - Infraestrutura', exact: true }),
  ).toBeVisible()
  await expect(
    folders.getByRole('button', { name: 'Lote - Quadro vazio', exact: true }),
  ).toBeVisible()
})
