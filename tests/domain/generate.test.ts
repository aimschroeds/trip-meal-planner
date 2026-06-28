import { describe, expect, it } from 'vitest'
import { generateDayPlan } from '../../src/domain/generate'
import { rollUpMeal, scaledGrams } from '../../src/domain/rollups'
import { makeTrip } from '../../src/domain/trip'
import type { Item, Meal, Person, PlanEntry, PlanPart } from '../../src/domain/types'

/** Generated entries hold parts; these read the single meal part out. */
function mealPart(e?: { parts?: PlanPart[] }): Extract<PlanPart, { kind: 'meal' }> | undefined {
  const p = e?.parts?.find((x) => x.kind === 'meal')
  return p?.kind === 'meal' ? p : undefined
}
const mealIdOf = (e?: { parts?: PlanPart[] }) => mealPart(e)?.mealId
const scaleOf = (e?: { parts?: PlanPart[] }) => mealPart(e)?.quantityScale ?? 1

function item(id: string, caloriesPerGram: number, vegetarian = true): Item {
  return {
    id,
    name: id,
    caloriesPerGram,
    vegetarian,
    inputBasis: 'per_gram',
    inputWeightG: 1,
    inputCalories: caloriesPerGram,
  }
}

function meal(id: string, type: Meal['type'], itemId: string, grams: number): Meal {
  return { id, name: id, type, components: [{ itemId, grams }] }
}

// Densities: oats 4, tortilla 4, pasta 4, bar 5, nuts 6, salami 5 (non-veg)
const items = [
  item('oats', 4),
  item('tortilla', 4),
  item('pasta', 4),
  item('bar', 5),
  item('nuts', 6),
  item('salami', 5, false),
]
const itemsById = new Map(items.map((i) => [i.id, i]))

const library: Meal[] = [
  meal('porridge', 'brekkie', 'oats', 100), // 400 cal
  meal('wrap', 'lunch', 'tortilla', 150), // 600 cal
  meal('pasta-night', 'dinner', 'pasta', 200), // 800 cal
  meal('salami-dinner', 'dinner', 'salami', 180), // 900 cal, non-veg
  meal('snack-bar', 'snack', 'bar', 50), // 250 cal
  meal('trail-nuts', 'snack', 'nuts', 50), // 300 cal
]

const person: Person = { id: 'p1', name: 'A', baselineCalories: 2500, vegetarian: false }
const veggie: Person = { id: 'p2', name: 'V', baselineCalories: 2500, vegetarian: true }

const trip = makeTrip('t1', 'Test', 3)
const day = trip.days[0] // average: brekkie, lunch, dinner + 2 snacks

const firstPick = () => 0 // deterministic: always the best-scored candidate

function baseArgs(overrides: Partial<Parameters<typeof generateDayPlan>[0]> = {}) {
  return {
    trip,
    day,
    person,
    meals: library,
    itemsById,
    existingEntries: [] as PlanEntry[],
    rng: firstPick,
    ...overrides,
  }
}

function totalCalories(entries: ReturnType<typeof generateDayPlan>): number {
  return entries.reduce((sum, e) => {
    const m = library.find((x) => x.id === mealIdOf(e))!
    const cal = m.components.reduce(
      (n, c) => n + c.grams * itemsById.get(c.itemId)!.caloriesPerGram,
      0,
    )
    return sum + cal * scaleOf(e)
  }, 0)
}

describe('generateDayPlan', () => {
  it('fills every slot with a type-matched meal and hits the target within 5% (story 8.1)', () => {
    const entries = generateDayPlan(baseArgs())
    expect(entries).toHaveLength(5)
    const byKey = new Map(entries.map((e) => [e.slotKey, e]))
    expect(mealIdOf(byKey.get('brekkie:morning'))).toBe('porridge')
    expect(mealIdOf(byKey.get('lunch:midday'))).toBe('wrap')
    expect(['pasta-night', 'salami-dinner']).toContain(mealIdOf(byKey.get('dinner:evening')))

    const total = totalCalories(entries)
    expect(Math.abs(total - 2500) / 2500).toBeLessThanOrEqual(0.05)
  })

  it('places a multi-slot meal in a slot that is not its primary type', () => {
    // "leftovers" is primary dinner but tagged for lunch too — it should be the
    // chosen lunch meal when no lunch-primary meal exists.
    const leftovers: Meal = {
      ...meal('leftovers', 'dinner', 'pasta', 150),
      types: ['lunch', 'dinner'],
    }
    const lib = library.filter((m) => m.id !== 'wrap').concat(leftovers)
    const entries = generateDayPlan(baseArgs({ meals: lib }))
    const byKey = new Map(entries.map((e) => [e.slotKey, e]))
    expect(mealIdOf(byKey.get('lunch:midday'))).toBe('leftovers')
  })

  it('only selects vegetarian meals for vegetarian people', () => {
    // Run with every rng value that selects different candidates.
    for (const r of [0, 0.4, 0.9]) {
      const entries = generateDayPlan(baseArgs({ person: veggie, rng: () => r }))
      expect(entries.map(mealIdOf)).not.toContain('salami-dinner')
    }
  })

  it('keeps locked picks and generates around them (story 8.2)', () => {
    const locked: PlanEntry = {
      id: 'x',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'dinner:evening',
      kind: 'planned',
      parts: [{ kind: 'meal', mealId: 'salami-dinner' }], // 900 cal kept
      locked: true,
    }
    const entries = generateDayPlan(baseArgs({ existingEntries: [locked] }))
    expect(entries.map((e) => e.slotKey)).not.toContain('dinner:evening')
    // Generated portion aims at 2500 - 900 = 1600.
    const total = totalCalories(entries)
    expect(Math.abs(total - 1600) / 1600).toBeLessThanOrEqual(0.05)
  })

  it('skips off-trail slots (story 8.1)', () => {
    const offTrail: PlanEntry = {
      id: 'x',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'lunch:midday',
      kind: 'offTrail',
      offTrailCalories: 700,
    }
    const entries = generateDayPlan(baseArgs({ existingEntries: [offTrail] }))
    expect(entries.map((e) => e.slotKey)).not.toContain('lunch:midday')
  })

  it('replaces unlocked existing picks', () => {
    const unlocked: PlanEntry = {
      id: 'x',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'brekkie:morning',
      kind: 'planned',
      parts: [{ kind: 'meal', mealId: 'porridge' }],
    }
    const entries = generateDayPlan(baseArgs({ existingEntries: [unlocked] }))
    expect(entries.map((e) => e.slotKey)).toContain('brekkie:morning')
  })

  it('clamps quantity scaling to the bounds instead of producing absurd portions', () => {
    const hungry: Person = { id: 'p3', name: 'H', baselineCalories: 6000, vegetarian: false }
    const entries = generateDayPlan(baseArgs({ person: hungry }))
    for (const e of entries) {
      expect(scaleOf(e)).toBeLessThanOrEqual(1.5)
      expect(scaleOf(e)).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('leaves slots unfilled when no eligible meal exists', () => {
    const noBrekkie = library.filter((m) => m.type !== 'brekkie')
    const entries = generateDayPlan(baseArgs({ meals: noBrekkie }))
    expect(entries.map((e) => e.slotKey)).not.toContain('brekkie:morning')
  })

  it('varies picks with the rng for one-tap regeneration (story 8.3)', () => {
    const a = generateDayPlan(baseArgs({ rng: () => 0 }))
    const b = generateDayPlan(baseArgs({ rng: () => 0.99 }))
    expect(a.map(mealIdOf).join()).not.toEqual(b.map(mealIdOf).join())
  })
})

describe('generation from tagged loose items (Epic 16)', () => {
  const freezeDried: Item = {
    ...item('freeze-dried', 4),
    inputBasis: 'per_serving',
    inputWeightG: 200, // 200 g serving → 800 cal
    genMealTypes: ['dinner'],
  }
  const tagged = new Map([...items, freezeDried].map((i) => [i.id, i]))

  it('fills a slot with a tagged item when no meal of that type exists', () => {
    const noDinnerMeals = library.filter((m) => m.type !== 'dinner')
    const entries = generateDayPlan(baseArgs({ meals: noDinnerMeals, itemsById: tagged }))
    const dinner = new Map(entries.map((e) => [e.slotKey, e])).get('dinner:evening')
    expect(dinner?.parts?.[0]).toMatchObject({ kind: 'item', itemId: 'freeze-dried' })
  })

  it('never generates an untagged item', () => {
    const untagged = new Map([...items, item('plain', 4)].map((i) => [i.id, i]))
    const entries = generateDayPlan(baseArgs({ meals: [], itemsById: untagged }))
    const parts = entries.flatMap((e) => e.parts ?? [])
    expect(parts.some((p) => p.kind === 'item')).toBe(false)
  })

  it('respects the vegetarian constraint for items', () => {
    const jerky: Item = { ...item('jerky', 5, false), genMealTypes: ['snack'] }
    const withMeat = new Map([...items, jerky].map((i) => [i.id, i]))
    for (const r of [0, 0.5, 0.99]) {
      const entries = generateDayPlan(
        baseArgs({ person: veggie, meals: [], itemsById: withMeat, rng: () => r }),
      )
      const itemIds = entries
        .flatMap((e) => e.parts ?? [])
        .flatMap((p) => (p.kind === 'item' ? [p.itemId] : []))
      expect(itemIds).not.toContain('jerky')
    }
  })
})

describe('per-item quantity bounds (§6.3, backlog item 2)', () => {
  const cappedButter: Item = { ...item('butter', 7.2), maxGrams: 30 }
  const boundedItems = new Map([...items, cappedButter].map((i) => [i.id, i]))
  const butteryPasta: Meal = {
    id: 'buttery-pasta',
    name: 'buttery-pasta',
    type: 'dinner',
    components: [
      { itemId: 'pasta', grams: 150 }, // 600 cal
      { itemId: 'butter', grams: 25 }, // 180 cal
    ],
  }
  const boundedLibrary = [...library.filter((m) => m.type !== 'dinner'), butteryPasta]
  const lookup = new Map(boundedLibrary.map((m) => [m.id, m]))

  const clampedTotal = (entries: ReturnType<typeof generateDayPlan>) =>
    entries.reduce(
      (sum, e) => sum + rollUpMeal(lookup.get(mealIdOf(e)!)!, boundedItems, scaleOf(e)).calories,
      0,
    )

  it('caps bounded items when scaling up, compensating with the rest of the plan', () => {
    const hungry: Person = { id: 'p3', name: 'H', baselineCalories: 3000, vegetarian: false }
    const entries = generateDayPlan(
      baseArgs({ person: hungry, meals: boundedLibrary, itemsById: boundedItems }),
    )
    const dinner = entries.find((e) => mealIdOf(e) === 'buttery-pasta')
    expect(dinner).toBeDefined()
    const scale = scaleOf(dinner)

    // Butter rides its cap instead of scaling to 25 × scale ≈ 32 g.
    expect(scale).toBeGreaterThan(1.2)
    expect(scaledGrams(25, cappedButter, scale)).toBe(30)

    // The capped calories are made up elsewhere: a plain linear solve would
    // give 3000/2380 ≈ 1.26; the clamped solve must push slightly higher
    // and still land within tolerance.
    expect(scale).toBeGreaterThanOrEqual(1.26)
    const total = clampedTotal(entries)
    expect(Math.abs(total - 3000) / 3000).toBeLessThanOrEqual(0.05)
  })

  it('floors bounded items when scaling down', () => {
    const flooredOats: Item = { ...item('oats', 4), minGrams: 70 }
    const flooredItems = new Map(boundedItems)
    flooredItems.set('oats', flooredOats)
    const light: Person = { id: 'p4', name: 'L', baselineCalories: 1200, vegetarian: false }
    const entries = generateDayPlan(
      baseArgs({ person: light, meals: boundedLibrary, itemsById: flooredItems }),
    )
    const brekkie = entries.find((e) => mealIdOf(e) === 'porridge')
    expect(brekkie).toBeDefined()
    const scale = scaleOf(brekkie)
    expect(scale).toBeLessThan(0.7)
    // 100 g oats × scale would drop below 70 g; the floor holds it there.
    expect(scaledGrams(100, flooredOats, scale)).toBe(70)
  })
})
