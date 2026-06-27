import { describe, expect, it } from 'vitest'
import { deriveCarries } from '../../src/domain/carries'
import { makeTrip } from '../../src/domain/trip'
import { planKey } from '../../src/domain/totals'
import {
  carryShoppingList,
  defaultServingG,
  gramsForUnits,
  packagesForGrams,
  unitsForGrams,
} from '../../src/domain/units'
import type { Item, Meal, PlanEntry } from '../../src/domain/types'

const tortillas: Item = {
  id: 'tortillas',
  name: 'Tortillas',
  caloriesPerGram: 3.2,
  vegetarian: true,
  inputBasis: 'per_package',
  inputWeightG: 512, // the bag
  inputCalories: 1638,
  unitWeightG: 64, // one tortilla
  unitName: 'tortilla',
}

const cheese: Item = {
  id: 'cheese',
  name: 'Cheese',
  caloriesPerGram: 4,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 400,
}

describe('unit conversions', () => {
  it('converts units to grams and back', () => {
    expect(gramsForUnits(tortillas, 2)).toBe(128)
    expect(unitsForGrams(tortillas, 128)).toBe(2)
  })

  it('returns null for items without a unit weight', () => {
    expect(gramsForUnits(cheese, 2)).toBeNull()
    expect(unitsForGrams(cheese, 128)).toBeNull()
  })

  it('rounds packages up to whole bags, only for per-package items', () => {
    expect(packagesForGrams(tortillas, 512)).toBe(1)
    expect(packagesForGrams(tortillas, 513)).toBe(2)
    expect(packagesForGrams(cheese, 500)).toBeNull() // per-100g entry ≠ package size
  })
})

describe('defaultServingG', () => {
  const base = {
    id: 'x',
    name: 'X',
    caloriesPerGram: 4,
    vegetarian: true,
    inputCalories: 100,
  }

  it('prefers an explicit serving over everything', () => {
    const item: Item = { ...base, inputBasis: 'per_package', inputWeightG: 512, unitWeightG: 64, servingG: 90 }
    expect(defaultServingG(item)).toBe(90)
  })

  it('uses the serving weight for a per-serving item', () => {
    const item: Item = { ...base, inputBasis: 'per_serving', inputWeightG: 60 }
    expect(defaultServingG(item)).toBe(60)
  })

  it('falls back to one piece when there is a unit weight', () => {
    expect(defaultServingG(tortillas)).toBe(64) // one tortilla, not the 512 g bag
  })

  it('uses the package weight for a per-package item without a piece', () => {
    const pouch: Item = { ...base, inputBasis: 'per_package', inputWeightG: 130 }
    expect(defaultServingG(pouch)).toBe(130)
  })

  it('gives no default for raw per-100g / per-gram items', () => {
    expect(defaultServingG(cheese)).toBeUndefined() // per_100g
    const perGram: Item = { ...base, inputBasis: 'per_gram', inputWeightG: 1 }
    expect(defaultServingG(perGram)).toBeUndefined()
  })

  it('ignores a non-positive explicit serving and derives instead', () => {
    const item: Item = { ...base, inputBasis: 'per_serving', inputWeightG: 60, servingG: 0 }
    expect(defaultServingG(item)).toBe(60)
  })
})

describe('carryShoppingList', () => {
  const itemsById = new Map([tortillas, cheese].map((i) => [i.id, i]))
  const wrap: Meal = {
    id: 'wrap',
    name: 'Wrap',
    type: 'lunch',
    components: [
      { itemId: 'tortillas', grams: 128 },
      { itemId: 'cheese', grams: 50 },
    ],
  }
  const mealsById = new Map([[wrap.id, wrap]])
  const trip = makeTrip('t1', 'Trip', 2)
  const [carry] = deriveCarries(trip, [])

  const entry = (personId: string, dayIndex: number, extra?: Partial<PlanEntry>): PlanEntry => ({
    id: `${personId}|${dayIndex}`,
    tripId: 't1',
    personId,
    dayIndex,
    slotKey: 'lunch:midday',
    kind: 'meal',
    mealId: 'wrap',
    ...extra,
  })

  function byKey(entries: PlanEntry[]) {
    return new Map(entries.map((e) => [planKey(e.personId, e.dayIndex, e.slotKey), e]))
  }

  it('sums grams per item across people and days, heaviest first', () => {
    const entriesByKey = byKey([entry('alice', 1), entry('alice', 2), entry('bob', 1)])
    const list = carryShoppingList({
      carry,
      personIds: ['alice', 'bob'],
      entriesByKey,
      mealsById,
      itemsById,
    })
    expect(list.map((l) => l.item.id)).toEqual(['tortillas', 'cheese'])
    expect(list[0].grams).toBe(3 * 128)
    expect(list[0].units).toBe(6)
    expect(list[0].packages).toBe(1) // 384 g of a 512 g bag
    expect(list[1].grams).toBe(150)
    expect(list[1].units).toBeNull()
    expect(list[1].packages).toBeNull()
  })

  it('applies quantity scaling the same way as entry totals', () => {
    const entriesByKey = byKey([entry('alice', 1, { quantityScale: 1.5 })])
    const list = carryShoppingList({
      carry,
      personIds: ['alice'],
      entriesByKey,
      mealsById,
      itemsById,
    })
    expect(list[0].grams).toBe(192) // 128 × 1.5
  })

  it('skips empty and off-trail slots', () => {
    const offTrail = entry('alice', 1, { kind: 'offTrail', mealId: undefined })
    const list = carryShoppingList({
      carry,
      personIds: ['alice'],
      entriesByKey: byKey([offTrail]),
      mealsById,
      itemsById,
    })
    expect(list).toEqual([])
  })
})
