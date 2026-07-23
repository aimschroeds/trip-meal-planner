import { describe, expect, it } from 'vitest'
import {
  assignmentOnCarry,
  assignmentQuantityOnCarry,
  baseWeightG,
  carryPackWeightG,
  consumableLoadOnCarry,
  consumableMaxLoad,
  fairShareBreakdown,
  categoryLabel,
  personConsumableTotalsForCarry,
  personGearTotalsForCarry,
  scaledGearTotals,
  defaultWornQuantity,
  gearWeightSplit,
  isBigThree,
  isWearable,
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

  it('wears the whole (non-consumable) weight of a plain item marked worn per trip', () => {
    // A 35 g sock with no library worn split: 2 pairs, 1 worn on the body → the
    // worn pair is 35 g worn, the other 35 g packed as base.
    const sock = { weightG: 35 }
    expect(assignmentGearTotals(sock, 2, 1)).toEqual({ baseG: 35, wornG: 35, consumableG: 0 })
  })

  it('defaults a plain (non-wearable) item to fully packed', () => {
    expect(assignmentGearTotals({ weightG: 35 }, 2, undefined)).toEqual({
      baseG: 70,
      wornG: 0,
      consumableG: 0,
    })
  })

  it('wears only the non-depleting part of a worn unit (fuel-in-a-worn-pouch edge)', () => {
    // Solid part rides on the body when worn; the consumable still depletes.
    const item = { weightG: 220, consumableWeightG: 100 }
    expect(assignmentGearTotals(item, 1, 1)).toEqual({ baseG: 0, wornG: 120, consumableG: 100 })
  })
})

describe('isWearable / defaultWornQuantity', () => {
  it('treats an item with worn weight as wearable (worn by default)', () => {
    expect(isWearable({ wornWeightG: 300 })).toBe(true)
    expect(defaultWornQuantity({ wornWeightG: 300 }, 2)).toBe(2)
  })

  it('treats a plain item as not worn by default', () => {
    expect(isWearable({})).toBe(false)
    expect(defaultWornQuantity({}, 2)).toBe(0)
  })
})

describe('personGearTotalsForCarry', () => {
  const map = new Map([
    ['jacket', { id: 'jacket', name: 'Rain shell', category: 'clothing', weightG: 300 }],
    ['soap', { id: 'soap', name: 'Big soap', category: 'hygiene', weightG: 120 }],
  ] as [string, GearItem][])

  it('rides unscoped gear on every carry, scoped gear only on its carries', () => {
    const assignments = [
      { personId: 'a', gearItemId: 'jacket' }, // every carry
      { personId: 'a', gearItemId: 'soap', carryKeys: ['c1', 'c2'] }, // carries c1 & c2 only
    ]
    // Carries c1/c2: jacket + soap. Carry c3: jacket only.
    expect(personGearTotalsForCarry(assignments, map, 'a', 'c1')).toEqual({
      baseG: 420,
      wornG: 0,
      consumableG: 0,
    })
    expect(personGearTotalsForCarry(assignments, map, 'a', 'c2')).toEqual({
      baseG: 420,
      wornG: 0,
      consumableG: 0,
    })
    expect(personGearTotalsForCarry(assignments, map, 'a', 'c3')).toEqual({
      baseG: 300,
      wornG: 0,
      consumableG: 0,
    })
  })

  it('assignmentOnCarry: no/empty scope is everywhere, else membership', () => {
    expect(assignmentOnCarry({}, 'c1')).toBe(true)
    expect(assignmentOnCarry({ carryKeys: [] }, 'c1')).toBe(true)
    expect(assignmentOnCarry({ carryKeys: ['c1'] }, 'c1')).toBe(true)
    expect(assignmentOnCarry({ carryKeys: ['c1'] }, 'c2')).toBe(false)
    expect(assignmentOnCarry({ carryKeys: ['c1', 'c3'] }, 'c3')).toBe(true)
  })

  it('carries a different amount per carry when carryQuantities is set', () => {
    // 2 pairs of socks on c1, 3 on c2, none on c3.
    const socks = new Map([
      ['socks', { id: 'socks', name: 'Socks', category: 'clothing', weightG: 35 }],
    ] as [string, GearItem][])
    const assignments = [
      { personId: 'a', gearItemId: 'socks', carryQuantities: { c1: 2, c2: 3 } },
    ]
    expect(personGearTotalsForCarry(assignments, socks, 'a', 'c1').baseG).toBe(70)
    expect(personGearTotalsForCarry(assignments, socks, 'a', 'c2').baseG).toBe(105)
    expect(personGearTotalsForCarry(assignments, socks, 'a', 'c3').baseG).toBe(0)
  })

  it('assignmentQuantityOnCarry: per-carry override, else quantity where it rides', () => {
    expect(assignmentQuantityOnCarry({ quantity: 2 }, 'c1')).toBe(2) // every carry
    expect(assignmentQuantityOnCarry({ quantity: 2, carryKeys: ['c1'] }, 'c2')).toBe(0)
    expect(assignmentQuantityOnCarry({ carryQuantities: { c1: 2, c2: 3 } }, 'c2')).toBe(3)
    expect(assignmentQuantityOnCarry({ carryQuantities: { c1: 2 } }, 'c3')).toBe(0)
  })

  it('assignmentOnCarry follows per-carry amounts (rides where amount > 0)', () => {
    expect(assignmentOnCarry({ carryQuantities: { c1: 2, c2: 0 } }, 'c1')).toBe(true)
    expect(assignmentOnCarry({ carryQuantities: { c1: 2, c2: 0 } }, 'c2')).toBe(false)
  })

  it('carries a different WEIGHT per carry when carryWeights is set (a map)', () => {
    // A 15 g map that's 19 g of sheets on c1, 15 g on c2, not carried on c3.
    const map = new Map([
      ['map', { id: 'map', name: 'Map', category: 'misc', weightG: 15 }],
    ] as [string, GearItem][])
    const assignments = [{ personId: 'a', gearItemId: 'map', carryWeights: { c1: 19, c2: 15 } }]
    expect(personGearTotalsForCarry(assignments, map, 'a', 'c1')).toEqual({
      baseG: 19,
      wornG: 0,
      consumableG: 0,
    })
    expect(personGearTotalsForCarry(assignments, map, 'a', 'c2')).toEqual({
      baseG: 15,
      wornG: 0,
      consumableG: 0,
    })
    expect(personGearTotalsForCarry(assignments, map, 'a', 'c3')).toEqual({
      baseG: 0,
      wornG: 0,
      consumableG: 0,
    })
  })

  it('scaledGearTotals splits a target weight in the item’s proportions', () => {
    // Plain item → all base.
    expect(scaledGearTotals({ weightG: 15 }, 19)).toEqual({ baseG: 19, wornG: 0, consumableG: 0 })
    // Fuel: 220 g = 120 base + 100 consumable; 110 g scales to half each.
    expect(scaledGearTotals({ weightG: 220, consumableWeightG: 100 }, 110)).toEqual({
      baseG: 60,
      wornG: 0,
      consumableG: 50,
    })
  })

  it('assignmentQuantityOnCarry is 0 for weight-varied items (measured in grams)', () => {
    expect(assignmentQuantityOnCarry({ carryWeights: { c1: 19 } }, 'c1')).toBe(0)
    expect(assignmentOnCarry({ carryWeights: { c1: 19, c2: 0 } }, 'c1')).toBe(true)
    expect(assignmentOnCarry({ carryWeights: { c1: 19, c2: 0 } }, 'c2')).toBe(false)
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

describe('trip consumables', () => {
  it('consumableLoadOnCarry: default load where it rides, null otherwise', () => {
    const soap = { baseG: 5, consumableG: 13 } // rides every carry
    expect(consumableLoadOnCarry(soap, 'c1')).toEqual({ baseG: 5, wornG: 0, consumableG: 13 })
    const pinned = { baseG: 5, consumableG: 13, carryKeys: ['c1'] }
    expect(consumableLoadOnCarry(pinned, 'c1')).toEqual({ baseG: 5, wornG: 0, consumableG: 13 })
    expect(consumableLoadOnCarry(pinned, 'c2')).toBeNull()
  })

  it('consumableLoadOnCarry: per-carry override wins; absent carry = not carried', () => {
    const soap = {
      baseG: 5,
      consumableG: 13,
      carryLoads: { c1: { baseG: 5, consumableG: 13 }, c2: { baseG: 7, consumableG: 20 } },
    }
    expect(consumableLoadOnCarry(soap, 'c1')).toEqual({ baseG: 5, wornG: 0, consumableG: 13 })
    expect(consumableLoadOnCarry(soap, 'c2')).toEqual({ baseG: 7, wornG: 0, consumableG: 20 })
    expect(consumableLoadOnCarry(soap, 'c3')).toBeNull()
  })

  it('personConsumableTotalsForCarry sums a person’s consumables on a carry', () => {
    const list = [
      { personId: 'a', baseG: 5, consumableG: 13, carryLoads: { c1: { baseG: 5, consumableG: 13 } } },
      { personId: 'a', baseG: 100, consumableG: 200 }, // fuel, every carry
      { personId: 'b', baseG: 9, consumableG: 9 }, // someone else
    ]
    expect(personConsumableTotalsForCarry(list, 'a', 'c1')).toEqual({
      baseG: 105,
      wornG: 0,
      consumableG: 213,
    })
    // c2: the soap isn't carried there, only the fuel.
    expect(personConsumableTotalsForCarry(list, 'a', 'c2')).toEqual({
      baseG: 100,
      wornG: 0,
      consumableG: 200,
    })
  })

  it('consumableMaxLoad picks the heaviest leg', () => {
    const soap = {
      baseG: 0,
      consumableG: 0,
      carryLoads: { c1: { baseG: 5, consumableG: 13 }, c2: { baseG: 7, consumableG: 20 } },
    }
    expect(consumableMaxLoad(soap, ['c1', 'c2'])).toEqual({ baseG: 7, wornG: 0, consumableG: 20 })
  })

  it('fairShareBreakdown folds in shared vs personal consumable extras', () => {
    // Alice carries shared fuel (300); Bob carries personal soap (18).
    const fair = fairShareBreakdown([], new Map(), ['alice', 'bob'], [
      { personId: 'alice', weightG: 300, shared: true },
      { personId: 'bob', weightG: 18 },
    ])
    expect(fair.sharedTotalG).toBe(300)
    expect(fair.perPersonSharedG).toBe(150)
    expect(fair.rows[0]).toEqual({ personId: 'alice', personalG: 0, physicalG: 300, fairG: 150 })
    expect(fair.rows[1]).toEqual({ personId: 'bob', personalG: 18, physicalG: 18, fairG: 168 })
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
