import { describe, expect, it } from 'vitest'
import {
  baseWeightG,
  carryPackWeightG,
  fairShareBreakdown,
  categoryLabel,
  gearWeightSplit,
  isBigThree,
  assignmentGearTotals,
  ownerPersonIds,
  parseOwners,
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

describe('assignmentGearTotals (worn count)', () => {
  const socks = { weightG: 100, wornWeightG: 100 } // fully worn when worn

  it('splits worn vs packed units — 3 pairs, 1 worn', () => {
    // 1 worn (100 g worn) + 2 packed (200 g base).
    expect(assignmentGearTotals(socks, 3, 1)).toEqual({ baseG: 200, wornG: 100, consumableG: 0 })
  })

  it('defaults to all worn (backward compatible)', () => {
    expect(assignmentGearTotals(socks, 3, undefined)).toEqual({
      baseG: 0,
      wornG: 300,
      consumableG: 0,
    })
  })

  it('keeps consumable per unit regardless of worn', () => {
    const fuel = { weightG: 220, consumableWeightG: 100 }
    expect(assignmentGearTotals(fuel, 2, 0)).toEqual({ baseG: 240, wornG: 0, consumableG: 200 })
  })
})

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

  it('multiplies weight by an assignment quantity (e.g. 2 pairs of socks)', () => {
    const assignments = [{ ...assign('alice', 'stove'), quantity: 2 }]
    // Fuel: 120 base + 100 consumable, ×2.
    expect(personGearTotals(assignments, gearById, 'alice')).toEqual({
      baseG: 240,
      wornG: 0,
      consumableG: 200,
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

describe('fairShareBreakdown', () => {
  it('splits shared gear evenly; personal is each person’s own', () => {
    // Alice carries the shared tent (540) + her puffy (300). Bob: quilt (400).
    const assignments = [
      { personId: 'alice', gearItemId: 'tent' },
      { personId: 'alice', gearItemId: 'puffy' },
      { personId: 'bob', gearItemId: 'quilt' },
    ]
    const map = new Map([
      ['tent', { id: 'tent', name: 'Tent', category: 'shelter', weightG: 540, shared: true }],
      ['puffy', { id: 'puffy', name: 'Puffy', category: 'clothing', weightG: 300 }],
      ['quilt', { id: 'quilt', name: 'Quilt', category: 'sleep', weightG: 400 }],
    ] as [string, GearItem][])
    const fair = fairShareBreakdown(assignments, map, ['alice', 'bob'])
    expect(fair.sharedTotalG).toBe(540)
    expect(fair.perPersonSharedG).toBe(270)
    // Alice: personal 300, carrying 840 (tent+puffy), fair 570 → over by 270.
    expect(fair.rows[0]).toEqual({ personId: 'alice', personalG: 300, physicalG: 840, fairG: 570 })
    // Bob: personal 400, carrying 400, fair 670 → under by 270.
    expect(fair.rows[1]).toEqual({ personId: 'bob', personalG: 400, physicalG: 400, fairG: 670 })
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

describe('parseOwners', () => {
  it('splits on commas/semicolons, trims, and dedupes', () => {
    expect(parseOwners('Alice, Bob ; Alice')).toEqual(['Alice', 'Bob'])
    expect(parseOwners('  ')).toEqual([])
  })
})

describe('ownerPersonIds', () => {
  const people = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ]

  it('matches every owner name to a trip person, case-insensitively', () => {
    expect(ownerPersonIds(['Alice'], people)).toEqual(['a'])
    expect(ownerPersonIds(['alice', 'BOB'], people)).toEqual(['a', 'b'])
  })

  it('is empty for shared gear (no owners) or unmatched names', () => {
    expect(ownerPersonIds(undefined, people)).toEqual([])
    expect(ownerPersonIds([], people)).toEqual([])
    expect(ownerPersonIds(['Carol'], people)).toEqual([])
  })
})
