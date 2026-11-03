import { test, expect } from '@playwright/test'

test('a press that starts in a field and ends over the backdrop keeps the dialog open', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar dados' })
  await page.getByRole('tab', { name: 'monday.com', exact: true }).click()
  const field = page.getByLabel('Token de acesso', { exact: true })
  await field.fill('synthetic-token-only')

  // Selecting the pasted token with the mouse and releasing outside the panel.
  const fieldBox = (await field.boundingBox())!
  const dialogBox = (await dialog.boundingBox())!
  await page.mouse.move(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dialogBox.x + dialogBox.width + 40, fieldBox.y + fieldBox.height / 2)
  await page.mouse.up()
  await expect(dialog).toBeVisible()
  await expect(field).toHaveValue('synthetic-token-only')

  // A click that starts and ends on the backdrop still closes the dialog.
  await page.mouse.click(dialogBox.x + dialogBox.width + 40, dialogBox.y + 20)
  await expect(dialog).toBeHidden()
})
