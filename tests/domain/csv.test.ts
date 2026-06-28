import { describe, expect, it } from 'vitest'
import {
  itemsToCsv,
  parseItemsCsv,
  planItemImport,
} from '../../src/domain/csv/items'
import {
  mealsToCsv,
  parseMealsCsv,
  planMealImport,
} from '../../src/domain/csv/meals'
import type { Item, Meal } from '../../src/domain/types'

const butter: Item = {
  id: 'butter',
  name: 'Butter',
  caloriesPerGram: 7.2,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 720,
}

describe('parseItemsCsv', () => {
  it('parses valid rows and reports bad rows with line numbers (story 4.8)', () => {
    const csv = [
      'name,weight_g,calories,vegetarian',
      'Oatmeal,100,380,true',
      ',100,380,true',
      'Bad weight,zero,380,yes',
      'Bad cal,100,-5,no',
      'Bad veg,100,380,maybe',
      'Jerky,50,150,no',
    ].join('\n')

    const { rows, issues } = parseItemsCsv(csv)
    expect(rows.map((r) => r.fields.name)).toEqual(['Oatmeal', 'Jerky'])
    expect(rows[1].fields.vegetarian).toBe(false)
    expect(issues).toEqual([
      { line: 3, reason: 'missing name' },
      { line: 4, reason: 'weight_g must be a positive number, got "zero"' },
      { line: 5, reason: 'calories must be a non-negative number, got "-5"' },
      { line: 6, reason: 'vegetarian must be true/false, got "maybe"' },
    ])
  })

  it('rejects a file missing required columns', () => {
    const { rows, issues } = parseItemsCsv('name,calories\nOats,380')
    expect(rows).toHaveLength(0)
    expect(issues[0].reason).toContain('weight_g')
  })
})

describe('planItemImport duplicate handling', () => {
  const rows = parseItemsCsv(
    'name,weight_g,calories,vegetarian\nButter,100,740,true\nButter,100,750,true\nNew,10,50,true',
  ).rows

  it('skip keeps the library version and drops in-file duplicates', () => {
    const plan = planItemImport(rows, [butter], 'skip')
    expect(plan.creates.map((c) => c.name)).toEqual(['New'])
    expect(plan.updates).toHaveLength(0)
    expect(plan.skipped.map((s) => s.line)).toEqual([2, 3])
  })

  it('update overwrites the existing item, last in-file row winning', () => {
    const plan = planItemImport(rows, [butter], 'update')
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0].item.id).toBe('butter')
    expect(plan.updates[0].fields.calories).toBe(750)
    expect(plan.creates.map((c) => c.name)).toEqual(['New'])
  })

  it('copy imports duplicates under unique names', () => {
    const plan = planItemImport(rows, [butter], 'copy')
    expect(plan.creates.map((c) => c.name)).toEqual(['Butter (copy)', 'Butter (copy 2)', 'New'])
  })
})

describe('items CSV round-trip', () => {
  it('export → import reproduces the entry values losslessly (story 4.10)', () => {
    const csv = itemsToCsv([butter])
    const { rows, issues } = parseItemsCsv(csv)
    expect(issues).toHaveLength(0)
    expect(rows[0].fields).toEqual({
      name: 'Butter',
      weightG: 100,
      calories: 720,
      vegetarian: true,
      minGrams: undefined,
      maxGrams: undefined,
    })
  })

  it('round-trips the brand when set', () => {
    const branded: Item = { ...butter, brand: 'Firepot' }
    const { rows, issues } = parseItemsCsv(itemsToCsv([branded]))
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.brand).toBe('Firepot')
  })

  it('round-trips generation bounds when set (§6.3)', () => {
    const bounded: Item = { ...butter, minGrams: 5, maxGrams: 30 }
    const { rows, issues } = parseItemsCsv(itemsToCsv([bounded]))
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.minGrams).toBe(5)
    expect(rows[0].fields.maxGrams).toBe(30)
  })

  it('round-trips unit weight and name when set (§9.6)', () => {
    const tortillas: Item = { ...butter, name: 'Tortillas', unitWeightG: 64, unitName: 'tortilla' }
    const { rows, issues } = parseItemsCsv(itemsToCsv([tortillas]))
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.unitWeightG).toBe(64)
    expect(rows[0].fields.unitName).toBe('tortilla')
  })

  it('round-trips an explicit serving when set (§9.7)', () => {
    const oatmeal: Item = { ...butter, name: 'Oatmeal', servingG: 60 }
    const { rows, issues } = parseItemsCsv(itemsToCsv([oatmeal]))
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.servingG).toBe(60)
  })

  it('round-trips generation meal-type tags (Epic 16)', () => {
    const dinner: Item = { ...butter, name: 'Freeze-dried', genMealTypes: ['dinner', 'lunch'] }
    const { rows, issues } = parseItemsCsv(itemsToCsv([dinner]))
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.genMealTypes).toEqual(['dinner', 'lunch'])
  })

  it('rejects an unknown gen_meal_types value', () => {
    const csv = [
      'name,weight_g,calories,vegetarian,gen_meal_types',
      'Bad,100,380,true,brunch',
    ].join('\n')
    const { rows, issues } = parseItemsCsv(csv)
    expect(rows).toHaveLength(0)
    expect(issues[0].reason).toContain('gen_meal_types must be')
  })

  it('rejects a non-positive serving_g', () => {
    const csv = [
      'name,weight_g,calories,vegetarian,serving_g',
      'Bad,100,380,true,0',
    ].join('\n')
    const { rows, issues } = parseItemsCsv(csv)
    expect(rows).toHaveLength(0)
    expect(issues).toEqual([
      { line: 2, reason: 'serving_g must be a positive number, got "0"' },
    ])
  })

  it('treats blank unit cells as none and rejects bad unit weights', () => {
    const csv = [
      'name,weight_g,calories,vegetarian,unit_weight_g,unit_name',
      'Plain,100,380,true,,',
      'Bad,100,380,true,zero,piece',
    ].join('\n')
    const { rows, issues } = parseItemsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].fields.unitWeightG).toBeUndefined()
    expect(rows[0].fields.unitName).toBeUndefined()
    expect(issues).toEqual([
      { line: 3, reason: 'unit_weight_g must be a positive number, got "zero"' },
    ])
  })
})

describe('items CSV bound columns', () => {
  it('accepts files without the optional bound columns (older exports)', () => {
    const { rows, issues } = parseItemsCsv(
      'name,weight_g,calories,vegetarian\nOatmeal,100,380,true',
    )
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.minGrams).toBeUndefined()
    expect(rows[0].fields.maxGrams).toBeUndefined()
  })

  it('treats blank bound cells as unbounded', () => {
    const { rows, issues } = parseItemsCsv(
      'name,weight_g,calories,vegetarian,min_grams,max_grams\nOatmeal,100,380,true,,',
    )
    expect(issues).toHaveLength(0)
    expect(rows[0].fields.minGrams).toBeUndefined()
    expect(rows[0].fields.maxGrams).toBeUndefined()
  })

  it('reports bad or inverted bounds with line numbers', () => {
    const csv = [
      'name,weight_g,calories,vegetarian,min_grams,max_grams',
      'Bad min,100,380,true,lots,30',
      'Negative max,100,380,true,,-5',
      'Inverted,100,380,true,50,30',
      'Fine,100,380,true,5,30',
    ].join('\n')
    const { rows, issues } = parseItemsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].fields.name).toBe('Fine')
    expect(issues).toEqual([
      { line: 2, reason: 'min_grams must be a non-negative number, got "lots"' },
      { line: 3, reason: 'max_grams must be a non-negative number, got "-5"' },
      { line: 4, reason: 'min_grams (50) exceeds max_grams (30)' },
    ])
  })
})

describe('parseMealsCsv', () => {
  it('groups rows by meal_name and validates fields (story 4.9)', () => {
    const csv = [
      'meal_name,meal_type,item_name,quantity_g',
      'Porridge,brekkie,Oatmeal,80',
      'Porridge,brekkie,Butter,20',
      'Porridge,dinner,Chia,10',
      'Solo bar,snack,Snickers,50',
      'Bad,elevenses,Tea,10',
      'Bad grams,lunch,Wrap,-3',
    ].join('\n')

    const { groups, issues } = parseMealsCsv(csv)
    expect(groups.map((g) => g.name)).toEqual(['Porridge', 'Solo bar'])
    expect(groups[0].components).toEqual([
      { itemName: 'Oatmeal', grams: 80 },
      { itemName: 'Butter', grams: 20 },
    ])
    expect(issues.map((i) => i.line)).toEqual([4, 6, 7])
    expect(issues[0].reason).toContain('conflicts')
  })
})

describe('planMealImport', () => {
  const items: Item[] = [butter]
  const groups = parseMealsCsv(
    'meal_name,meal_type,item_name,quantity_g\nToast,brekkie,Butter,20\nToast,brekkie,Bread,60',
  ).groups

  it('fails meals referencing unknown items under the fail policy', () => {
    const plan = planMealImport(groups, items, [], { duplicates: 'skip', missingItems: 'fail' })
    expect(plan.creates).toHaveLength(0)
    expect(plan.failed).toEqual([{ name: 'Toast', missingItems: ['Bread'] }])
  })

  it('auto-creates stub items under the stub policy', () => {
    const plan = planMealImport(groups, items, [], { duplicates: 'skip', missingItems: 'stub' })
    expect(plan.creates).toHaveLength(1)
    expect(plan.stubs).toEqual(['Bread'])
  })

  it('applies duplicate policy against existing meals', () => {
    const existing: Meal = {
      id: 'toast',
      name: 'Toast',
      type: 'brekkie',
      components: [{ itemId: 'butter', grams: 10 }],
    }
    const skip = planMealImport(groups, items, [existing], {
      duplicates: 'skip',
      missingItems: 'stub',
    })
    expect(skip.skipped).toEqual(['Toast'])

    const update = planMealImport(groups, items, [existing], {
      duplicates: 'update',
      missingItems: 'stub',
    })
    expect(update.updates).toHaveLength(1)
    expect(update.updates[0].meal.id).toBe('toast')

    const copy = planMealImport(groups, items, [existing], {
      duplicates: 'copy',
      missingItems: 'stub',
    })
    expect(copy.creates.map((c) => c.name)).toEqual(['Toast (copy)'])
  })
})

describe('meals CSV round-trip', () => {
  it('export → import reproduces meals referencing items by name', () => {
    const meal: Meal = {
      id: 'm1',
      name: 'Buttered oats',
      type: 'brekkie',
      components: [
        { itemId: 'oats', grams: 80 },
        { itemId: 'butter', grams: 20 },
      ],
    }
    const oats: Item = { ...butter, id: 'oats', name: 'Oatmeal' }
    const itemsById = new Map([
      ['oats', oats],
      ['butter', butter],
    ])

    const csv = mealsToCsv([meal], itemsById)
    const { groups, issues } = parseMealsCsv(csv)
    expect(issues).toHaveLength(0)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      name: 'Buttered oats',
      types: ['brekkie'],
      components: [
        { itemName: 'Oatmeal', grams: 80 },
        { itemName: 'Butter', grams: 20 },
      ],
    })
  })

  it('round-trips a meal usable in several slots (pipe-separated meal_type)', () => {
    const meal: Meal = {
      id: 'm2',
      name: 'Rice & beans',
      type: 'lunch',
      types: ['lunch', 'dinner'],
      components: [{ itemId: 'butter', grams: 50 }],
    }
    const itemsById = new Map([['butter', butter]])
    const csv = mealsToCsv([meal], itemsById)
    expect(csv).toContain('lunch|dinner')
    const { groups, issues } = parseMealsCsv(csv)
    expect(issues).toHaveLength(0)
    expect(groups[0].types).toEqual(['lunch', 'dinner'])
  })
})
