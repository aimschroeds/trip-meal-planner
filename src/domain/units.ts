// Unit and package math (PLAN.md §9.6). Meal components and totals are
// always grams; these helpers convert to pieces ("2 tortillas") and whole
// packages ("buy 2 bags") for entry convenience and shopping lists.

import { scaledGrams } from './rollups'
import type { Carry, SlotRef } from './carries'
import { planKey } from './totals'
import type { Item, Meal, PlanEntry } from './types'

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
      if (!entry || entry.kind !== 'planned') continue
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
