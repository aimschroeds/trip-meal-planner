import { expect, test, type Page } from '@playwright/test'

// Guards the gear library's category management (rename a whole category, and
// drag a row onto another category to reclassify it) including that both persist
// across a reload. Native HTML5 drag-and-drop can't be driven by Playwright's
// mouse, so the drop is dispatched manually — the app reads the dragged id from
// a ref, so this exercises the real handler without relying on drag payloads.

const openGear = (page: Page) => page.getByRole('button', { name: 'Gear', exact: true }).click()

async function addGear(page: Page, name: string, category: string) {
  // Every tab stays mounted (just hidden), so the Food/Meals "Name" inputs are
  // also in the DOM — use getByRole, which ignores hidden elements, to target
  // the visible Gear form.
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await page.getByLabel('Category').fill(category)
  await page.getByLabel('Total g').fill('100')
  await page.getByRole('button', { name: 'Add to gear' }).click()
}

test('rename a category and reclassify by drag — both persist', async ({ page }) => {
  await page.goto('/')
  await openGear(page)
  await addGear(page, 'Tent', 'shelter')
  await addGear(page, 'Map', 'navigation')
  await expect(page.getByRole('heading', { name: 'Navigation' })).toBeVisible()

  // Rename the category → moves every item under it.
  await page
    .getByRole('heading', { name: 'Navigation' })
    .locator('..')
    .getByRole('button', { name: 'rename' })
    .click()
  await page.locator(':focus').fill('Papers')
  await page.getByRole('button', { name: 'save' }).click()
  await expect(page.getByRole('heading', { name: 'Papers' })).toBeVisible()

  // Sticks across a reload.
  await page.reload()
  await openGear(page)
  await expect(page.getByRole('heading', { name: 'Papers' })).toBeVisible()

  // Drag 'Map' onto the Shelter group (manual HTML5 DnD dispatch).
  await page.evaluate(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const g = globalThis as any
    const row = [...g.document.querySelectorAll('tr')].find((r: any) => r.textContent?.includes('Map'))
    const header = [...g.document.querySelectorAll('h3')].find((h: any) =>
      h.textContent?.startsWith('Shelter'),
    )
    const target = header?.closest('div')?.parentElement
    if (!row || !target) throw new Error('drag elements not found')
    const dt = new g.DataTransfer()
    const fire = (el: any, type: string) =>
      el.dispatchEvent(new g.DragEvent(type, { bubbles: true, dataTransfer: dt }))
    fire(row, 'dragstart')
    fire(target, 'dragover')
    fire(target, 'drop')
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })
  const shelterGroup = page.getByRole('heading', { name: 'Shelter' }).locator('../..')
  await expect(shelterGroup.locator('tr', { hasText: 'Map' })).toBeVisible()

  // Reclassification sticks across a reload too.
  await page.reload()
  await openGear(page)
  await expect(
    page.getByRole('heading', { name: 'Shelter' }).locator('../..').locator('tr', { hasText: 'Map' }),
  ).toBeVisible()
})
