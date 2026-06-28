import { describe, expect, it } from 'vitest'
import {
  buildDayDescriptionsPrompt,
  dayLegLabel,
  hasItinerary,
  parseDayDescriptions,
} from '../../src/domain/dayDescription'
import type { Day } from '../../src/domain/types'

function day(partial: Partial<Day> & Pick<Day, 'index'>): Day {
  return { type: 'average', activeSlots: [], ...partial }
}

describe('dayLegLabel', () => {
  it('prefers start → end', () => {
    expect(dayLegLabel(day({ index: 1, start: 'A', end: 'B' }))).toBe('A → B')
  })
  it('falls back to one endpoint, then the name, then the day number', () => {
    expect(dayLegLabel(day({ index: 1, start: 'A' }))).toBe('from A')
    expect(dayLegLabel(day({ index: 1, end: 'B' }))).toBe('to B')
    expect(dayLegLabel(day({ index: 2, name: 'Rest day' }))).toBe('Rest day')
    expect(dayLegLabel(day({ index: 3 }))).toBe('Day 3')
  })
})

describe('hasItinerary', () => {
  it('is true with a route or name, false otherwise', () => {
    expect(hasItinerary(day({ index: 1, start: 'A' }))).toBe(true)
    expect(hasItinerary(day({ index: 1, name: 'x' }))).toBe(true)
    expect(hasItinerary(day({ index: 1 }))).toBe(false)
  })
})

describe('buildDayDescriptionsPrompt', () => {
  it('lists each day with its leg and effort', () => {
    const prompt = buildDayDescriptionsPrompt([
      day({ index: 1, start: 'A', end: 'B', distanceKm: 12, ascentM: 800, type: 'big' }),
    ])
    expect(prompt).toContain('Day 1: A → B, 12 km, 800 m ascent, big')
    expect(prompt).toContain('"days"')
  })
})

describe('parseDayDescriptions', () => {
  it('returns a day-index → description map', () => {
    const json = JSON.stringify({
      days: [
        { day: 1, description: 'Eat on the go up the climb.' },
        { day: 2, description: 'Lunch at the lake midway.' },
      ],
    })
    const result = parseDayDescriptions(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.byDay.get(1)).toBe('Eat on the go up the climb.')
      expect(result.byDay.get(2)).toBe('Lunch at the lake midway.')
    }
  })

  it('tolerates a bare array and skips malformed entries', () => {
    const json = '[{"day":1,"description":"ok"},{"day":2,"description":""},{"foo":1}]'
    const result = parseDayDescriptions(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.byDay.get(1)).toBe('ok')
      expect(result.byDay.has(2)).toBe(false)
    }
  })

  it('fails on non-JSON and on an empty result', () => {
    expect(parseDayDescriptions('nope').ok).toBe(false)
    expect(parseDayDescriptions('{"days":[]}').ok).toBe(false)
  })
})
