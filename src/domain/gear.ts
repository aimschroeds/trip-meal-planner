// Pure gear helpers (Gear epic). Weight breakdowns are derived here, never
// stored — mirrors how food roll-ups and carries work. The trip-level roll-ups
// (per person, per carry, food + gear combined) build on baseWeightG.

import type { GearAssignment, GearItem } from './types'

/** Curated categories offered in the picker; custom strings are also allowed.
 *  Order roughly heaviest-first / Big-3-first for a sensible default listing. */
export const GEAR_CATEGORIES = [
  'shelter',
  'sleep',
  'pack',
  'cooking',
  'water',
  'clothing',
  'electronics',
  'hygiene',
  'navigation',
  'misc',
] as const

export type CuratedCategory = (typeof GEAR_CATEGORIES)[number]

/** The "Big 3" — pack, shelter, sleep system — dominate base weight, so they
 *  get grouped in the breakdown. */
export const BIG_THREE: readonly string[] = ['pack', 'shelter', 'sleep']

export function isBigThree(category: string): boolean {
  return BIG_THREE.includes(category)
}

const CATEGORY_LABEL: Record<CuratedCategory, string> = {
  shelter: 'Shelter',
  sleep: 'Sleep',
  pack: 'Pack',
  cooking: 'Cooking',
  water: 'Water',
  clothing: 'Clothing',
  electronics: 'Electronics',
  hygiene: 'Hygiene / first aid',
  navigation: 'Navigation',
  misc: 'Misc',
}

/** Human label for a category — curated ones get a nice name, custom ones show
 *  as typed. */
export function categoryLabel(category: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[category] ?? category
}

export interface GearWeightSplit {
  /** In-pack, non-depleting weight — the base-weight contribution. */
  baseG: number
  /** Worn on the body, not in the pack. */
  wornG: number
  /** Depletes over the trip. */
  consumableG: number
}

/** Split an item's total weight into base / worn / consumable. Worn and
 *  consumable are clamped so they never exceed the total (base can't go
 *  negative); base is whatever remains. */
export function gearWeightSplit(
  item: Pick<GearItem, 'weightG' | 'wornWeightG' | 'consumableWeightG'>,
): GearWeightSplit {
  const total = Math.max(0, item.weightG)
  const wornG = Math.min(Math.max(0, item.wornWeightG ?? 0), total)
  const consumableG = Math.min(Math.max(0, item.consumableWeightG ?? 0), total - wornG)
  return { baseG: total - wornG - consumableG, wornG, consumableG }
}

/** The base-weight contribution of an item: total minus worn minus consumable. */
export function baseWeightG(
  item: Pick<GearItem, 'weightG' | 'wornWeightG' | 'consumableWeightG'>,
): number {
  return gearWeightSplit(item).baseG
}

export interface GearTotals {
  baseG: number
  wornG: number
  consumableG: number
}

export const ZERO_GEAR_TOTALS: GearTotals = { baseG: 0, wornG: 0, consumableG: 0 }

export function addGearTotals(a: GearTotals, b: GearTotals): GearTotals {
  return {
    baseG: a.baseG + b.baseG,
    wornG: a.wornG + b.wornG,
    consumableG: a.consumableG + b.consumableG,
  }
}

export function gearTotalG(t: GearTotals): number {
  return t.baseG + t.wornG + t.consumableG
}

/** The base/worn/consumable a person carries from their gear assignments.
 *  Assignments referencing a missing gear item (e.g. deleted) are skipped. */
export function personGearTotals(
  assignments: Pick<GearAssignment, 'personId' | 'gearItemId'>[],
  gearById: ReadonlyMap<string, GearItem>,
  personId: string,
): GearTotals {
  let totals = ZERO_GEAR_TOTALS
  for (const a of assignments) {
    if (a.personId !== personId) continue
    const item = gearById.get(a.gearItemId)
    if (item) totals = addGearTotals(totals, gearWeightSplit(item))
  }
  return totals
}

/** Full pack weight for one carry: the constant gear (base + its consumable,
 *  e.g. fuel) plus that carry's food (also consumable). Worn weight is on the
 *  body, not in the pack, so it's excluded. */
export function carryPackWeightG(gear: GearTotals, carryFoodG: number): number {
  return gear.baseG + gear.consumableG + carryFoodG
}

/** Base-weight-by-category for a person — the LighterPack-style breakdown.
 *  Keyed by category; each value is the base/worn/consumable split so the view
 *  can show, e.g., Big-3 base weight. */
export function personGearByCategory(
  assignments: Pick<GearAssignment, 'personId' | 'gearItemId'>[],
  gearById: ReadonlyMap<string, GearItem>,
  personId: string,
): Map<string, GearTotals> {
  const byCategory = new Map<string, GearTotals>()
  for (const a of assignments) {
    if (a.personId !== personId) continue
    const item = gearById.get(a.gearItemId)
    if (!item) continue
    const prev = byCategory.get(item.category) ?? ZERO_GEAR_TOTALS
    byCategory.set(item.category, addGearTotals(prev, gearWeightSplit(item)))
  }
  return byCategory
}
