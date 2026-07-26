// Pure gear helpers (Gear epic). Weight breakdowns are derived here, never
// stored — mirrors how food roll-ups and carries work. The trip-level roll-ups
// (per person, per carry, food + gear combined) build on baseWeightG.

import type { GearAssignment, GearItem, TripConsumable } from './types'

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

/** Key for a person's pack-checklist tick on a gear item — shared between the
 *  trip Gear tab and the shopping-tab packing list so a tick made in either
 *  place stays in sync. Quantity is baked in so bumping how many you carry
 *  un-ticks the item. */
export function gearPackRef(personId: string, gearItemId: string, quantity: number): string {
  return `${gearPackLegacyRef(personId, gearItemId)}:${quantity}`
}

/** Pre-quantity pack-checklist key, kept so ticks made before quantity was
 *  folded into the key still register as packed. */
export function gearPackLegacyRef(personId: string, gearItemId: string): string {
  return `gear:${personId}:${gearItemId}`
}

/** Whether a person's copies of a gear item are ticked off on the pack
 *  checklist, honoring both the current and legacy key. */
export function isGearPacked(
  packed: ReadonlySet<string>,
  personId: string,
  gearItemId: string,
  quantity: number,
): boolean {
  return (
    packed.has(gearPackRef(personId, gearItemId, quantity)) ||
    packed.has(gearPackLegacyRef(personId, gearItemId))
  )
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

/** Raw (string) fields for a gear-library add/edit form, before validation. */
export interface GearDraftFields {
  name: string
  brand?: string
  owner?: string
  category?: string
  weightG: number | undefined
  wornWeightG?: number
  consumableWeightG?: number
  shared?: boolean
}

/** Validate and assemble a library gear item from draft form fields — shared
 *  by the full Gear-library form and the quick-add form in the gear picker,
 *  so both enforce the same rules. Returns an error message on failure. */
export function buildGearItem(id: string, draft: GearDraftFields): GearItem | string {
  const name = draft.name.trim()
  if (!name) return 'Name is required.'
  if (draft.weightG == null || draft.weightG <= 0) return 'Enter a total weight in grams.'
  const worn = draft.wornWeightG ?? 0
  const consumable = draft.consumableWeightG ?? 0
  if (worn + consumable > draft.weightG) {
    return 'Worn + consumable can’t exceed the total weight.'
  }
  const owners = parseOwners(draft.owner ?? '')
  return {
    id,
    name,
    brand: draft.brand?.trim() || undefined,
    owners: owners.length ? owners : undefined,
    category: draft.category?.trim() || 'misc',
    weightG: draft.weightG,
    wornWeightG: worn || undefined,
    consumableWeightG: consumable || undefined,
    shared: draft.shared || undefined,
  }
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

/** Whether an assignment rides a given carry. Per-carry quantities win when set
 *  (a carry with a positive amount rides); otherwise unscoped gear (no carryKeys,
 *  or an empty list) rides every carry and scoped gear only its listed carries. */
export function assignmentOnCarry(
  a: Pick<GearAssignment, 'carryKeys' | 'carryQuantities' | 'carryWeights'>,
  carryKey: string,
): boolean {
  if (a.carryWeights) return Math.max(0, a.carryWeights[carryKey] ?? 0) > 0
  if (a.carryQuantities) return Math.round(a.carryQuantities[carryKey] ?? 0) > 0
  return !a.carryKeys || a.carryKeys.length === 0 || a.carryKeys.includes(carryKey)
}

/** How many units this assignment carries on a given carry: a per-carry override
 *  when set, otherwise the single quantity on the carries it rides (0 if not).
 *  Zero for weight-varied items (they're measured in grams, not units). */
export function assignmentQuantityOnCarry(
  a: Pick<GearAssignment, 'quantity' | 'carryKeys' | 'carryQuantities' | 'carryWeights'>,
  carryKey: string,
): number {
  if (a.carryWeights) return 0
  if (a.carryQuantities) return Math.max(0, Math.round(a.carryQuantities[carryKey] ?? 0))
  return assignmentOnCarry(a, carryKey) ? Math.max(1, Math.round(a.quantity ?? 1)) : 0
}

/** Split a target total weight into base/worn/consumable in the item's library
 *  proportions — used when an assignment overrides an item's weight per carry.
 *  A plain item (all base, e.g. a map) stays all base. */
export function scaledGearTotals(
  item: Pick<GearItem, 'weightG' | 'wornWeightG' | 'consumableWeightG'>,
  totalG: number,
): GearTotals {
  const w = Math.max(0, totalG)
  const unit = gearWeightSplit(item)
  const denom = unit.baseG + unit.wornG + unit.consumableG
  if (denom <= 0) return { baseG: w, wornG: 0, consumableG: 0 }
  const f = w / denom
  return { baseG: unit.baseG * f, wornG: unit.wornG * f, consumableG: unit.consumableG * f }
}

/** The base/worn/consumable one assignment contributes on a given carry —
 *  handling per-carry weight (grams) and per-carry / trip-wide quantity (count)
 *  uniformly. Zero when the item isn't carried on that leg. */
export function assignmentTotalsOnCarry(
  item: Pick<GearItem, 'weightG' | 'wornWeightG' | 'consumableWeightG'>,
  a: Pick<GearAssignment, 'quantity' | 'wornQuantity' | 'carryKeys' | 'carryQuantities' | 'carryWeights'>,
  carryKey: string,
): GearTotals {
  if (a.carryWeights) {
    const w = Math.max(0, a.carryWeights[carryKey] ?? 0)
    return w > 0 ? scaledGearTotals(item, w) : ZERO_GEAR_TOTALS
  }
  const qty = assignmentQuantityOnCarry(a, carryKey)
  return qty > 0 ? assignmentGearTotals(item, qty, a.wornQuantity) : ZERO_GEAR_TOTALS
}

/** The base/worn/consumable a person carries on one specific carry — trip-wide
 *  gear plus anything pinned to that carry (a heavier rain shell, extra soap). */
export function personGearTotalsForCarry(
  assignments: Pick<
    GearAssignment,
    | 'personId'
    | 'gearItemId'
    | 'quantity'
    | 'wornQuantity'
    | 'carryKeys'
    | 'carryQuantities'
    | 'carryWeights'
  >[],
  gearById: ReadonlyMap<string, GearItem>,
  personId: string,
  carryKey: string,
): GearTotals {
  let totals = ZERO_GEAR_TOTALS
  for (const a of assignments) {
    if (a.personId !== personId) continue
    const item = gearById.get(a.gearItemId)
    if (!item) continue
    totals = addGearTotals(totals, assignmentTotalsOnCarry(item, a, carryKey))
  }
  return totals
}

/** The load a trip consumable contributes on a given carry, or null if it isn't
 *  carried there. Per-carry overrides (carryLoads) win; otherwise the default
 *  load applies on the carries it rides (every carry when unscoped). */
export function consumableLoadOnCarry(
  c: Pick<TripConsumable, 'baseG' | 'consumableG' | 'carryKeys' | 'carryLoads'>,
  carryKey: string,
): GearTotals | null {
  if (c.carryLoads) {
    const l = c.carryLoads[carryKey]
    return l
      ? { baseG: Math.max(0, l.baseG), wornG: 0, consumableG: Math.max(0, l.consumableG) }
      : null
  }
  const rides = !c.carryKeys || c.carryKeys.length === 0 || c.carryKeys.includes(carryKey)
  return rides
    ? { baseG: Math.max(0, c.baseG), wornG: 0, consumableG: Math.max(0, c.consumableG) }
    : null
}

/** Base + consumable a person's trip consumables add on one carry. */
export function personConsumableTotalsForCarry(
  consumables: Pick<
    TripConsumable,
    'personId' | 'baseG' | 'consumableG' | 'carryKeys' | 'carryLoads'
  >[],
  personId: string,
  carryKey: string,
): GearTotals {
  let t = ZERO_GEAR_TOTALS
  for (const c of consumables) {
    if (c.personId !== personId) continue
    const load = consumableLoadOnCarry(c, carryKey)
    if (load) t = addGearTotals(t, load)
  }
  return t
}

/** The heaviest load a consumable reaches across the given carries (or its
 *  default load when no carries are derived yet) — for at-a-glance summaries. */
export function consumableMaxLoad(
  c: Pick<TripConsumable, 'baseG' | 'consumableG' | 'carryKeys' | 'carryLoads'>,
  carryKeys: readonly string[],
): GearTotals {
  if (carryKeys.length === 0) {
    return { baseG: Math.max(0, c.baseG), wornG: 0, consumableG: Math.max(0, c.consumableG) }
  }
  let best = ZERO_GEAR_TOTALS
  let bestTotal = -1
  for (const k of carryKeys) {
    const load = consumableLoadOnCarry(c, k)
    if (load && gearTotalG(load) > bestTotal) {
      best = load
      bestTotal = gearTotalG(load)
    }
  }
  return best
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
  /** Extra weights not backed by a library item — e.g. trip consumables'
   *  load on the relevant carry. Split evenly when shared, personal otherwise. */
  extras: readonly { personId: string; weightG: number; shared?: boolean }[] = [],
): FairShare {
  let sharedTotalG = 0
  const personal = new Map<string, number>()
  const physical = new Map<string, number>()
  const add = (personId: string, weightG: number, shared: boolean | undefined) => {
    physical.set(personId, (physical.get(personId) ?? 0) + weightG)
    if (shared) sharedTotalG += weightG
    else personal.set(personId, (personal.get(personId) ?? 0) + weightG)
  }
  for (const a of assignments) {
    const g = gearById.get(a.gearItemId)
    if (!g) continue
    add(a.personId, g.weightG * (a.quantity ?? 1), g.shared)
  }
  for (const e of extras) add(e.personId, e.weightG, e.shared)
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
