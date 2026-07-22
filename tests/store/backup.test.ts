import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import { exportBackup, mergeBackup, restoreBackup } from '../../src/store/backup'
import { makeTrip } from '../../src/domain/trip'
import type { BackupData } from '../../src/domain/backup'
import type { GearItem, Item, Person, PlanEntry } from '../../src/domain/types'

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
    gear: [gaz],
    gearCollections: [],
    tripConsumables: [
      {
        id: 'consumable-1',
        tripId: 'trip-1',
        personId: 'person-1',
        name: 'Soap',
        category: 'hygiene',
        baseG: 5,
        consumableG: 13,
      },
    ],
  }
}

const gaz: GearItem = {
  id: 'gear-1',
  name: 'Fuel canister',
  category: 'cooking',
  weightG: 220,
  consumableWeightG: 100,
}

async function clearAll() {
  await Promise.all(
    [
      db.trips,
      db.people,
      db.items,
      db.meals,
      db.resupplies,
      db.planEntries,
      db.gear,
      db.tripConsumables,
    ].map((t) => t.clear()),
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
      gear: [],
      gearCollections: [],
      tripConsumables: [],
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
      gear: [],
      gearCollections: [],
      tripConsumables: [],
    })
    expect(await db.items.count()).toBe(0)
    expect(await db.trips.count()).toBe(0)
  })

  it('merge unions by id without wiping existing data (collab)', async () => {
    // Existing: a stale item + Bob's plan entry for the shared trip.
    await db.items.add({ ...oatmeal, id: 'mine', name: 'My snack' })
    await db.planEntries.add({
      id: 'trip-1|bob|1|dinner-0',
      tripId: 'trip-1',
      personId: 'bob',
      dayIndex: 1,
      slotKey: 'dinner-0',
      kind: 'planned',
      parts: [{ kind: 'meal', mealId: 'meal-1' }],
    })

    // Merge in a partner's backup (Alice's plan entry + a shared item update).
    const incoming = fullData()
    await mergeBackup(incoming)

    // Existing rows survive; incoming rows are added (different ids don't collide).
    expect(await db.items.get('mine')).toBeDefined()
    expect(await db.items.get('item-1')).toBeDefined()
    expect(await db.planEntries.get('trip-1|bob|1|dinner-0')).toBeDefined() // Bob's plan kept
    expect(await db.planEntries.get('trip-1|person-1|1|brekkie-0')).toBeDefined() // Alice's added
  })

  it('merge overwrites a row with the same id (last-writer-wins)', async () => {
    await db.items.add({ ...oatmeal, name: 'Old name' })
    await mergeBackup(fullData()) // contains oatmeal id 'item-1' named 'Oatmeal'
    expect((await db.items.get('item-1'))?.name).toBe('Oatmeal')
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
