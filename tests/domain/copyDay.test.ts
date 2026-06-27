import { describe, expect, it } from 'vitest'
import { copyDayPlan } from '../../src/domain/copyDay'
import { makeTrip, toggleMainSlot } from '../../src/domain/trip'
import { keyedSlots } from '../../src/domain/carries'
import type { Day, PlanEntry } from '../../src/domain/types'

const trip = makeTrip('t1', 'Test', 3)

function planned(slotKey: string, mealId: string, extra: Partial<PlanEntry> = {}): PlanEntry {
  return {
    id: `t1|p1|x|${slotKey}`,
    tripId: 't1',
    personId: 'p1',
    dayIndex: 1,
    slotKey,
    kind: 'planned',
    parts: [{ kind: 'meal', mealId }],
    ...extra,
  }
}

function mapOf(...entries: PlanEntry[]) {
  return new Map(entries.map((e) => [e.slotKey, e]))
}

describe('copyDayPlan', () => {
  it('copies the source slots onto an empty target day', () => {
    const source = mapOf(planned('brekkie:morning', 'porridge'), planned('lunch:midday', 'wrap'))
    const result = copyDayPlan({
      tripId: 't1',
      personId: 'p1',
      source,
      targets: [{ day: trip.days[1], existing: new Map() }],
    })
    expect(result.overwrites).toBe(0)
    expect(result.skippedLocked).toBe(0)
    const slotKeys = result.writes.map((w) => `${w.dayIndex}:${w.slotKey}`)
    expect(slotKeys).toContain('2:brekkie:morning')
    expect(slotKeys).toContain('2:lunch:midday')
    // the copy is a planned slot with the same parts, unlocked
    const brekkie = result.writes.find((w) => w.slotKey === 'brekkie:morning')!
    expect(brekkie.kind).toBe('planned')
    expect(brekkie.parts).toEqual([{ kind: 'meal', mealId: 'porridge' }])
    expect(brekkie.locked).toBeUndefined()
  })

  it('counts overwrites and leaves locked target slots untouched', () => {
    const source = mapOf(planned('brekkie:morning', 'porridge'))
    const targetExisting = mapOf(
      planned('brekkie:morning', 'old-meal', { id: 'x', dayIndex: 2, locked: true }),
    )
    const locked = copyDayPlan({
      tripId: 't1',
      personId: 'p1',
      source,
      targets: [{ day: trip.days[1], existing: targetExisting }],
    })
    expect(locked.skippedLocked).toBe(1)
    expect(locked.writes).toHaveLength(0) // locked slot is the only candidate

    const unlocked = copyDayPlan({
      tripId: 't1',
      personId: 'p1',
      source,
      targets: [
        {
          day: trip.days[1],
          existing: mapOf(planned('brekkie:morning', 'old-meal', { id: 'x', dayIndex: 2 })),
        },
      ],
    })
    expect(unlocked.overwrites).toBe(1)
    expect(unlocked.writes).toHaveLength(1)
  })

  it('only copies slots that exist on the target day (partial days)', () => {
    // Target day has no lunch or dinner (off trail by lunch).
    let partial: Day = { ...trip.days[2], index: 3 }
    partial = toggleMainSlot(partial, 'lunch')
    partial = toggleMainSlot(partial, 'dinner')
    const targetSlotKeys = new Set(keyedSlots(partial).map((k) => k.key))
    expect(targetSlotKeys.has('lunch:midday')).toBe(false)

    const source = mapOf(
      planned('brekkie:morning', 'porridge'),
      planned('lunch:midday', 'wrap'), // no matching slot on the partial day
    )
    const result = copyDayPlan({
      tripId: 't1',
      personId: 'p1',
      source,
      targets: [{ day: partial, existing: new Map() }],
    })
    const keys = result.writes.map((w) => w.slotKey)
    expect(keys).toContain('brekkie:morning')
    expect(keys).not.toContain('lunch:midday') // skipped — slot doesn't exist there
  })

  it('copies off-trail slots with their estimate', () => {
    const source = mapOf({
      id: 't1|p1|1|lunch:midday',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'lunch:midday',
      kind: 'offTrail',
      offTrailCalories: 700,
    })
    const result = copyDayPlan({
      tripId: 't1',
      personId: 'p1',
      source,
      targets: [{ day: trip.days[1], existing: new Map() }],
    })
    expect(result.writes[0]).toMatchObject({
      dayIndex: 2,
      slotKey: 'lunch:midday',
      kind: 'offTrail',
      offTrailCalories: 700,
    })
  })

  it('skips empty source slots', () => {
    const source = mapOf({
      id: 't1|p1|1|brekkie:morning',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'brekkie:morning',
      kind: 'planned',
      parts: [],
    })
    const result = copyDayPlan({
      tripId: 't1',
      personId: 'p1',
      source,
      targets: [{ day: trip.days[1], existing: new Map() }],
    })
    expect(result.writes).toHaveLength(0)
  })
})
