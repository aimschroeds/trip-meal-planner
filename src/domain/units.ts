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

  for (const personId of personIds) {
    for (const ref of carry.slots) {
      const entry = entriesByKey.get(planKey(personId, ref.dayIndex, ref.key))
      if (!entry || entry.kind !== 'meal') continue
      const meal = mealsById.get(entry.mealId ?? '')
      if (!meal) throw new Error(`Plan entry ${entry.id} references missing meal ${entry.mealId}`)
      const scale = entry.quantityScale ?? 1
      for (const c of meal.components) {
        const item = itemsById.get(c.itemId)
        if (!item) throw new Error(`Meal "${meal.name}" references missing item ${c.itemId}`)
        const g = scale === 1 ? c.grams : scaledGrams(c.grams, item, scale)
        gramsByItem.set(c.itemId, (gramsByItem.get(c.itemId) ?? 0) + g)
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
