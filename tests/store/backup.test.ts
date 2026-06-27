import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import { exportBackup, restoreBackup } from '../../src/store/backup'
import { makeTrip } from '../../src/domain/trip'
import type { BackupData } from '../../src/domain/backup'
import type { Item, Person, PlanEntry } from '../../src/domain/types'

const oatmeal: Item = {
  id: 'item-1',
  name: 'Oatmeal',
  caloriesPerGram: 3.8,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 380,
}

const alice: Person = {
  id: 'person-1',
  name: 'Alice',
  baselineCalories: 2500,
  vegetarian: true,
}

function fullData(): BackupData {
  return {
    trips: [{ ...makeTrip('trip-1', 'GR20', 3), peopleIds: ['person-1'] }],
    people: [alice],
    items: [oatmeal],
    meals: [{ id: 'meal-1', name: 'Porridge', type: 'brekkie', components: [{ itemId: 'item-1', grams: 80 }] }],
    resupplies: [{ id: 'resupply-1', tripId: 'trip-1', dayIndex: 2, timing: 'after_lunch' }],
    planEntries: [
      {
        id: 'trip-1|person-1|1|brekkie-0',
        tripId: 'trip-1',
        personId: 'person-1',
        dayIndex: 1,
        slotKey: 'brekkie-0',
        kind: 'planned',
        parts: [{ kind: 'meal', mealId: 'meal-1' }],
      },
    ],
  }
}

async function clearAll() {
  await Promise.all(
    [db.trips, db.people, db.items, db.meals, db.resupplies, db.planEntries].map((t) =>
      t.clear(),
    ),
  )
}

describe('backup store', () => {
  beforeEach(clearAll)

  it('exports every table', async () => {
    await restoreBackup(fullData())
    const data = await exportBackup()
    expect(data).toEqual(fullData())
  })

  it('exports an empty database as empty arrays', async () => {
    const data = await exportBackup()
    expect(data).toEqual({
      trips: [],
      people: [],
      items: [],
      meals: [],
      resupplies: [],
      planEntries: [],
    })
  })

  it('restore replaces existing data wholesale', async () => {
    await db.items.add({ ...oatmeal, id: 'old-item', name: 'Stale crackers' })
    await db.trips.add(makeTrip('old-trip', 'Old trip', 2))

    await restoreBackup(fullData())

    expect(await db.items.get('old-item')).toBeUndefined()
    expect(await db.trips.get('old-trip')).toBeUndefined()
    expect((await db.items.toArray()).map((i) => i.name)).toEqual(['Oatmeal'])
    expect(await db.planEntries.count()).toBe(1)
  })

  it('normalizes legacy one-meal-per-slot entries on restore (Epic 13)', async () => {
    const legacy = fullData()
    legacy.planEntries = [
      {
        id: 'trip-1|person-1|1|brekkie-0',
        tripId: 'trip-1',
        personId: 'person-1',
        dayIndex: 1,
        slotKey: 'brekkie-0',
        kind: 'meal',
        mealId: 'meal-1',
        quantityScale: 1.5,
      } as unknown as PlanEntry,
    ]
    await restoreBackup(legacy)
    const restored = await db.planEntries.get('trip-1|person-1|1|brekkie-0')
    expect(restored?.kind).toBe('planned')
    expect(restored?.parts).toEqual([{ kind: 'meal', mealId: 'meal-1', quantityScale: 1.5 }])
  })

  it('restoring an empty backup clears the database', async () => {
    await restoreBackup(fullData())
    await restoreBackup({
      trips: [],
      people: [],
      items: [],
      meals: [],
      resupplies: [],
      planEntries: [],
    })
    expect(await db.items.count()).toBe(0)
    expect(await db.trips.count()).toBe(0)
  })

  it('a failed restore rolls back, leaving existing data untouched', async () => {
    await db.items.add(oatmeal)
    const bad = fullData()
    // Duplicate primary keys make bulkAdd throw inside the transaction.
    bad.people = [alice, { ...alice }]

    await expect(restoreBackup(bad)).rejects.toThrow()

    expect((await db.items.toArray()).map((i) => i.id)).toEqual(['item-1'])
    expect(await db.people.count()).toBe(0)
    expect(await db.trips.count()).toBe(0)
  })
})
