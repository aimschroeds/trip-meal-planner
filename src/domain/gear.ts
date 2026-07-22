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

/** Whether an item is worn by default (wearable): the library flags part of its
 *  weight as worn — clothing you put on. Worn is otherwise a per-trip choice, so
 *  this only sets the default; any item can be marked worn on a given trip. */
export function isWearable(item: Pick<GearItem, 'wornWeightG'>): boolean {
  return (item.wornWeightG ?? 0) > 0
}

/** How many of a person's units are worn when the trip hasn't said otherwise:
 *  all of them for a wearable item, none for everything else (it rides in the
 *  pack until you say you're wearing it). */
export function defaultWornQuantity(
  item: Pick<GearItem, 'wornWeightG'>,
  quantity: number | undefined,
): number {
  return isWearable(item) ? Math.max(1, Math.round(quantity ?? 1)) : 0
}

/** The base/worn/consumable one gear assignment contributes. Worn is a
 *  whole-unit, per-trip decision: each worn unit carries its full non-depleting
 *  weight on the body, each packed unit puts that same weight in the pack as
 *  base. The consumable portion (fuel gas) depletes per unit regardless of
 *  worn. Defaults: quantity 1; worn = all units for a wearable item, none
 *  otherwise (see defaultWornQuantity). */
export function assignmentGearTotals(
  item: Pick<GearItem, 'weightG' | 'wornWeightG' | 'consumableWeightG'>,
  quantity: number | undefined,
  wornQuantity: number | undefined,
): GearTotals {
  const total = Math.max(0, item.weightG)
  const consumablePerUnit = Math.min(Math.max(0, item.consumableWeightG ?? 0), total)
  const solidPerUnit = total - consumablePerUnit // non-depleting weight of one unit
  const n = Math.max(1, Math.round(quantity ?? 1))
  const worn = Math.min(Math.max(0, Math.round(wornQuantity ?? defaultWornQuantity(item, n))), n)
  const packed = n - worn
  return {
    baseG: packed * solidPerUnit,
    wornG: worn * solidPerUnit,
    consumableG: n * consumablePerUnit,
  }
}

/** The base/worn/consumable a person carries from their gear assignments.
 *  Assignments referencing a missing gear item (e.g. deleted) are skipped. */
/** Split a free-text owner field ("Alice, Bob") into distinct trimmed names. */
export function parseOwners(text: string): string[] {
  return [...new Set(text.split(/[,;]/).map((s) => s.trim()).filter(Boolean))]
}

/** Trip person ids whose names match a gear item's owner(s), case-insensitive.
 *  Empty when the item is shared (no owners) or no names match. Used to
 *  auto-assign personal gear to its owner(s) when added to a trip. */
export function ownerPersonIds(
  owners: readonly string[] | undefined,
  people: readonly { id: string; name: string }[],
): string[] {
  if (!owners || owners.length === 0) return []
  const keys = new Set(owners.map((o) => o.trim().toLowerCase()).filter(Boolean))
  return people.filter((p) => keys.has(p.name.trim().toLowerCase())).map((p) => p.id)
}

export function personGearTotals(
  assignments: Pick<GearAssignment, 'personId' | 'gearItemId' | 'quantity' | 'wornQuantity'>[],
  gearById: ReadonlyMap<string, GearItem>,
  personId: string,
): GearTotals {
  let totals = ZERO_GEAR_TOTALS
  for (const a of assignments) {
    if (a.personId !== personId) continue
    const item = gearById.get(a.gearItemId)
    if (item) totals = addGearTotals(totals, assignmentGearTotals(item, a.quantity, a.wornQuantity))
  }
  return totals
}

/** Full pack weight for one carry: the constant gear (base + its consumable,
 *  e.g. fuel) plus that carry's food (also consumable). Worn weight is on the
 *  body, not in the pack, so it's excluded. */
export function carryPackWeightG(gear: GearTotals, carryFoodG: number): number {
  return gear.baseG + gear.consumableG + carryFoodG
}

export interface FairShareRow {
  personId: string
  /** Total weight of this person's own (non-shared) gear. */
  personalG: number
  /** What they physically carry now (their personal gear + any shared items
   *  assigned to them in full). */
  physicalG: number
  /** What they *should* carry for fairness: personal + an equal split of the
   *  group's shared gear. */
  fairG: number
}

export interface FairShare {
  rows: FairShareRow[]
  /** Total weight of shared group gear on the trip. */
  sharedTotalG: number
  /** Each person's equal share of the shared gear. */
  perPersonSharedG: number
}

/** Split the trip's gear into personal vs a fair (equal) share of shared group
 *  gear. Shared gear is split evenly across everyone regardless of who happens
 *  to carry it, so one person over-packing personally doesn't change anyone
 *  else's shared obligation. Weight is total (item × quantity). */
export function fairShareBreakdown(
  assignments: Pick<GearAssignment, 'personId' | 'gearItemId' | 'quantity'>[],
  gearById: ReadonlyMap<string, GearItem>,
  personIds: readonly string[],
): FairShare {
  let sharedTotalG = 0
  const personal = new Map<string, number>()
  const physical = new Map<string, number>()
  for (const a of assignments) {
    const g = gearById.get(a.gearItemId)
    if (!g) continue
    const w = g.weightG * (a.quantity ?? 1)
    physical.set(a.personId, (physical.get(a.personId) ?? 0) + w)
    if (g.shared) sharedTotalG += w
    else personal.set(a.personId, (personal.get(a.personId) ?? 0) + w)
  }
  const perPersonSharedG = personIds.length > 0 ? sharedTotalG / personIds.length : 0
  const rows = personIds.map((personId) => {
    const personalG = personal.get(personId) ?? 0
    return {
      personId,
      personalG,
      physicalG: physical.get(personId) ?? 0,
      fairG: personalG + perPersonSharedG,
    }
  })
  return { rows, sharedTotalG, perPersonSharedG }
}

/** Base-weight-by-category for a person — the LighterPack-style breakdown.
 *  Keyed by category; each value is the base/worn/consumable split so the view
 *  can show, e.g., Big-3 base weight. */
export function personGearByCategory(
  assignments: Pick<GearAssignment, 'personId' | 'gearItemId' | 'quantity' | 'wornQuantity'>[],
  gearById: ReadonlyMap<string, GearItem>,
  personId: string,
): Map<string, GearTotals> {
  const byCategory = new Map<string, GearTotals>()
  for (const a of assignments) {
    if (a.personId !== personId) continue
    const item = gearById.get(a.gearItemId)
    if (!item) continue
    const prev = byCategory.get(item.category) ?? ZERO_GEAR_TOTALS
    byCategory.set(
      item.category,
      addGearTotals(prev, assignmentGearTotals(item, a.quantity, a.wornQuantity)),
    )
  }
  return byCategory
}
