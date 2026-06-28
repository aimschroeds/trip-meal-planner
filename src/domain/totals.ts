// Day, carry, and trip summaries (Epic 7). All totals are derived from
// plan entries + the library; nothing is stored.

import { rollUpMeal } from './rollups'
import { scaledDailyTarget } from './density'
import type { Carry } from './carries'
import type { Day, DayType, Item, Meal, Person, PlanEntry } from './types'

export const DEFAULT_TOLERANCE = 0.05

/** Lookup key for a plan entry within a trip. */
export function planKey(personId: string, dayIndex: number, slotKey: string): string {
  return `${personId}|${dayIndex}|${slotKey}`
}

export interface EntryTotals {
  weightG: number
  calories: number
  /** Off-trail with no calorie estimate (story 6.2). */
  unestimated: boolean
}

export function entryTotals(
  entry: PlanEntry,
  mealsById: ReadonlyMap<string, Meal>,
  itemsById: ReadonlyMap<string, Item>,
): EntryTotals {
  if (entry.kind === 'offTrail') {
    // Off-trail meals contribute zero weight to any carry.
    return {
      weightG: 0,
      calories: entry.offTrailCalories ?? 0,
      unestimated: entry.offTrailCalories == null,
    }
  }
  // A planned slot is the sum of its parts (Epic 13): library meals plus any
  // loose items. Per-item bounds apply during meal scaling, so totals reflect
  // the clamped quantities generation actually produces.
  let weightG = 0
  let calories = 0
  for (const part of entry.parts ?? []) {
    if (part.kind === 'meal') {
      const meal = mealsById.get(part.mealId)
      if (!meal) throw new Error(`Plan entry ${entry.id} references missing meal ${part.mealId}`)
      const rollup = rollUpMeal(meal, itemsById, part.quantityScale ?? 1)
      weightG += rollup.weightG
      calories += rollup.calories
    } else {
      const item = itemsById.get(part.itemId)
      if (!item) throw new Error(`Plan entry ${entry.id} references missing item ${part.itemId}`)
      weightG += part.grams
      calories += part.grams * item.caloriesPerGram
    }
  }
  return { weightG, calories, unestimated: false }
}

export type DayStatus = 'ok' | 'under' | 'over' | 'partial'

export interface DayTotals {
  calories: number
  weightG: number
  target: number
  /** calories - target */
  delta: number
  /** delta / target */
  deltaPct: number
  unestimatedOffTrail: boolean
  status: DayStatus
}

/** Share of a full day's calories each meal carries. Used to scale the target
 *  on partial days (story 2.3): a town arrival where only dinner is on-trail
 *  shouldn't expect a whole day's calories in that one slot. A full day —
 *  all three mains plus any snacks — sums to 1.0. */
const MAIN_TARGET_SHARES: Record<string, number> = { brekkie: 0.25, lunch: 0.3, dinner: 0.3 }
const SNACK_TARGET_SHARE = 0.15

/** Fraction of a full day's target the day's *active* slots represent. Off-trail
 *  slots still count (the meal is eaten, just off-trail); only slots removed
 *  from the day (unchecked) shrink the target. Always 1.0 for a full day. */
export function activeDayFraction(day: Day): number {
  let fraction = 0
  let hasSnack = false
  for (const slot of day.activeSlots) {
    if (slot.type === 'snack') hasSnack = true
    else fraction += MAIN_TARGET_SHARES[slot.type] ?? 0
  }
  if (hasSnack) fraction += SNACK_TARGET_SHARE
  return Math.min(fraction, 1)
}

export function dayTotals(args: {
  day: Day
  person: Person
  factors: Record<DayType, number>
  /** This person's entries for this day. */
  entries: PlanEntry[]
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
  tolerance?: number
}): DayTotals {
  const { day, person, factors, entries, mealsById, itemsById } = args
  const tolerance = args.tolerance ?? DEFAULT_TOLERANCE

  let calories = 0
  let weightG = 0
  let unestimatedOffTrail = false
  for (const entry of entries) {
    const t = entryTotals(entry, mealsById, itemsById)
    calories += t.calories
    weightG += t.weightG
    unestimatedOffTrail ||= t.unestimated
  }

  const target =
    scaledDailyTarget(person.baselineCalories, factors[day.type]) * activeDayFraction(day)
  const delta = calories - target
  const deltaPct = target > 0 ? delta / target : 0

  let status: DayStatus = 'ok'
  if (deltaPct < -tolerance) {
    // A day missing only an off-trail estimate is "partially estimated",
    // not under target (story 6.2).
    status = unestimatedOffTrail ? 'partial' : 'under'
  } else if (deltaPct > tolerance) {
    status = 'over'
  }

  return { calories, weightG, target, delta, deltaPct, unestimatedOffTrail, status }
}

export interface MassTotals {
  weightG: number
  calories: number
  /** Average cal/g of on-trail food; 0 when weightless. */
  density: number
}

export const EMPTY_MASS: MassTotals = { weightG: 0, calories: 0, density: 0 }

function withDensity(weightG: number, calories: number): MassTotals {
  return { weightG, calories, density: weightG > 0 ? calories / weightG : 0 }
}

export function combineTotals(totals: MassTotals[]): MassTotals {
  const weightG = totals.reduce((n, t) => n + t.weightG, 0)
  const calories = totals.reduce((n, t) => n + t.calories, 0)
  return withDensity(weightG, calories)
}

export interface CarryTotals {
  perPerson: Map<string, MassTotals>
  group: MassTotals
}

/** What's on each back between resupplies (story 7.2). */
export function carryTotals(args: {
  carry: Carry
  personIds: string[]
  /** All of the trip's entries, keyed by planKey(). */
  entriesByKey: ReadonlyMap<string, PlanEntry>
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}): CarryTotals {
  const { carry, personIds, entriesByKey, mealsById, itemsById } = args
  const perPerson = new Map<string, MassTotals>()
  for (const personId of personIds) {
    let weightG = 0
    let calories = 0
    for (const ref of carry.slots) {
      const entry = entriesByKey.get(planKey(personId, ref.dayIndex, ref.key))
      if (!entry) continue
      const t = entryTotals(entry, mealsById, itemsById)
      weightG += t.weightG
      calories += t.calories
    }
    perPerson.set(personId, withDensity(weightG, calories))
  }
  return { perPerson, group: combineTotals([...perPerson.values()]) }
}
