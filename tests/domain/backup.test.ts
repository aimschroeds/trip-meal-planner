import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  parseBackup,
  serializeBackup,
  type BackupData,
} from '../../src/domain/backup'
import { makeTrip } from '../../src/domain/trip'
import type { Item, Meal, Person, PlanEntry, Resupply } from '../../src/domain/types'

// Carry every optional field so the round-trip test proves backups preserve
// the newer ones (brand, meal types[], day start/end/description, unit/gen
// metadata), not just the required core.
const oatmeal: Item = {
  id: 'item-1',
  name: 'Oatmeal',
  brand: 'Bob’s Red Mill',
  caloriesPerGram: 3.8,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 380,
  minGrams: 60,
  maxGrams: 120,
  unitWeightG: 40,
  unitName: 'sachet',
  servingG: 80,
  genMealTypes: ['brekkie'],
}

const porridge: Meal = {
  id: 'meal-1',
  name: 'Porridge',
  type: 'brekkie',
  types: ['brekkie', 'lunch'],
  components: [{ itemId: 'item-1', grams: 80 }],
}

const alice: Person = {
  id: 'person-1',
  name: 'Alice',
  baselineCalories: 2500,
  vegetarian: true,
}

const resupply: Resupply = {
  id: 'resupply-1',
  tripId: 'trip-1',
  dayIndex: 3,
  timing: 'after_lunch',
}

const entry: PlanEntry = {
  id: 'trip-1|person-1|1|brekkie-0',
  tripId: 'trip-1',
  personId: 'person-1',
  dayIndex: 1,
  slotKey: 'brekkie-0',
  kind: 'planned',
  parts: [{ kind: 'meal', mealId: 'meal-1' }],
}

function fullData(): BackupData {
  const trip = { ...makeTrip('trip-1', 'GR20', 5), peopleIds: ['person-1'] }
  // Give day 1 the itinerary + AI-description fields so they round-trip too.
  trip.days = trip.days.map((d) =>
    d.index === 1
      ? {
          ...d,
          name: 'Westside Rd → Klapatche',
          start: 'Westside Rd',
          end: 'Klapatche Park',
          distanceKm: 15,
          ascentM: 938,
          description: 'Lunch at the lake midway; eat on the go up the final climb.',
        }
      : d,
  )
  return {
    trips: [trip],
    people: [alice],
    items: [oatmeal],
    meals: [porridge],
    resupplies: [resupply],
    planEntries: [entry],
  }
}

const emptyData: BackupData = {
  trips: [],
  people: [],
  items: [],
  meals: [],
  resupplies: [],
  planEntries: [],
}

describe('serializeBackup', () => {
  it('emits the versioned envelope with an ISO timestamp', () => {
    const file = JSON.parse(serializeBackup(emptyData, new Date('2026-06-12T10:00:00Z')))
    expect(file.format).toBe(BACKUP_FORMAT)
    expect(file.version).toBe(BACKUP_VERSION)
    expect(file.exportedAt).toBe('2026-06-12T10:00:00.000Z')
  })

  it('round-trips every table through parseBackup unchanged', () => {
    const data = fullData()
    const result = parseBackup(serializeBackup(data, new Date()))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.data).toEqual(data)
  })
})

describe('parseBackup', () => {
  it('rejects invalid JSON', () => {
    expect(parseBackup('{nope')).toEqual({ ok: false, error: 'not valid JSON' })
  })

  it('rejects JSON without the format marker', () => {
    const result = parseBackup('{"some": "other file"}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('format marker')
  })

  it('rejects versions newer than the app supports', () => {
    const file = JSON.parse(serializeBackup(emptyData, new Date()))
    file.version = BACKUP_VERSION + 1
    const result = parseBackup(JSON.stringify(file))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('newer than this app supports')
  })

  it('rejects a missing table with its name', () => {
    const file = JSON.parse(serializeBackup(emptyData, new Date()))
    delete file.data.meals
    const result = parseBackup(JSON.stringify(file))
    expect(result).toEqual({ ok: false, error: 'data.meals must be an array' })
  })

  it('rejects a malformed entity with its location and field', () => {
    const data = fullData()
    data.items[0] = { ...oatmeal, caloriesPerGram: 'lots' as unknown as number }
    const result = parseBackup(serializeBackup(data, new Date()))
    expect(result).toEqual({
      ok: false,
      error: 'data.items[0]: caloriesPerGram must be a number',
    })
  })

  it('rejects non-finite numbers', () => {
    const text = serializeBackup(fullData(), new Date()).replace('3.8', '"NaN"')
    const result = parseBackup(text)
    expect(result.ok).toBe(false)
  })

  it('accepts an empty backup', () => {
    const result = parseBackup(serializeBackup(emptyData, new Date()))
    expect(result.ok).toBe(true)
  })
})
