// Itinerary CSV codec (Epic 15): one row per day — day, name, distance_km,
// ascent_m — to set each day's leg name and planned distance/ascent in bulk.
// Applying it derives the day type from effort, which scales calorie targets.

import Papa from 'papaparse'
import { classifyDayType, dayEffortKm } from '../effort'
import type { Day } from '../types'
import type { CsvIssue } from './items'

export const ITINERARY_CSV_COLUMNS = ['day', 'distance_km', 'ascent_m'] as const
// `name` is optional on import; emitted on export.
export const ITINERARY_CSV_OPTIONAL_COLUMNS = ['name'] as const

export interface ItineraryRow {
  dayIndex: number
  name?: string
  distanceKm: number
  ascentM: number
}

export function parseItineraryCsv(text: string): { rows: ItineraryRow[]; issues: CsvIssue[] } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  })
  const rows: ItineraryRow[] = []
  const issues: CsvIssue[] = []

  const missing = ITINERARY_CSV_COLUMNS.filter((c) => !parsed.meta.fields?.includes(c))
  if (missing.length > 0) {
    return { rows, issues: [{ line: 1, reason: `missing column(s): ${missing.join(', ')}` }] }
  }

  const nonNegative = (raw: string | undefined): number | null => {
    if (raw === undefined || raw.trim() === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  parsed.data.forEach((raw, i) => {
    const line = i + 2
    const dayIndex = Number(raw.day)
    if (!Number.isInteger(dayIndex) || dayIndex < 1) {
      return issues.push({ line, reason: `day must be a positive integer, got "${raw.day}"` })
    }
    const distanceKm = nonNegative(raw.distance_km)
    if (distanceKm === null) {
      return issues.push({
        line,
        reason: `distance_km must be a non-negative number, got "${raw.distance_km}"`,
      })
    }
    const ascentM = nonNegative(raw.ascent_m)
    if (ascentM === null) {
      return issues.push({
        line,
        reason: `ascent_m must be a non-negative number, got "${raw.ascent_m}"`,
      })
    }
    const name = raw.name?.trim() || undefined
    rows.push({ dayIndex, name, distanceKm, ascentM })
  })

  return { rows, issues }
}

/** Apply itinerary rows to a trip's days: set each matched day's name,
 *  distance, ascent, and derive its type from effort. Rows whose day index
 *  isn't in the trip are reported as unmatched (not an error). Pure. */
export function applyItinerary(
  days: Day[],
  rows: ItineraryRow[],
): { days: Day[]; unmatched: number[] } {
  const byIndex = new Map(rows.map((r) => [r.dayIndex, r]))
  const present = new Set(days.map((d) => d.index))
  const unmatched = rows.filter((r) => !present.has(r.dayIndex)).map((r) => r.dayIndex)
  const updated = days.map((d) => {
    const r = byIndex.get(d.index)
    if (!r) return d
    return {
      ...d,
      name: r.name,
      distanceKm: r.distanceKm,
      ascentM: r.ascentM,
      type: classifyDayType(dayEffortKm(r.distanceKm, r.ascentM)),
    }
  })
  return { days: updated, unmatched }
}
