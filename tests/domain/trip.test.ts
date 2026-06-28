import { describe, expect, it } from 'vitest'
import {
  activeSnackTimings,
  defaultDaySlots,
  makeTrip,
  snackSlots,
  toggleMainSlot,
  withDayCount,
  withSnackCount,
} from '../../src/domain/trip'
import { DEFAULT_DAY_TYPE_FACTORS, type Day } from '../../src/domain/types'

describe('makeTrip', () => {
  it('creates the requested number of average days with full slots', () => {
    const trip = makeTrip('t1', 'GR20', 10)
    expect(trip.days).toHaveLength(10)
    expect(trip.days[0].index).toBe(1)
    expect(trip.days[9].index).toBe(10)
    expect(trip.days.every((d) => d.type === 'average')).toBe(true)
    expect(trip.dayTypeFactors).toEqual(DEFAULT_DAY_TYPE_FACTORS)
  })

  it('default day slots are brekkie, lunch, dinner + 2 snacks', () => {
    const types = defaultDaySlots().map((s) => s.type)
    expect(types).toEqual(['brekkie', 'lunch', 'dinner', 'snack', 'snack'])
  })

  it.each([0, -1, 2.5])('rejects numDays = %s', (n) => {
    expect(() => makeTrip('t1', 'Bad', n)).toThrow(RangeError)
  })
})

describe('snackSlots', () => {
  it('cycles timings morning → afternoon → evening', () => {
    expect(snackSlots(4).map((s) => s.timing)).toEqual([
      'morning',
      'afternoon',
      'evening',
      'morning',
    ])
  })

  it('cycles through a custom timing window', () => {
    expect(snackSlots(3, ['afternoon', 'evening']).map((s) => s.timing)).toEqual([
      'afternoon',
      'evening',
      'afternoon',
    ])
  })
})

const dayWith = (slots: Day['activeSlots']): Day => ({ index: 1, type: 'average', activeSlots: slots })

describe('activeSnackTimings', () => {
  it('uses the full cycle on a full day', () => {
    expect(activeSnackTimings(dayWith(defaultDaySlots()))).toEqual([
      'morning',
      'afternoon',
      'evening',
    ])
  })

  it('keeps a late-afternoon start (dinner only) out of the morning', () => {
    const day = dayWith([{ type: 'dinner', timing: 'evening' }])
    expect(activeSnackTimings(day)).toEqual(['afternoon', 'evening'])
  })

  it('uses morning/afternoon for an early finish (brekkie + lunch)', () => {
    const day = dayWith([
      { type: 'brekkie', timing: 'morning' },
      { type: 'lunch', timing: 'midday' },
    ])
    expect(activeSnackTimings(day)).toEqual(['morning', 'afternoon'])
  })

  it('falls back to the full cycle for a snacks-only day', () => {
    const day = dayWith([{ type: 'snack', timing: 'morning' }])
    expect(activeSnackTimings(day)).toEqual(['morning', 'afternoon', 'evening'])
  })
})

describe('withSnackCount', () => {
  it("times a lone snack on a dinner-only day in the afternoon, not the morning", () => {
    const day = dayWith([{ type: 'dinner', timing: 'evening' }])
    const next = withSnackCount(day, 1)
    const snacks = next.activeSlots.filter((s) => s.type === 'snack')
    expect(snacks).toEqual([{ type: 'snack', timing: 'afternoon' }])
  })
})

describe('toggleMainSlot', () => {
  it('re-times existing snacks when brekkie and lunch are dropped', () => {
    // Full day with one snack (morning), then drop brekkie and lunch.
    let day = dayWith([
      { type: 'brekkie', timing: 'morning' },
      { type: 'lunch', timing: 'midday' },
      { type: 'dinner', timing: 'evening' },
      { type: 'snack', timing: 'morning' },
    ])
    day = toggleMainSlot(day, 'brekkie')
    day = toggleMainSlot(day, 'lunch')
    expect(day.activeSlots.filter((s) => s.type !== 'snack').map((s) => s.type)).toEqual(['dinner'])
    expect(day.activeSlots.filter((s) => s.type === 'snack')).toEqual([
      { type: 'snack', timing: 'afternoon' },
    ])
  })
})

describe('withDayCount', () => {
  it('extends with default days, preserving existing configuration', () => {
    const trip = makeTrip('t1', 'GR20', 3)
    trip.days[2].type = 'huge'
    const extended = withDayCount(trip, 5)
    expect(extended.days).toHaveLength(5)
    expect(extended.days[2].type).toBe('huge')
    expect(extended.days[4]).toMatchObject({ index: 5, type: 'average' })
  })

  it('truncates from the end', () => {
    const trip = makeTrip('t1', 'GR20', 5)
    expect(withDayCount(trip, 2).days.map((d) => d.index)).toEqual([1, 2])
  })
})
