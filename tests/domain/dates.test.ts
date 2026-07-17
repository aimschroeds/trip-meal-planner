import { describe, expect, it } from 'vitest'
import { tripDayDate } from '../../src/domain/dates'

function ymd(d: Date | null): string | null {
  return d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null
}

describe('tripDayDate', () => {
  it('is the start date on day 1 and adds a day per index', () => {
    expect(ymd(tripDayDate('2026-07-20', 1))).toBe('2026-7-20')
    expect(ymd(tripDayDate('2026-07-20', 3))).toBe('2026-7-22')
  })

  it('rolls over month boundaries', () => {
    // Day 5 of a trip starting Jul 30 → Aug 3.
    expect(ymd(tripDayDate('2026-07-30', 5))).toBe('2026-8-3')
  })

  it('is null without a valid start date', () => {
    expect(tripDayDate(undefined, 1)).toBeNull()
    expect(tripDayDate('', 1)).toBeNull()
    expect(tripDayDate('not-a-date', 1)).toBeNull()
  })
})
