// Plan generation (Epic 8). A greedy heuristic, not a solver: fill mains
// near typical calorie shares, fill snacks to close the gap, then fine-tune
// with a uniform quantity scale within bounds (resolved open item #3:
// 0.5×–1.5× of the source meal). Injected rng picks among the top
// candidates so "regenerate" (story 8.3) varies.

import { keyedSlots, type KeyedSlot } from './carries'
import { scaledDailyTarget } from './density'
import { rollUpMeal, scaledGrams } from './rollups'
import { activeDayFraction, entryTotals } from './totals'
import { defaultServingG } from './units'
import type { Day, Item, Meal, MealType, PlanPart, Person, PlanEntry, Trip } from './types'

export const DEFAULT_SCALE_BOUNDS = { min: 0.5, max: 1.5 }

/** Typical share of a day's calories per main; snacks share the rest. */
const MAIN_SHARES: Record<string, number> = { brekkie: 0.25, lunch: 0.3, dinner: 0.35 }
const SNACK_SHARE = 0.1

/** How many top-scored candidates the rng picks among. */
const VARIETY = 3

export type GeneratedEntry = Omit<PlanEntry, 'id'>

/** Smallest scale in [bounds] whose clamped calorie total reaches the
 *  target, to 2 decimals; the bound when the target is out of reach. */
function solveScale(
  caloriesAt: (s: number) => number,
  target: number,
  bounds: { min: number; max: number },
): number {
  if (caloriesAt(bounds.min) >= target) return bounds.min
  if (caloriesAt(bounds.max) <= target) return bounds.max
  let lo = bounds.min
  let hi = bounds.max
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2
    if (caloriesAt(mid) < target) lo = mid
    else hi = mid
  }
  return Math.round(hi * 100) / 100
}

export function generateDayPlan(args: {
  trip: Trip
  day: Day
  person: Person
  meals: Meal[]
  itemsById: ReadonlyMap<string, Item>
  /** This person's existing entries for this day. Locked picks and
   *  off-trail slots are kept and generated around (stories 8.1, 8.2). */
  existingEntries: PlanEntry[]
  rng: () => number
  scaleBounds?: { min: number; max: number }
}): GeneratedEntry[] {
  const { trip, day, person, meals, itemsById, existingEntries, rng } = args
  const bounds = args.scaleBounds ?? DEFAULT_SCALE_BOUNDS

  const byKey = new Map(existingEntries.map((e) => [e.slotKey, e]))
  const kept: PlanEntry[] = []
  const open: KeyedSlot[] = []
  for (const ks of keyedSlots(day)) {
    const existing = byKey.get(ks.key)
    if (existing && (existing.locked || existing.kind === 'offTrail')) kept.push(existing)
    else open.push(ks)
  }

  const target =
    scaledDailyTarget(person.baselineCalories, trip.dayTypeFactors[day.type]) *
    activeDayFraction(day)
  const keptCalories = kept.reduce(
    (n, e) => n + entryTotals(e, new Map(meals.map((m) => [m.id, m])), itemsById).calories,
    0,
  )
  const remaining = Math.max(0, target - keptCalories)

  // A generation candidate for a slot: either a library meal or a single
  // loose item tagged for this slot type (Epic 16). Both expose calories at a
  // quantity scale and the plan part they'd produce, so the picker and the
  // scale solver treat them uniformly.
  const candidatesByType = new Map<MealType, Candidate[]>()
  const eligible = (type: MealType): Candidate[] => {
    let list = candidatesByType.get(type)
    if (!list) {
      // Only vegetarian meals/items for vegetarian people (story 8.1).
      const mealCands: Candidate[] = meals
        .filter((m) => m.type === type)
        .map((meal) => ({ meal, rollup: rollUpMeal(meal, itemsById) }))
        .filter(({ rollup }) => rollup.calories > 0)
        .filter(({ rollup }) => !person.vegetarian || rollup.vegetarian)
        .map(({ meal, rollup }) => ({
          calories: rollup.calories,
          density: rollup.density,
          caloriesAt: (s: number) => rollUpMeal(meal, itemsById, s).calories,
          part: (s: number) => ({
            kind: 'meal' as const,
            mealId: meal.id,
            ...(s === 1 ? {} : { quantityScale: s }),
          }),
        }))

      const itemCands: Candidate[] = [...itemsById.values()]
        .filter((i) => (i.genMealTypes ?? []).includes(type))
        .filter((i) => i.caloriesPerGram > 0)
        .filter((i) => !person.vegetarian || i.vegetarian)
        .flatMap((item) => {
          const grams = defaultServingG(item) ?? item.inputWeightG
          if (!(grams > 0)) return []
          return [
            {
              calories: grams * item.caloriesPerGram,
              density: item.caloriesPerGram,
              caloriesAt: (s: number) => scaledGrams(grams, item, s) * item.caloriesPerGram,
              part: (s: number) => ({
                kind: 'item' as const,
                itemId: item.id,
                grams: Math.round(scaledGrams(grams, item, s) * 10) / 10,
              }),
            },
          ]
        })

      list = [...mealCands, ...itemCands]
      candidatesByType.set(type, list)
    }
    return list
  }

  // Closest to the slot target wins; density breaks ties so the heuristic
  // leans toward lighter packs.
  const pick = (type: MealType, slotTarget: number) => {
    const scored = eligible(type)
      .map((c) => ({ c, score: Math.abs(c.calories - slotTarget) }))
      .sort((a, b) => a.score - b.score || b.c.density - a.c.density)
    const top = scored.slice(0, VARIETY)
    return top.length > 0 ? top[Math.floor(rng() * top.length)].c : null
  }

  const openMains = open.filter((s) => s.slot.type !== 'snack')
  const openSnacks = open.filter((s) => s.slot.type === 'snack')
  const shareSum =
    openMains.reduce((n, s) => n + MAIN_SHARES[s.slot.type], 0) +
    openSnacks.length * SNACK_SHARE

  const chosen: { ks: KeyedSlot; cand: Candidate }[] = []
  for (const ks of openMains) {
    const slotTarget = shareSum > 0 ? remaining * (MAIN_SHARES[ks.slot.type] / shareSum) : 0
    const c = pick(ks.slot.type, slotTarget)
    if (c) chosen.push({ ks, cand: c })
  }

  // Snacks close whatever gap the mains left (story 8.1).
  let gap = remaining - chosen.reduce((n, c) => n + c.cand.calories, 0)
  for (let i = 0; i < openSnacks.length && gap > 0; i++) {
    const slotTarget = gap / (openSnacks.length - i)
    const c = pick('snack', slotTarget)
    if (!c) break
    chosen.push({ ks: openSnacks[i], cand: c })
    gap -= c.calories
  }

  // Fine-tune: one uniform quantity scale on the generated entries. Per-item
  // min/max bounds (§6.3) make calories-at-scale piecewise linear, so solve
  // by bisection instead of a closed form; it stays monotone in the scale.
  const caloriesAt = (s: number) => chosen.reduce((n, c) => n + c.cand.caloriesAt(s), 0)
  const scale = solveScale(caloriesAt, remaining, bounds)

  return chosen.map(({ ks, cand }) => ({
    tripId: trip.id,
    personId: person.id,
    dayIndex: day.index,
    slotKey: ks.key,
    kind: 'planned' as const,
    parts: [cand.part(scale)],
    locked: false,
  }))
}

/** A generation candidate — a meal or a tagged loose item — reduced to what
 *  the picker and scale solver need. */
interface Candidate {
  /** Calories at scale 1. */
  calories: number
  /** cal/g, used to break ties toward lighter packs. */
  density: number
  caloriesAt: (scale: number) => number
  part: (scale: number) => PlanPart
}
