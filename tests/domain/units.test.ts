import { describe, expect, it } from 'vitest'
import { deriveCarries, type SlotRef } from '../../src/domain/carries'
import { makeTrip } from '../../src/domain/trip'
import { planKey } from '../../src/domain/totals'
import {
  carryPrepIngredientTotals,
  carryPrepList,
  carryShoppingList,
  defaultServingG,
  entryItemLines,
  gramsForUnits,
  packagesForGrams,
  packagingBaseG,
  purchaseQuantity,
  tripShoppingList,
  unitsForGrams,
  type PrepGroup,
  type ShoppingLine,
} from '../../src/domain/units'
import type { Item, Meal, MealType, PlanEntry, Slot } from '../../src/domain/types'

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

  const entry = (
    personId: string,
    dayIndex: number,
    extra?: Partial<PlanEntry> & { quantityScale?: number },
  ): PlanEntry => {
    const { quantityScale, ...rest } = extra ?? {}
    return {
      id: `${personId}|${dayIndex}`,
      tripId: 't1',
      personId,
      dayIndex,
      slotKey: 'lunch:midday',
      kind: 'planned',
      parts: [{ kind: 'meal', mealId: 'wrap', ...(quantityScale != null ? { quantityScale } : {}) }],
      ...rest,
    }
  }

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

  it('includes loose item parts alongside meals (Epic 13)', () => {
    const dinner = entry('alice', 1, {
      parts: [
        { kind: 'meal', mealId: 'wrap' }, // 128 g tortilla + 50 g cheese
        { kind: 'item', itemId: 'cheese', grams: 30 }, // loose extra cheese
      ],
    })
    const list = carryShoppingList({
      carry,
      personIds: ['alice'],
      entriesByKey: byKey([dinner]),
      mealsById,
      itemsById,
    })
    const cheese = list.find((l) => l.item.id === 'cheese')!
    expect(cheese.grams).toBe(80) // 50 from the wrap + 30 loose
  })

  it('skips empty and off-trail slots', () => {
    const offTrail = entry('alice', 1, { kind: 'offTrail', parts: undefined })
    const list = carryShoppingList({
      carry,
      personIds: ['alice'],
      entriesByKey: byKey([offTrail]),
      mealsById,
      itemsById,
    })
    expect(list).toEqual([])
  })

  it('trip shopping list aggregates all carries into buy quantities, by name', () => {
    const entriesByKey = byKey([entry('alice', 1), entry('bob', 1)])
    const list = tripShoppingList({
      carries: deriveCarries(trip, []),
      personIds: ['alice', 'bob'],
      entriesByKey,
      mealsById,
      itemsById,
    })
    // Sorted by name: Cheese before Tortillas.
    expect(list.map((l) => l.item.id)).toEqual(['cheese', 'tortillas'])
    // 2 wraps → 256 g of a 512 g bag → 1 pack; 100 g cheese → by weight.
    expect(list.find((l) => l.item.id === 'tortillas')!.purchase).toEqual({
      kind: 'pack',
      count: 1,
      eachG: 512,
    })
    expect(list.find((l) => l.item.id === 'cheese')!.purchase).toEqual({ kind: 'weight', grams: 100 })
  })
})

describe('purchaseQuantity', () => {
  it('buys per-package items in whole packs (you buy 2, not 248 g)', () => {
    const bar: Item = { ...cheese, inputBasis: 'per_package', inputWeightG: 180 }
    expect(purchaseQuantity(bar, 248)).toEqual({ kind: 'pack', count: 2, eachG: 180 })
  })

  it('buys piece items (unit weight) in whole pieces', () => {
    const bar: Item = {
      ...cheese,
      inputBasis: 'per_serving',
      inputWeightG: 55,
      unitWeightG: 55,
      unitName: 'bar',
    }
    expect(purchaseQuantity(bar, 130)).toEqual({ kind: 'piece', count: 3, unitName: 'bar' })
  })

  it('treats a per-serving item as whole single-serve packs', () => {
    const meal: Item = { ...cheese, inputBasis: 'per_serving', inputWeightG: 148 }
    expect(purchaseQuantity(meal, 296)).toEqual({ kind: 'pack', count: 2, eachG: 148 })
  })

  it('buys bulk (per-100g / per-gram) items by weight', () => {
    expect(purchaseQuantity(cheese, 150)).toEqual({ kind: 'weight', grams: 150 })
  })
})

describe('carryPrepList', () => {
  const oats: Item = {
    id: 'oats',
    name: 'Oatmeal',
    caloriesPerGram: 4,
    vegetarian: true,
    inputBasis: 'per_100g',
    inputWeightG: 100,
    inputCalories: 400,
  }
  const chia: Item = { ...oats, id: 'chia', name: 'Chia Seeds' }
  const pb: Item = {
    ...oats,
    id: 'pb',
    name: "Justin's Peanut Butter",
    inputBasis: 'per_package',
    unitWeightG: 32,
    unitName: 'sachet',
  }
  const apricots: Item = { ...oats, id: 'apricots', name: 'Apricots' }
  const itemsById = new Map([oats, chia, pb, apricots].map((i) => [i.id, i]))

  const oatChia: Meal = {
    id: 'oatChia',
    name: 'Oatmeal + chia',
    type: 'brekkie',
    components: [
      { itemId: 'oats', grams: 80 },
      { itemId: 'chia', grams: 80 },
    ],
  }
  const oatPbApricot: Meal = {
    id: 'oatPbApricot',
    name: 'Oatmeal + PB + apricots',
    type: 'brekkie',
    components: [
      { itemId: 'oats', grams: 80 },
      { itemId: 'pb', grams: 32 },
      { itemId: 'apricots', grams: 30 },
    ],
  }
  const mealsById = new Map([oatChia, oatPbApricot].map((m) => [m.id, m]))

  const trip = makeTrip('t1', 'Trip', 2)
  const [carry] = deriveCarries(trip, [])

  const entry = (personId: string, dayIndex: number, mealId: string): PlanEntry => ({
    id: `${personId}|${dayIndex}`,
    tripId: 't1',
    personId,
    dayIndex,
    slotKey: 'brekkie:morning',
    kind: 'planned',
    parts: [{ kind: 'meal', mealId }],
  })

  it('collapses identical recipes across people and days into one group with a count', () => {
    const entriesByKey = new Map(
      [
        entry('alice', 1, 'oatChia'), // 1x oat+chia
        entry('bob', 1, 'oatPbApricot'), // 3x oat+pb+apricot
        entry('carol', 1, 'oatPbApricot'),
        entry('alice', 2, 'oatPbApricot'),
      ].map((e) => [planKey(e.personId, e.dayIndex, e.slotKey), e]),
    )

    const groups = carryPrepList({
      carry,
      personIds: ['alice', 'bob', 'carol'],
      entriesByKey,
      mealsById,
      itemsById,
    })

    expect(groups).toHaveLength(2)
    // Sorted by meal type, then by count descending — the 3x recipe first.
    expect(groups[0].count).toBe(3)
    expect(groups[0].mealType).toBe('brekkie')
    expect(groups[0].lines.map((l) => `${l.item.id}:${l.grams}`)).toEqual([
      'oats:80',
      'pb:32',
      'apricots:30',
    ])
    expect(groups[0].lines.find((l) => l.item.id === 'pb')!.units).toBe(1) // 32g = 1 sachet

    expect(groups[1].count).toBe(1)
    expect(groups[1].lines.map((l) => `${l.item.id}:${l.grams}`)).toEqual(['oats:80', 'chia:80'])
  })

  it('keeps two recipes with the same items but different grams separate', () => {
    const smallPortion: Meal = {
      id: 'oatChiaSmall',
      name: 'Oatmeal + chia (small)',
      type: 'brekkie',
      components: [
        { itemId: 'oats', grams: 60 },
        { itemId: 'chia', grams: 80 },
      ],
    }
    const mealsWithSmall = new Map([...mealsById, [smallPortion.id, smallPortion]])
    const entriesByKey = new Map(
      [entry('alice', 1, 'oatChia'), entry('bob', 1, 'oatChiaSmall')].map((e) => [
        planKey(e.personId, e.dayIndex, e.slotKey),
        e,
      ]),
    )
    const groups = carryPrepList({
      carry,
      personIds: ['alice', 'bob'],
      entriesByKey,
      mealsById: mealsWithSmall,
      itemsById,
    })
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.count === 1)).toBe(true)
  })

  it('ignores off-trail and empty slots', () => {
    const entriesByKey = new Map<string, PlanEntry>([
      [
        planKey('alice', 1, 'brekkie:morning'),
        {
          id: 'a1',
          tripId: 't1',
          personId: 'alice',
          dayIndex: 1,
          slotKey: 'brekkie:morning',
          kind: 'offTrail',
          offTrailCalories: 400,
        },
      ],
    ])
    const groups = carryPrepList({ carry, personIds: ['alice'], entriesByKey, mealsById, itemsById })
    expect(groups).toEqual([])
  })
})

describe('carryPrepIngredientTotals', () => {
  const oats: Item = {
    id: 'oats',
    name: 'Oatmeal',
    caloriesPerGram: 4,
    vegetarian: true,
    inputBasis: 'per_100g',
    inputWeightG: 100,
    inputCalories: 400,
  }
  const honey: Item = { ...oats, id: 'honey', name: 'Honey' }
  const apricots: Item = { ...oats, id: 'apricots', name: 'Apricots' }

  const group = (mealType: MealType, count: number, lines: ShoppingLine[]): PrepGroup => ({
    mealType,
    key: `${mealType}:${lines.map((l) => `${l.item.id}:${l.grams}`).join('|')}`,
    count,
    lines,
  })
  const line = (item: Item, grams: number): ShoppingLine => ({ item, grams, units: null, packages: null })

  it('sums the count for the same item at the same portion size across different recipes', () => {
    const groups = [
      group('brekkie', 4, [line(oats, 50), line(honey, 21)]),
      group('brekkie', 2, [line(oats, 50)]),
    ]
    const [brekkie] = carryPrepIngredientTotals(groups)
    const oatsTotal = brekkie.totals.find((t) => t.item.id === 'oats')!
    expect(oatsTotal.portions).toEqual([{ grams: 50, units: null, count: 6 }])
    expect(oatsTotal.totalGrams).toBe(300)
  })

  it('keeps different portion sizes of the same item separate, most-repeated first', () => {
    const groups = [
      group('brekkie', 4, [line(oats, 50)]),
      group('brekkie', 1, [line(oats, 75), line(apricots, 30)]),
    ]
    const [brekkie] = carryPrepIngredientTotals(groups)
    const oatsTotal = brekkie.totals.find((t) => t.item.id === 'oats')!
    expect(oatsTotal.portions).toEqual([
      { grams: 50, units: null, count: 4 },
      { grams: 75, units: null, count: 1 },
    ])
    expect(oatsTotal.totalGrams).toBe(50 * 4 + 75)
  })

  it('sorts items within a meal time by total grams contributed, heaviest first', () => {
    const groups = [
      group('brekkie', 4, [line(oats, 50), line(honey, 21)]),
      group('brekkie', 1, [line(oats, 75), line(apricots, 30)]),
    ]
    const [brekkie] = carryPrepIngredientTotals(groups)
    expect(brekkie.totals.map((t) => t.item.id)).toEqual(['oats', 'honey', 'apricots'])
  })

  it('keeps the same item separate across different meal times, ordered brekkie/lunch/dinner/snack', () => {
    const groups = [
      group('dinner', 1, [line(oats, 100)]),
      group('brekkie', 3, [line(oats, 50)]),
    ]
    const mealTotals = carryPrepIngredientTotals(groups)
    expect(mealTotals.map((m) => m.mealType)).toEqual(['brekkie', 'dinner'])
    expect(mealTotals[0].totals[0].totalGrams).toBe(150) // brekkie: 3x50g
    expect(mealTotals[1].totals[0].totalGrams).toBe(100) // dinner: 1x100g, not combined with brekkie
  })
})

describe('entryItemLines', () => {
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

  it('resolves a meal entry into item lines, heaviest first', () => {
    const entry: PlanEntry = {
      id: 'e1',
      tripId: 't1',
      personId: 'alice',
      dayIndex: 1,
      slotKey: 'lunch:midday',
      kind: 'planned',
      parts: [{ kind: 'meal', mealId: 'wrap' }],
    }
    expect(entryItemLines(entry, mealsById, itemsById)).toEqual([
      { item: tortillas, grams: 128 },
      { item: cheese, grams: 50 },
    ])
  })

  it('merges a loose item with the same item from a meal', () => {
    const entry: PlanEntry = {
      id: 'e2',
      tripId: 't1',
      personId: 'alice',
      dayIndex: 1,
      slotKey: 'lunch:midday',
      kind: 'planned',
      parts: [
        { kind: 'meal', mealId: 'wrap' },
        { kind: 'item', itemId: 'cheese', grams: 20 },
      ],
    }
    expect(entryItemLines(entry, mealsById, itemsById).find((l) => l.item.id === 'cheese')).toEqual(
      { item: cheese, grams: 70 },
    )
  })

  it('returns nothing for off-trail, missing, or empty entries', () => {
    expect(entryItemLines(undefined, mealsById, itemsById)).toEqual([])
    expect(
      entryItemLines(
        {
          id: 'e3',
          tripId: 't1',
          personId: 'alice',
          dayIndex: 1,
          slotKey: 'lunch:midday',
          kind: 'offTrail',
          offTrailCalories: 600,
        },
        mealsById,
        itemsById,
      ),
    ).toEqual([])
    expect(
      entryItemLines(
        {
          id: 'e4',
          tripId: 't1',
          personId: 'alice',
          dayIndex: 1,
          slotKey: 'lunch:midday',
          kind: 'planned',
          parts: [],
        },
        mealsById,
        itemsById,
      ),
    ).toEqual([])
  })
})

describe('packagingBaseG', () => {
  const pouch: Item = {
    id: 'pouch',
    name: 'Chili mac',
    caloriesPerGram: 4,
    vegetarian: false,
    inputBasis: 'per_package',
    inputWeightG: 100, // food grams per pouch
    inputCalories: 400,
    packagingG: 20, // pouch wrapper
  }
  const slot: Slot = { type: 'dinner', timing: 'evening' }
  const slots: SlotRef[] = [{ dayIndex: 1, slot, key: 'dinner-0' }]

  function entriesFor(itemId: string, grams: number) {
    const entry: PlanEntry = {
      id: 'e',
      tripId: 't',
      personId: 'a',
      dayIndex: 1,
      slotKey: 'dinner-0',
      kind: 'planned',
      parts: [{ kind: 'item', itemId, grams }],
    }
    return new Map([[planKey('a', 1, 'dinner-0'), entry]])
  }

  it('counts whole packages carried × packaging weight', () => {
    const itemsById = new Map([['pouch', pouch]])
    // 150 g of a 100 g pouch → 2 pouches → 2 × 20 g packaging.
    expect(packagingBaseG(slots, ['a'], entriesFor('pouch', 150), new Map(), itemsById)).toBe(40)
  })

  it('is zero when the item has no packaging weight', () => {
    const bare = { ...pouch, packagingG: undefined }
    const itemsById = new Map([['pouch', bare]])
    expect(packagingBaseG(slots, ['a'], entriesFor('pouch', 150), new Map(), itemsById)).toBe(0)
  })

  it('ignores packaging on non-package items (package count undefined)', () => {
    const bulk: Item = { ...pouch, inputBasis: 'per_100g', packagingG: 20 }
    const itemsById = new Map([['pouch', bulk]])
    expect(packagingBaseG(slots, ['a'], entriesFor('pouch', 150), new Map(), itemsById)).toBe(0)
  })
})
