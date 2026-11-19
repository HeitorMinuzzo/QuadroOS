import { test, expect } from '@playwright/test'

test('opening the site, or a link to a board that does not exist, starts on Início', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meu espaço')
  await expect(page.locator('.group-table-wrap')).toHaveCount(0)

  await page.goto('/#/board/quadro-que-nao-existe/table')
  await expect(page).toHaveURL(/#\/workspace$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meu espaço')

  // A real board link still opens that board.
  await page.goto('/#/board/board-ti/table')
  await expect(page.getByRole('heading', { name: 'Assuntos de TI', exact: true })).toBeVisible()
})
