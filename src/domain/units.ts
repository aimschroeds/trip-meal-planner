// Unit and package math (PLAN.md §9.6). Meal components and totals are
// always grams; these helpers convert to pieces ("2 tortillas") and whole
// packages ("buy 2 bags") for entry convenience and shopping lists.

import { scaledGrams } from './rollups'
import type { Carry } from './carries'
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

export interface ShoppingLine {
  item: Item
  /** Total grams of this item across the carry, all people, scaled. */
  grams: number
  /** Pieces (grams / unitWeightG); null when the item has no unit weight. */
  units: number | null
  /** Whole packages to buy; null unless the item was entered per package. */
  packages: number | null
}

/** What to buy for one carry: per-item gram totals across every person and
 *  slot, using the same clamped scaling as entryTotals, sorted heaviest
 *  first (story-level rationale in PLAN.md §9.6). Off-trail slots carry
 *  nothing and are skipped. */
export function carryShoppingList(args: {
  carry: Carry
  personIds: string[]
  entriesByKey: ReadonlyMap<string, PlanEntry>
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}): ShoppingLine[] {
  const { carry, personIds, entriesByKey, mealsById, itemsById } = args
  const gramsByItem = new Map<string, number>()

  const add = (itemId: string, grams: number) =>
    gramsByItem.set(itemId, (gramsByItem.get(itemId) ?? 0) + grams)

  for (const personId of personIds) {
    for (const ref of carry.slots) {
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
