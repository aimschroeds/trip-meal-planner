import type { MealType, ResupplyTiming, Slot } from '../domain/types'
import type { PurchaseQuantity, ShoppingLine } from '../domain/units'

export const fmtDensity = (calPerGram: number) => `${calPerGram.toFixed(2)} cal/g`
export const fmtGrams = (g: number) => `${Math.round(g)} g`
export const fmtCalories = (cal: number) => `${Math.round(cal)} cal`

/** Friendly headers for the prep list ("Breakfast", not "brekkie") — used
 *  only there; the rest of the app uses the raw slot type. */
export const MEAL_TYPE_LABEL: Record<MealType, string> = {
  brekkie: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
}

/** One ingredient in a prep line: "Oatmeal 80g" or, for a piece-weight item,
 *  "Justin's Peanut Butter 1 sachet". */
export const fmtPrepIngredient = (l: ShoppingLine): string => {
  const name = (l.item.brand ? `${l.item.brand} ` : '') + l.item.name
  if (l.units !== null) {
    const count = Math.round(l.units * 10) / 10
    return `${name} ${count} ${(l.item.unitName || 'piece') + (count === 1 ? '' : 's')}`
  }
  return `${name} ${fmtGrams(l.grams)}`
}

/** How to buy an item, in plain words ("2 × 180 g packs", "7 tortillas",
 *  "≈ 250 g"). Weight is rounded up to the nearest 5 g — you buy a bag. */
export const fmtPurchase = (p: PurchaseQuantity): string => {
  if (p.kind === 'pack') {
    return `${p.count} × ${Math.round(p.eachG)} g pack${p.count === 1 ? '' : 's'}`
  }
  if (p.kind === 'piece') {
    return `${p.count} ${p.unitName}${p.count === 1 ? '' : 's'}`
  }
  return `≈ ${Math.ceil(p.grams / 5) * 5} g`
}

export const fmtSlot = (slot: Slot) =>
  slot.type === 'snack' ? `snack (${slot.timing})` : slot.type

/** Resupply timings in chronological order, with their display labels —
 *  shared by Setup (the picker) and the Plan view (the day reminder). */
export const RESUPPLY_TIMINGS: { value: ResupplyTiming; label: string }[] = [
  { value: 'before_breakfast', label: 'before brekkie' },
  { value: 'after_breakfast', label: 'after brekkie' },
  { value: 'before_lunch', label: 'before lunch' },
  { value: 'after_lunch', label: 'after lunch' },
  { value: 'late_afternoon', label: 'late afternoon (before dinner)' },
  { value: 'after_dinner', label: 'after dinner' },
]

export const resupplyTimingLabel = (t: ResupplyTiming) =>
  RESUPPLY_TIMINGS.find((rt) => rt.value === t)?.label ?? t
