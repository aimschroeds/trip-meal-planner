import { describe, expect, it } from 'vitest'
import { baseWeightG, categoryLabel, gearWeightSplit, isBigThree } from '../../src/domain/gear'

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
