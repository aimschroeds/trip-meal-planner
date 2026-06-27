// Copy a day's plan to other days (Epic 14). Multi-day trips repeat the same
// breakfast / lunch / snacks every day — the spreadsheet pain this app exists
// to remove — so you build one day and replicate it, then vary the dinners.
// Pure: this computes the plan-entry writes; the store applies them.

import { keyedSlots } from './carries'
import type { Day, PlanEntry, PlanPart } from './types'

export interface CopyDayResult {
  /** Entries to upsert across the target days. */
  writes: Omit<PlanEntry, 'id'>[]
  /** Target slots that already had content and will be replaced. */
  overwrites: number
  /** Locked target slots left untouched. */
  skippedLocked: number
}

function hasContent(e: PlanEntry | undefined): boolean {
  if (!e) return false
  return e.kind === 'offTrail' ? true : (e.parts?.length ?? 0) > 0
}

/** Replicate one day's slots onto other days for one person. Only slots that
 *  exist on both the source and a target day are copied (so partial first/last
 *  days neither lose nor gain slots); locked target slots are left untouched;
 *  the copy itself is unlocked. */
export function copyDayPlan(args: {
  tripId: string
  personId: string
  /** The source day's entries for this person, keyed by slotKey. */
  source: ReadonlyMap<string, PlanEntry>
  /** Target days with this person's existing entries keyed by slotKey. */
  targets: { day: Day; existing: ReadonlyMap<string, PlanEntry> }[]
}): CopyDayResult {
  const { tripId, personId, source, targets } = args
  const writes: Omit<PlanEntry, 'id'>[] = []
  let overwrites = 0
  let skippedLocked = 0

  for (const { day, existing } of targets) {
    for (const ks of keyedSlots(day)) {
      const src = source.get(ks.key)
      if (!hasContent(src)) continue // nothing to copy into this slot
      const tgt = existing.get(ks.key)
      if (tgt?.locked) {
        skippedLocked++
        continue
      }
      if (hasContent(tgt)) overwrites++
      const base = { tripId, personId, dayIndex: day.index, slotKey: ks.key }
      if (src!.kind === 'offTrail') {
        writes.push({
          ...base,
          kind: 'offTrail',
          ...(src!.offTrailCalories != null ? { offTrailCalories: src!.offTrailCalories } : {}),
        })
      } else {
        const parts: PlanPart[] = (src!.parts ?? []).map((p) => ({ ...p }))
        writes.push({ ...base, kind: 'planned', parts })
      }
    }
  }
  return { writes, overwrites, skippedLocked }
}
