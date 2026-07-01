// Unit and package math (PLAN.md §9.6). Meal components and totals are
// always grams; these helpers convert to pieces ("2 tortillas") and whole
// packages ("buy 2 bags") for entry convenience and shopping lists.

import { scaledGrams } from './rollups'
import type { Carry, SlotRef } from './carries'
import { planKey } from './totals'
import type { Item, Meal, MealType, PlanEntry } from './types'

export function gramsForUnits(item: Item, units: number): number | null {
  if (item.unitWeightG === undefined || !Number.isFinite(units) || units < 0) return null
  return units * item.unitWeightG
}

export function unitsForGrams(item: Item, grams: number): number | null {
  if (item.unitWeightG === undefined || item.unitWeightG <= 0) return null
  return grams / item.unitWeightG
}

/** A sensible default single serving in grams for the meal composer to
 *  prefill when this item is picked. An explicit `servingG` always wins;
 *  otherwise we infer from how the item was entered — a per-serving item's
 *  serving weight, then one piece, then a whole package. Raw per-gram /
 *  per-100g items carry no portion information, so they get no default
 *  (undefined) and the user types the quantity as before. */
export function defaultServingG(item: Item): number | undefined {
  if (item.servingG !== undefined && item.servingG > 0) return item.servingG
  if (item.inputBasis === 'per_serving' && item.inputWeightG > 0) return item.inputWeightG
  if (item.unitWeightG !== undefined && item.unitWeightG > 0) return item.unitWeightG
  if (item.inputBasis === 'per_package' && item.inputWeightG > 0) return item.inputWeightG
  return undefined
}

/** Whole packages to buy to cover `grams`. Only meaningful when the item
 *  was entered per package, so inputWeightG is the package weight. */
export function packagesForGrams(item: Item, grams: number): number | null {
  if (item.inputBasis !== 'per_package' || item.inputWeightG <= 0) return null
  return Math.ceil(grams / item.inputWeightG)
}

/** Total grams per item across the given slots, for every person, using the
 *  same clamped scaling as entryTotals. Off-trail slots carry nothing. */
function gramsBySlots(
  slots: readonly SlotRef[],
  personIds: string[],
  entriesByKey: ReadonlyMap<string, PlanEntry>,
  mealsById: ReadonlyMap<string, Meal>,
  itemsById: ReadonlyMap<string, Item>,
): Map<string, number> {
  const gramsByItem = new Map<string, number>()
  const add = (itemId: string, grams: number) =>
    gramsByItem.set(itemId, (gramsByItem.get(itemId) ?? 0) + grams)

  for (const personId of personIds) {
    for (const ref of slots) {
      const entry = entriesByKey.get(planKey(personId, ref.dayIndex, ref.key))
      for (const line of entryItemLines(entry, mealsById, itemsById)) {
        add(line.item.id, line.grams)
      }
    }
  }
  return gramsByItem
}

export interface ShoppingLine {
  item: Item
  /** Total grams of this item across the carry, all people, scaled. */
  grams: number
  /** Pieces (grams / unitWeightG); null when the item has no unit weight. */
  units: number | null
  /** Whole packages to buy; null unless the item was entered per package. */
  packages: number | null
}

export interface ItemLine {
  item: Item
  grams: number
}

/** Item-level breakdown of a single plan entry (a meal plus any loose items),
 *  merging duplicate items within the entry, heaviest first. Off-trail
 *  entries and missing/empty entries carry nothing. */
export function entryItemLines(
  entry: PlanEntry | undefined,
  mealsById: ReadonlyMap<string, Meal>,
  itemsById: ReadonlyMap<string, Item>,
): ItemLine[] {
  if (!entry || entry.kind !== 'planned') return []
  const gramsByItem = new Map<string, number>()
  const add = (itemId: string, grams: number) =>
    gramsByItem.set(itemId, (gramsByItem.get(itemId) ?? 0) + grams)
  for (const part of entry.parts ?? []) {
    if (part.kind === 'item') {
      add(part.itemId, part.grams)
      continue
    }
    const meal = mealsById.get(part.mealId)
    if (!meal) throw new Error(`Plan entry ${entry.id} references missing meal ${part.mealId}`)
    const scale = part.quantityScale ?? 1
    for (const c of meal.components) {
      const item = itemsById.get(c.itemId)
      if (!item) throw new Error(`Meal "${meal.name}" references missing item ${c.itemId}`)
      add(c.itemId, scale === 1 ? c.grams : scaledGrams(c.grams, item, scale))
    }
  }
  return [...gramsByItem.entries()]
    .map(([itemId, grams]) => ({ item: itemsById.get(itemId)!, grams }))
    .sort((a, b) => b.grams - a.grams)
}

export interface PrepGroup {
  mealType: MealType
  /** Stable identifier for this recipe within the carry (meal type + exact
   *  composition) — usable as a tick-off reference across re-renders. */
  key: string
  /** The exact composition to measure out — items and grams, heaviest first. */
  lines: ShoppingLine[]
  /** How many separate on-trail meals (across people and days, within this
   *  carry) share this exact composition — how many times to repeat it. */
  count: number
}

const PREP_MEAL_ORDER: Record<MealType, number> = { brekkie: 0, lunch: 1, dinner: 2, snack: 3 }

/** Groups every on-trail entry in a carry by meal type and exact food
 *  composition, so a person weighing out ingredients knows what to measure
 *  and how many times to repeat it, before anything gets packed. Two people
 *  eating an identical breakfast, or one person eating it on two different
 *  days, collapse into a single recipe with count 2 rather than two separate
 *  lines. Sorted by meal type (brekkie, lunch, dinner, snack), then by how
 *  many times each recipe repeats. */
export function carryPrepList(args: {
  carry: Carry
  personIds: string[]
  entriesByKey: ReadonlyMap<string, PlanEntry>
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}): PrepGroup[] {
  const { carry, personIds, entriesByKey, mealsById, itemsById } = args
  const groups = new Map<string, PrepGroup>()

  for (const personId of personIds) {
    for (const ref of carry.slots) {
      const entry = entriesByKey.get(planKey(personId, ref.dayIndex, ref.key))
      const itemLines = entryItemLines(entry, mealsById, itemsById)
      if (itemLines.length === 0) continue

      // The composition signature ignores who/which day — identical recipes
      // collapse together regardless of who's eating them or when.
      const signature = itemLines.map((l) => `${l.item.id}:${l.grams}`).join('|')
      const key = `${ref.slot.type}::${signature}`

      const existing = groups.get(key)
      if (existing) {
        existing.count += 1
        continue
      }
      groups.set(key, {
        mealType: ref.slot.type,
        key,
        count: 1,
        lines: itemLines.map((l) => ({
          item: l.item,
          grams: l.grams,
          units: unitsForGrams(l.item, l.grams),
          packages: null, // prep is a per-portion measure-out, not a whole-package buy
        })),
      })
    }
  }

  return [...groups.values()].sort(
    (a, b) => PREP_MEAL_ORDER[a.mealType] - PREP_MEAL_ORDER[b.mealType] || b.count - a.count,
  )
}

export interface PrepPortion {
  grams: number
  units: number | null
  /** How many recipes in the carry call for exactly this portion of this item. */
  count: number
}

export interface PrepIngredientTotal {
  item: Item
  /** Distinct portion sizes this item is needed at, heaviest/most-repeated
   *  first. A different portion size is kept separate — it's genuinely a
   *  different measure-out — but the same size repeated across recipes
   *  (same or different people/days) is summed into one count. */
  portions: PrepPortion[]
  /** Total grams of this item needed across the whole carry, all portions. */
  totalGrams: number
}

/** Pivots a carry's prep recipes (grouped by composition) into per-ingredient
 *  totals (grouped by item), for measuring out a shared ingredient in bulk
 *  before dividing it up into individual recipes — e.g. "5× 50 g oatmeal"
 *  measured once, rather than re-measuring 50 g five separate times. Sorted
 *  by total grams contributed to the carry, heaviest first. */
export function carryPrepIngredientTotals(groups: PrepGroup[]): PrepIngredientTotal[] {
  const byItem = new Map<string, { item: Item; portions: Map<number, PrepPortion> }>()
  for (const group of groups) {
    for (const line of group.lines) {
      let entry = byItem.get(line.item.id)
      if (!entry) {
        entry = { item: line.item, portions: new Map() }
        byItem.set(line.item.id, entry)
      }
      const existing = entry.portions.get(line.grams)
      if (existing) existing.count += group.count
      else entry.portions.set(line.grams, { grams: line.grams, units: line.units, count: group.count })
    }
  }
  return [...byItem.values()]
    .map(({ item, portions }) => {
      const sorted = [...portions.values()].sort((a, b) => b.count - a.count || b.grams - a.grams)
      const totalGrams = sorted.reduce((sum, p) => sum + p.grams * p.count, 0)
      return { item, portions: sorted, totalGrams }
    })
    .sort((a, b) => b.totalGrams - a.totalGrams)
}

/** What to PACK in one carry's resupply box: per-item gram totals across every
 *  person and slot, with piece counts where the item has a unit weight. Sorted
 *  heaviest first. Off-trail slots carry nothing. */
export function carryShoppingList(args: {
  carry: Carry
  personIds: string[]
  entriesByKey: ReadonlyMap<string, PlanEntry>
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}): ShoppingLine[] {
  const { carry, personIds, entriesByKey, mealsById, itemsById } = args
  const gramsByItem = gramsBySlots(carry.slots, personIds, entriesByKey, mealsById, itemsById)

  return [...gramsByItem.entries()]
    .map(([itemId, grams]) => {
      const item = itemsById.get(itemId)!
      return {
        item,
        grams,
        units: unitsForGrams(item, grams),
        packages: packagesForGrams(item, grams),
      }
    })
    .sort((a, b) => b.grams - a.grams)
}

/** How you actually buy an item at the store — whole packs, whole pieces, or
 *  by weight for bulk. You don't buy 248 g of a 180 g chocolate bar; you buy 2.
 *  Precedence: a per-package item → packs of its package weight; an item with a
 *  piece weight → whole pieces; a per-serving item → whole single-serve packs;
 *  anything else (per-gram / per-100g bulk) → by weight. */
export type PurchaseQuantity =
  | { kind: 'pack'; count: number; eachG: number }
  | { kind: 'piece'; count: number; unitName: string }
  | { kind: 'weight'; grams: number }

export function purchaseQuantity(item: Item, grams: number): PurchaseQuantity {
  if (item.inputBasis === 'per_package' && item.inputWeightG > 0) {
    return { kind: 'pack', count: Math.ceil(grams / item.inputWeightG), eachG: item.inputWeightG }
  }
  if (item.unitWeightG !== undefined && item.unitWeightG > 0) {
    return {
      kind: 'piece',
      count: Math.max(1, Math.ceil(grams / item.unitWeightG)),
      unitName: item.unitName || 'piece',
    }
  }
  if (item.inputBasis === 'per_serving' && item.inputWeightG > 0) {
    return { kind: 'pack', count: Math.ceil(grams / item.inputWeightG), eachG: item.inputWeightG }
  }
  return { kind: 'weight', grams }
}

export interface ShoppingItem {
  item: Item
  /** Total grams needed across the whole trip (all carries, all people). */
  grams: number
  /** How to buy it. */
  purchase: PurchaseQuantity
}

/** The whole-trip BUY list: one line per item, totalled across every carry and
 *  person, expressed in how you'd actually purchase it. Sorted by name so it
 *  reads like a grocery checklist. */
export function tripShoppingList(args: {
  carries: Carry[]
  personIds: string[]
  entriesByKey: ReadonlyMap<string, PlanEntry>
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}): ShoppingItem[] {
  const { carries, personIds, entriesByKey, mealsById, itemsById } = args
  const allSlots = carries.flatMap((c) => c.slots)
  const gramsByItem = gramsBySlots(allSlots, personIds, entriesByKey, mealsById, itemsById)

  return [...gramsByItem.entries()]
    .map(([itemId, grams]) => {
      const item = itemsById.get(itemId)!
      return { item, grams, purchase: purchaseQuantity(item, grams) }
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name))
}
