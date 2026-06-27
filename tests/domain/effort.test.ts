import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASCENT_PER_KM_M,
  classifyDayType,
  dayEffortKm,
} from '../../src/domain/effort'
import { applyItinerary, parseItineraryCsv } from '../../src/domain/csv/itinerary'
import { makeTrip } from '../../src/domain/trip'

describe('dayEffortKm', () => {
  it('adds an ascent penalty of 100 m ≈ 1 km by default', () => {
    expect(dayEffortKm(16, 1000)).toBe(26) // 16 km + 1000/100
    expect(dayEffortKm(10, 0)).toBe(10)
    expect(DEFAULT_ASCENT_PER_KM_M).toBe(100)
  })

  it('honors a custom ascent weighting', () => {
    expect(dayEffortKm(10, 1000, 200)).toBe(15) // 100 m ≈ 0.5 km
  })
})

describe('classifyDayType', () => {
  it('maps effort to the four day types', () => {
    expect(classifyDayType(8)).toBe('small') // < 12
    expect(classifyDayType(15)).toBe('average') // 12–20
    expect(classifyDayType(26)).toBe('big') // 20–28
    expect(classifyDayType(35)).toBe('huge') // ≥ 28
  })

  it('treats thresholds as exclusive upper bounds', () => {
    expect(classifyDayType(12)).toBe('average')
    expect(classifyDayType(20)).toBe('big')
    expect(classifyDayType(28)).toBe('huge')
  })
})

describe('parseItineraryCsv', () => {
  it('parses day, name, distance and ascent', () => {
    const { rows, issues } = parseItineraryCsv(
      ['day,name,distance_km,ascent_m', '1,Whitney Portal → Trail Camp,10,1200', '2,,18,600'].join(
        '\n',
      ),
    )
    expect(issues).toHaveLength(0)
    expect(rows[0]).toEqual({
      dayIndex: 1,
      name: 'Whitney Portal → Trail Camp',
      distanceKm: 10,
      ascentM: 1200,
    })
    expect(rows[1]).toEqual({ dayIndex: 2, name: undefined, distanceKm: 18, ascentM: 600 })
  })

  it('reports bad rows with line numbers without blocking good ones', () => {
    const { rows, issues } = parseItineraryCsv(
      ['day,distance_km,ascent_m', '1,10,500', 'x,5,100', '3,-2,100'].join('\n'),
    )
    expect(rows.map((r) => r.dayIndex)).toEqual([1])
    expect(issues).toEqual([
      { line: 3, reason: 'day must be a positive integer, got "x"' },
      { line: 4, reason: 'distance_km must be a non-negative number, got "-2"' },
    ])
  })

  it('rejects a file missing required columns', () => {
    const { issues } = parseItineraryCsv('day,name\n1,Camp')
    expect(issues[0].reason).toContain('missing column(s)')
  })
})

describe('applyItinerary', () => {
  const trip = makeTrip('t1', 'JMT', 3)

  it('sets each matched day and derives its type from effort', () => {
    const { days, unmatched } = applyItinerary(trip.days, [
      { dayIndex: 1, name: 'Easy in', distanceKm: 8, ascentM: 200 }, // effort 10 → small
      { dayIndex: 2, distanceKm: 16, ascentM: 1000 }, // effort 26 → big
      { dayIndex: 3, distanceKm: 24, ascentM: 1500 }, // effort 39 → huge
    ])
    expect(unmatched).toEqual([])
    expect(days.map((d) => d.type)).toEqual(['small', 'big', 'huge'])
    expect(days[0]).toMatchObject({ name: 'Easy in', distanceKm: 8, ascentM: 200 })
  })

  it('reports rows for days that are not in the trip', () => {
    const { days, unmatched } = applyItinerary(trip.days, [
      { dayIndex: 2, distanceKm: 10, ascentM: 300 },
      { dayIndex: 9, distanceKm: 10, ascentM: 300 },
    ])
    expect(unmatched).toEqual([9])
    expect(days[1]).toMatchObject({ distanceKm: 10, ascentM: 300 })
    // untouched days keep their defaults
    expect(days[0].distanceKm).toBeUndefined()
  })
})
