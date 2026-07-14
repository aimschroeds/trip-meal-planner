import { describe, expect, it } from 'vitest'
import {
  baseWeightG,
  carryPackWeightG,
  categoryLabel,
  gearWeightSplit,
  isBigThree,
  ownerPersonId,
  personGearByCategory,
  personGearTotals,
} from '../../src/domain/gear'
import type { GearAssignment, GearItem } from '../../src/domain/types'

describe('gearWeightSplit', () => {
  it('is all base weight when nothing is worn or consumable', () => {
    expect(gearWeightSplit({ weightG: 500 })).toEqual({ baseG: 500, wornG: 0, consumableG: 0 })
  })

  it('splits a fuel canister into base (can) and consumable (gas)', () => {
    // 220 g canister, 100 g of gas depletes.
    expect(gearWeightSplit({ weightG: 220, consumableWeightG: 100 })).toEqual({
      baseG: 120,
      wornG: 0,
      consumableG: 100,
    })
  })

  it('counts a worn item entirely as worn weight', () => {
    expect(gearWeightSplit({ weightG: 300, wornWeightG: 300 })).toEqual({
      baseG: 0,
      wornG: 300,
      consumableG: 0,
    })
  })

  it('clamps so worn + consumable never exceed the total (base stays ≥ 0)', () => {
    const s = gearWeightSplit({ weightG: 100, wornWeightG: 80, consumableWeightG: 50 })
    expect(s.baseG).toBe(0)
    expect(s.wornG).toBe(80)
    expect(s.consumableG).toBe(20) // clamped from 50 to what's left after worn
  })
})

describe('baseWeightG', () => {
  it('is total minus worn minus consumable', () => {
    expect(baseWeightG({ weightG: 220, consumableWeightG: 100 })).toBe(120)
  })
})

describe('isBigThree / categoryLabel', () => {
  it('flags pack/shelter/sleep as the Big 3', () => {
    expect(['pack', 'shelter', 'sleep'].every(isBigThree)).toBe(true)
    expect(isBigThree('clothing')).toBe(false)
  })

  it('labels curated categories and passes custom ones through', () => {
    expect(categoryLabel('hygiene')).toBe('Hygiene / first aid')
    expect(categoryLabel('Ski gear')).toBe('Ski gear')
  })
})

const GEAR: GearItem[] = [
  { id: 'tent', name: 'Duplex', category: 'shelter', weightG: 540, shared: true },
  { id: 'stove', name: 'Fuel', category: 'cooking', weightG: 220, consumableWeightG: 100 },
  { id: 'puffy', name: 'Puffy', category: 'clothing', weightG: 300, wornWeightG: 300 },
]
const gearById = new Map(GEAR.map((g) => [g.id, g]))

function assign(personId: string, gearItemId: string): GearAssignment {
  return { id: `t|${personId}|${gearItemId}`, tripId: 't', personId, gearItemId }
}

describe('personGearTotals', () => {
  it('sums base/worn/consumable across a person’s assignments', () => {
    const assignments = [assign('alice', 'tent'), assign('alice', 'stove'), assign('bob', 'puffy')]
    // Alice: tent 540 base + fuel (120 base / 100 consumable).
    expect(personGearTotals(assignments, gearById, 'alice')).toEqual({
      baseG: 660,
      wornG: 0,
      consumableG: 100,
    })
    // Bob: puffy fully worn.
    expect(personGearTotals(assignments, gearById, 'bob')).toEqual({
      baseG: 0,
      wornG: 300,
      consumableG: 0,
    })
  })

  it('skips assignments whose gear item no longer exists', () => {
    const assignments = [assign('alice', 'tent'), assign('alice', 'ghost')]
    expect(personGearTotals(assignments, gearById, 'alice')).toEqual({
      baseG: 540,
      wornG: 0,
      consumableG: 0,
    })
  })
})

describe('carryPackWeightG', () => {
  it('is gear base + gear consumable + that carry’s food (worn excluded)', () => {
    const gear = { baseG: 660, wornG: 200, consumableG: 100 }
    expect(carryPackWeightG(gear, 2000)).toBe(2760) // 660 + 100 + 2000; worn 200 not counted
  })
})

describe('personGearByCategory', () => {
  it('groups a person’s gear base/worn/consumable by category', () => {
    const byCat = personGearByCategory(
      [assign('alice', 'tent'), assign('alice', 'stove')],
      gearById,
      'alice',
    )
    expect(byCat.get('shelter')).toEqual({ baseG: 540, wornG: 0, consumableG: 0 })
    expect(byCat.get('cooking')).toEqual({ baseG: 120, wornG: 0, consumableG: 100 })
  })
})

describe('ownerPersonId', () => {
  const people = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]

  it('matches an owner name to a trip person, case-insensitively', () => {
    expect(ownerPersonId('Alice', people)).toBe('a')
    expect(ownerPersonId('  bob ', people)).toBe('b')
  })

  it('is undefined with no owner or no matching person', () => {
    expect(ownerPersonId(undefined, people)).toBeUndefined()
    expect(ownerPersonId('', people)).toBeUndefined()
    expect(ownerPersonId('Carol', people)).toBeUndefined()
  })
})
