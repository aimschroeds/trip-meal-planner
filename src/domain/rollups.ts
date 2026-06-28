// Meal roll-ups (story 4.3): weight, calories, density, and vegetarian flag
// are always derived from the meal's components — never stored — so editing
// an item automatically updates every meal that contains it (story 4.6).

import type { Item, Meal, MealType } from './types'

/** The slot types a meal may be used in. A meal with an explicit `types` set
 *  is eligible for all of them; otherwise it falls back to its single `type`.
 *  This is the one read path for meal slot eligibility. */
export function mealSlotTypes(meal: Meal): MealType[] {
  return meal.types && meal.types.length > 0 ? meal.types : [meal.type]
}

export interface MealRollup {
  weightG: number
  calories: number
  /** cal/g; 0 for an empty meal. */
  density: number
  /** Vegetarian only if every component item is vegetarian. */
  vegetarian: boolean
}

/** A component's grams under a quantity scale, respecting the item's
 *  optional min/max bounds (§6.3). Bounds clamp the *scaling*, never the
 *  authored quantity: an item already outside its bounds stays at the
 *  authored grams rather than being pushed past them, so scale 1 is always
 *  the identity. */
export function scaledGrams(grams: number, item: Item, scale: number): number {
  const lo = item.minGrams !== undefined ? Math.min(item.minGrams, grams) : 0
  const hi = item.maxGrams !== undefined ? Math.max(item.maxGrams, grams) : Infinity
  return Math.min(Math.max(grams * scale, lo), hi)
}

export function rollUpMeal(
  meal: Meal,
  itemsById: ReadonlyMap<string, Item>,
  scale = 1,
): MealRollup {
  const missing = meal.components
    .map((c) => c.itemId)
    .filter((id) => !itemsById.has(id))
  if (missing.length > 0) {
    throw new Error(`Meal "${meal.name}" references missing items: ${missing.join(', ')}`)
  }

  let weightG = 0
  let calories = 0
  let vegetarian = true
  for (const { itemId, grams } of meal.components) {
    const item = itemsById.get(itemId)!
    const g = scale === 1 ? grams : scaledGrams(grams, item, scale)
    weightG += g
    calories += g * item.caloriesPerGram
    vegetarian &&= item.vegetarian
  }
  return {
    weightG,
    calories,
    density: weightG > 0 ? calories / weightG : 0,
    vegetarian,
  }
}
