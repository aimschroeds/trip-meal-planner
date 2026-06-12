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
  await page.getByLabel('Name').fill('Porridge')
  await page.getByRole('button', { name: '+ add item' }).click()
  await page.getByRole('combobox').filter({ hasText: '— pick item —' }).selectOption({ label: 'Oats' })
  await page.getByPlaceholder('g', { exact: true }).fill('100')
  await page.getByRole('button', { name: '+ add item' }).click()
  await page.getByRole('combobox').filter({ hasText: '— pick item —' }).selectOption({ label: 'Butter' })
  await page.getByPlaceholder('g', { exact: true }).last().fill('20')
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
  await page.getByLabel('Name').fill('Alice')
  await page.getByLabel('Baseline cal/day').fill('2500')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByText('2500 cal/day baseline')).toBeVisible()

  // Generate day 1 and check the totals land on target.
  await page.getByRole('button', { name: 'plan', exact: true }).click()
  await page.getByRole('button', { name: '✨ generate', exact: true }).first().click()
  await expect(page.getByText('on target')).toBeVisible()

  // Day 1 slots are all filled: brekkie can only be the hand-composed meal.
  const day1 = page.locator('section', { hasText: 'Day 1' }).first()
  await expect(day1.getByRole('combobox').first()).toHaveValue(/.+/)

  // The carries table aggregates the generated day into real weight/calories.
  const tripRow = page.getByRole('row').filter({ hasText: 'Trip' })
  await expect(tripRow).toContainText(/\d{3,} cal/)
  await expect(tripRow).toContainText(/\d{3,} g/)
})
