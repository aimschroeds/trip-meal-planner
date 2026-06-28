// Trip construction and day-slot helpers (Epics 1 & 2).
// Partial first/last days are modeled by selecting which slots apply
// (resolved decision; story 2.3) — no fractional multiplier.

import {
  DEFAULT_DAY_TYPE_FACTORS,
  type Day,
  type Slot,
  type SlotTiming,
  type Trip,
} from './types'

const SNACK_TIMINGS: SlotTiming[] = ['morning', 'afternoon', 'evening']

/** Snack slots cycle through the given timings so mid-day resupplies can
 *  split them across carries (PLAN.md §6.1). */
export function snackSlots(count: number, timings: SlotTiming[] = SNACK_TIMINGS): Slot[] {
  const cycle = timings.length > 0 ? timings : SNACK_TIMINGS
  return Array.from({ length: count }, (_, i) => ({
    type: 'snack' as const,
    timing: cycle[i % cycle.length],
  }))
}

export function defaultDaySlots(snackCount = 2): Slot[] {
  return [
    { type: 'brekkie', timing: 'morning' },
    { type: 'lunch', timing: 'midday' },
    { type: 'dinner', timing: 'evening' },
    ...snackSlots(snackCount),
  ]
}

function makeDay(index: number): Day {
  return { index, type: 'average', activeSlots: defaultDaySlots() }
}

export function makeTrip(id: string, name: string, numDays: number): Trip {
  if (!Number.isInteger(numDays) || numDays < 1) {
    throw new RangeError(`numDays must be a positive integer, got ${numDays}`)
  }
  return {
    id,
    name,
    days: Array.from({ length: numDays }, (_, i) => makeDay(i + 1)),
    peopleIds: [],
    dayTypeFactors: { ...DEFAULT_DAY_TYPE_FACTORS },
  }
}

export type MainMealType = 'brekkie' | 'lunch' | 'dinner'

const MAIN_SLOT_TIMINGS: Record<MainMealType, SlotTiming> = {
  brekkie: 'morning',
  lunch: 'midday',
  dinner: 'evening',
}

export function hasMainSlot(day: Day, type: MainMealType): boolean {
  return day.activeSlots.some((s) => s.type === type)
}

export function snackCount(day: Day): number {
  return day.activeSlots.filter((s) => s.type === 'snack').length
}

/** Snack timings that fall within a day's active eating window, derived from
 *  which main meals are on. A late-afternoon start (dinner only) yields
 *  afternoon/evening snacks, never a nonsensical morning one; a full day keeps
 *  the morning → afternoon → evening cycle. Falls back to the full cycle for a
 *  snacks-only day. */
export function activeSnackTimings(day: Day): SlotTiming[] {
  const timings: SlotTiming[] = []
  if (hasMainSlot(day, 'brekkie')) timings.push('morning')
  if (hasMainSlot(day, 'lunch') || hasMainSlot(day, 'dinner')) timings.push('afternoon')
  if (hasMainSlot(day, 'dinner')) timings.push('evening')
  return timings.length > 0 ? timings : SNACK_TIMINGS
}

/** Add or remove a main meal slot — how partial days are edited (story 2.3).
 *  Snacks are re-timed to the new active window so dropping brekkie/lunch moves
 *  a lone snack out of the morning. */
export function toggleMainSlot(day: Day, type: MainMealType): Day {
  const mains = hasMainSlot(day, type)
    ? day.activeSlots.filter((s) => s.type !== type)
    : [...day.activeSlots, { type, timing: MAIN_SLOT_TIMINGS[type] }]
  const next = { ...day, activeSlots: mains }
  return withSnackCount(next, snackCount(next))
}

export function withSnackCount(day: Day, count: number): Day {
  return {
    ...day,
    activeSlots: [
      ...day.activeSlots.filter((s) => s.type !== 'snack'),
      ...snackSlots(count, activeSnackTimings(day)),
    ],
  }
}

/** Resize a trip, preserving existing day configuration where possible. */
export function withDayCount(trip: Trip, numDays: number): Trip {
  if (!Number.isInteger(numDays) || numDays < 1) {
    throw new RangeError(`numDays must be a positive integer, got ${numDays}`)
  }
  const days =
    numDays <= trip.days.length
      ? trip.days.slice(0, numDays)
      : [
          ...trip.days,
          ...Array.from({ length: numDays - trip.days.length }, (_, i) =>
            makeDay(trip.days.length + i + 1),
          ),
        ]
  return { ...trip, days }
}
