import { expect, test, type Page } from '@playwright/test'

// The PLAN.md §7 happy path: create trip → add person → import items CSV →
// compose a meal → generate a day → check totals. Everything else is covered
// by unit tests; this only proves the layers are wired together.

const ITEMS_CSV = `name,weight_g,calories,vegetarian
Oats,100,380,true
Butter,100,720,true
Tortilla,100,330,true
Cheese,100,400,true
Pasta,100,360,true
Pesto,100,460,true
Trail mix,100,450,true
Chocolate,100,530,true`

// Lunch/dinner/snack meals so generation can fill a whole day; brekkie is
// composed by hand in the test to exercise the meal composer.
const MEALS_CSV = `meal_name,meal_type,item_name,quantity_g
Wrap,lunch,Tortilla,150
Wrap,lunch,Cheese,50
Pasta night,dinner,Pasta,180
Pasta night,dinner,Pesto,40
Trail mix bag,snack,Trail mix,60
Choc bar,snack,Chocolate,50`

async function importCsv(page: Page, name: string, content: string) {
  await page.getByText('Import / export CSV').click()
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(content),
  })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
}

test('plan a day end to end', async ({ page }) => {
  await page.goto('/')

  // Import the item library from CSV.
  await page.getByRole('button', { name: 'Items' }).click()
  await importCsv(page, 'items.csv', ITEMS_CSV)
  await expect(page.getByRole('cell', { name: 'Oats', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '3.80 cal/g' })).toBeVisible()

  // Compose a brekkie by hand: 100 g oats + 20 g butter = 524 cal.
  await page.getByRole('button', { name: 'Meals' }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Porridge')
  // The item picker is a searchable combobox (type to filter, click the
  // option). Target the just-added (last) row's picker by its placeholder.
  const pickItem = async (name: string) => {
    const box = page.getByPlaceholder('— pick item —').last()
    await box.click()
    await box.fill(name)
    await page.getByRole('button', { name, exact: true }).click()
  }
  // Rapid entry: picking an item in the last row auto-appends a fresh row, so
  // we just pick both, then set grams (oats=0, butter=1; a trailing empty row
  // is row 2 and is ignored on save).
  await page.getByRole('button', { name: '+ add item' }).click()
  await pickItem('Oats')
  await pickItem('Butter')
  await page.getByPlaceholder('g', { exact: true }).nth(0).fill('100')
  await page.getByPlaceholder('g', { exact: true }).nth(1).fill('20')
  await expect(page.getByText('120 g · 524 cal')).toBeVisible()
  await page.getByRole('button', { name: 'Add to library' }).click()
  await expect(page.getByRole('cell', { name: 'Porridge' })).toBeVisible()

  // Fill the rest of the library from the meals CSV.
  await importCsv(page, 'meals.csv', MEALS_CSV)
  await expect(page.getByRole('cell', { name: 'Pasta night' })).toBeVisible()

  // Create a trip and add a person.
  await page.getByRole('button', { name: 'Trips' }).click()
  await page.getByLabel('Trip name').fill('GR20 smoke')
  await page.getByLabel('Days').fill('3')
  await page.getByRole('button', { name: 'Create trip' }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Alice')
  await page.getByLabel('Baseline cal/day').fill('2500')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByText('Alice')).toBeVisible()
  // Baseline is now an editable field (commits on blur) showing the value.
  await expect(page.getByLabel('cal/day baseline')).toHaveValue('2500')

  // Generate day 1 and check the totals land on target.
  await page.getByRole('button', { name: 'plan', exact: true }).click()
  await page.getByRole('button', { name: '✨ generate', exact: true }).first().click()
  await expect(page.getByText('on target')).toBeVisible()

  // Day 1 slots are all filled: brekkie can only be the hand-composed meal,
  // which appears as a part (a list item) in the slot — not the same as the
  // "add meal" picker's <option> for it (Epic 13: slots hold a list of parts).
  const day1 = page.locator('section', { hasText: 'Day 1' }).first()
  await expect(day1.getByRole('listitem').filter({ hasText: 'Porridge' })).toBeVisible()

  // The carries table aggregates the generated day into real weight/calories.
  const tripRow = page.getByRole('row').filter({ hasText: 'Trip' })
  await expect(tripRow).toContainText(/\d{3,} cal/)
  await expect(tripRow).toContainText(/\d{3,} g/)
})
