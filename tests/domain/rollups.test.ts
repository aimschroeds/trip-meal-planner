import { describe, expect, it } from 'vitest'
import { mealSlotTypes, rollUpMeal } from '../../src/domain/rollups'
import type { Item, Meal } from '../../src/domain/types'

function item(partial: Partial<Item> & Pick<Item, 'id' | 'caloriesPerGram'>): Item {
  return {
    name: partial.id,
    vegetarian: true,
    inputBasis: 'per_gram',
    inputWeightG: 1,
    inputCalories: partial.caloriesPerGram,
    ...partial,
  }
}

const oatmeal = item({ id: 'oatmeal', caloriesPerGram: 3.8 })
const chia = item({ id: 'chia', caloriesPerGram: 4.9 })
const butter = item({ id: 'butter', caloriesPerGram: 7.2 })
const jerky = item({ id: 'jerky', caloriesPerGram: 3.0, vegetarian: false })

const itemsById = new Map([oatmeal, chia, butter, jerky].map((i) => [i.id, i]))

function meal(components: Meal['components']): Meal {
  return { id: 'm1', name: 'Test meal', type: 'brekkie', components }
}

describe('mealSlotTypes', () => {
  const base = meal([{ itemId: 'oatmeal', grams: 80 }])

  it('falls back to the single type for a legacy meal', () => {
    expect(mealSlotTypes(base)).toEqual(['brekkie'])
  })

  it('returns the full set when a meal lists several slots', () => {
    expect(mealSlotTypes({ ...base, types: ['lunch', 'dinner'] })).toEqual(['lunch', 'dinner'])
  })

  it('ignores an empty types array', () => {
    expect(mealSlotTypes({ ...base, type: 'snack', types: [] })).toEqual(['snack'])
  })
})

describe('rollUpMeal', () => {
  it('sums weight and calories across components (story 4.3 example)', () => {
    // brekkie = 80g oatmeal + 15g chia + 20g butter
    const rollup = rollUpMeal(
      meal([
        { itemId: 'oatmeal', grams: 80 },
        { itemId: 'chia', grams: 15 },
        { itemId: 'butter', grams: 20 },
      ]),
      itemsById,
    )
    expect(rollup.weightG).toBe(115)
    expect(rollup.calories).toBeCloseTo(80 * 3.8 + 15 * 4.9 + 20 * 7.2) // 521.5
    expect(rollup.density).toBeCloseTo(521.5 / 115)
    expect(rollup.vegetarian).toBe(true)
  })

  it('is non-vegetarian if any component is non-vegetarian', () => {
    const rollup = rollUpMeal(
      meal([
        { itemId: 'oatmeal', grams: 50 },
        { itemId: 'jerky', grams: 30 },
      ]),
      itemsById,
    )
    expect(rollup.vegetarian).toBe(false)
  })

  it('supports a single item used directly as a meal', () => {
    const rollup = rollUpMeal(meal([{ itemId: 'jerky', grams: 100 }]), itemsById)
    expect(rollup).toEqual({ weightG: 100, calories: 300, density: 3, vegetarian: false })
  })

  it('counts the same item twice when listed twice (story 5.2)', () => {
    const rollup = rollUpMeal(
      meal([
        { itemId: 'butter', grams: 10 },
        { itemId: 'butter', grams: 10 },
      ]),
      itemsById,
    )
    expect(rollup.weightG).toBe(20)
    expect(rollup.calories).toBeCloseTo(144)
  })

  it('returns zeros for an empty meal without dividing by zero', () => {
    expect(rollUpMeal(meal([]), itemsById)).toEqual({
      weightG: 0,
      calories: 0,
      density: 0,
      vegetarian: true,
    })
  })

  it('throws when a component references a missing item', () => {
    expect(() => rollUpMeal(meal([{ itemId: 'ghost', grams: 10 }]), itemsById)).toThrow(/ghost/)
  })
})

describe('scaled roll-ups with per-item bounds (§6.3)', () => {
  const boundedButter = item({ id: 'butter', caloriesPerGram: 7.2, maxGrams: 30 })
  const boundedOats = item({ id: 'oatmeal', caloriesPerGram: 3.8, minGrams: 60 })
  const bounded = new Map([boundedOats, chia, boundedButter].map((i) => [i.id, i]))
  const brekkie = meal([
    { itemId: 'oatmeal', grams: 80 },
    { itemId: 'chia', grams: 15 },
    { itemId: 'butter', grams: 20 },
  ])

  it('scales unbounded components linearly', () => {
    const rollup = rollUpMeal(brekkie, itemsById, 1.5)
    expect(rollup.weightG).toBeCloseTo(115 * 1.5)
    expect(rollup.calories).toBeCloseTo(521.5 * 1.5)
  })

  it('caps a component at maxGrams when scaling up', () => {
    const rollup = rollUpMeal(brekkie, bounded, 1.5)
    // butter: 20 × 1.5 = 30 = cap; oats/chia scale freely
    expect(rollup.weightG).toBeCloseTo(80 * 1.5 + 15 * 1.5 + 30)
  })

  it('floors a component at minGrams when scaling down', () => {
    const rollup = rollUpMeal(brekkie, bounded, 0.5)
    // oats: 80 × 0.5 = 40 → floored at 60
    expect(rollup.weightG).toBeCloseTo(60 + 15 * 0.5 + 20 * 0.5)
  })

  it('never clamps the authored quantity: scale 1 is the identity even outside bounds', () => {
    const tinyMax = new Map(bounded)
    tinyMax.set('butter', item({ id: 'butter', caloriesPerGram: 7.2, maxGrams: 10 }))
    expect(rollUpMeal(brekkie, tinyMax, 1).weightG).toBe(115)
    // Scaling up holds an already-over-max component at its authored grams.
    const up = rollUpMeal(brekkie, tinyMax, 1.5)
    expect(up.weightG).toBeCloseTo(80 * 1.5 + 15 * 1.5 + 20)
  })
})
