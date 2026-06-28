// Itinerary-driven day sizing (Epic 15). A day's effort = its distance plus
// an ascent penalty (default: 100 m of climb ≈ 1 km of flat), and that effort
// maps to the small/average/big/huge day type — which scales the calorie
// target via dayTypeFactors. Pure; no thresholds are stored.

import type { DayType } from './types'

/** Metres of ascent counted as one kilometre of flat distance. The classic
 *  hiker heuristic (Naismith/Scarf-ish); tunable per call. */
export const DEFAULT_ASCENT_PER_KM_M = 100

/** Distance plus the ascent penalty, in "effort kilometres". */
export function dayEffortKm(
  distanceKm: number,
  ascentM: number,
  ascentPerKmM: number = DEFAULT_ASCENT_PER_KM_M,
): number {
  return distanceKm + ascentM / ascentPerKmM
}

/** Upper bounds (exclusive) for each day type, in effort kilometres. Tuned
 *  for a strong hiker: a 25-26 effort-km day reads "average", and only long
 *  days (34+) tip into big. e.g. a 21 km day with 800 m climb = 29 → average. */
export const DEFAULT_EFFORT_THRESHOLDS = { small: 20, average: 34, big: 46 }

export function classifyDayType(
  effortKm: number,
  thresholds: { small: number; average: number; big: number } = DEFAULT_EFFORT_THRESHOLDS,
): DayType {
  if (effortKm < thresholds.small) return 'small'
  if (effortKm < thresholds.average) return 'average'
  if (effortKm < thresholds.big) return 'big'
  return 'huge'
}
