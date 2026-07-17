import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import {
  createGearCollection,
  createTrip,
  deleteGear,
  deleteTrip,
  GearInUseError,
  setGearOwners,
  toggleCollectionItem,
  toggleGearAssignment,
} from '../../src/store/repos'
import type { GearItem } from '../../src/domain/types'

const tent: GearItem = { id: 'tent', name: 'Duplex', category: 'shelter', weightG: 540, shared: true }

beforeEach(async () => {
  await Promise.all([db.gear.clear(), db.gearAssignments.clear(), db.trips.clear()])
  await db.gear.add(tent)
})

describe('toggleGearAssignment', () => {
  it('adds then removes an assignment idempotently', async () => {
    await toggleGearAssignment('trip-1', 'alice', 'tent')
    expect(await db.gearAssignments.get('trip-1|alice|tent')).toMatchObject({ personId: 'alice' })
    await toggleGearAssignment('trip-1', 'alice', 'tent')
    expect(await db.gearAssignments.get('trip-1|alice|tent')).toBeUndefined()
  })
})

describe('deleteGear', () => {
  it('blocks deleting gear that is assigned on a trip', async () => {
    await toggleGearAssignment('trip-1', 'alice', 'tent')
    const err = await deleteGear('tent').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GearInUseError)
    expect(await db.gear.get('tent')).toBeDefined()
  })

  it('deletes unused gear', async () => {
    await deleteGear('tent')
    expect(await db.gear.get('tent')).toBeUndefined()
  })
})

describe('deleteTrip', () => {
  it('cascades gear assignments', async () => {
    const tripId = await createTrip('GR20', 3)
    await toggleGearAssignment(tripId, 'alice', 'tent')
    await deleteTrip(tripId)
    expect(await db.gearAssignments.where('tripId').equals(tripId).count()).toBe(0)
  })
})

describe('setGearOwners', () => {
  beforeEach(async () => {
    await db.gear.bulkAdd([
      { id: 'a', name: 'Hoodie', category: 'clothing', weightG: 140 },
      { id: 'b', name: 'Puffy', category: 'clothing', weightG: 300 },
    ])
  })

  it('sets owners on many items at once, and clears with undefined', async () => {
    await setGearOwners(['a', 'b'], ['Alice'])
    expect((await db.gear.get('a'))?.owners).toEqual(['Alice'])
    expect((await db.gear.get('b'))?.owners).toEqual(['Alice'])

    await setGearOwners(['a'], undefined)
    expect((await db.gear.get('a'))?.owners).toBeUndefined()
    expect((await db.gear.get('b'))?.owners).toEqual(['Alice'])
  })
})

describe('gear collections', () => {
  beforeEach(async () => {
    await db.gearCollections.clear()
    await db.gear.bulkAdd([
      { id: 'a', name: 'Hoodie', category: 'clothing', weightG: 140 },
      { id: 'b', name: 'Puffy', category: 'clothing', weightG: 300 },
    ])
  })

  it('creates, toggles membership, and an item can be in several', async () => {
    const c1 = await createGearCollection('Solo weekend')
    const c2 = await createGearCollection('Group rainy')
    await toggleCollectionItem(c1, 'a')
    await toggleCollectionItem(c2, 'a') // same item in two collections
    await toggleCollectionItem(c1, 'b')

    expect((await db.gearCollections.get(c1))?.gearItemIds).toEqual(['a', 'b'])
    expect((await db.gearCollections.get(c2))?.gearItemIds).toEqual(['a'])

    await toggleCollectionItem(c1, 'a') // remove
    expect((await db.gearCollections.get(c1))?.gearItemIds).toEqual(['b'])
  })

  it('deleting a gear item drops it from collections', async () => {
    const c = await createGearCollection('Kit')
    await toggleCollectionItem(c, 'a')
    await toggleCollectionItem(c, 'b')
    await deleteGear('a')
    expect((await db.gearCollections.get(c))?.gearItemIds).toEqual(['b'])
  })
})
