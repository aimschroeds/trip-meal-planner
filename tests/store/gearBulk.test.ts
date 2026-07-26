import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import {
  createGearCollection,
  deleteGearBulk,
  setGearCategoryBulk,
  setGearShared,
  toggleCollectionItem,
  toggleGearAssignment,
} from '../../src/store/repos'
import type { GearItem } from '../../src/domain/types'

const item = (id: string, category = 'misc'): GearItem => ({
  id,
  name: id,
  category,
  weightG: 100,
})

beforeEach(async () => {
  await Promise.all([
    db.gear.clear(),
    db.gearAssignments.clear(),
    db.gearCollections.clear(),
    db.trips.clear(),
  ])
})

describe('setGearShared', () => {
  it('marks several items shared, and stores the false case as undefined', async () => {
    await db.gear.bulkAdd([item('a'), item('b')])
    await setGearShared(['a', 'b'], true)
    expect((await db.gear.get('a'))?.shared).toBe(true)
    expect((await db.gear.get('b'))?.shared).toBe(true)

    await setGearShared(['a'], false)
    // false is normalised to undefined (matches how the form/save stores it).
    expect((await db.gear.get('a'))?.shared).toBeUndefined()
    expect((await db.gear.get('b'))?.shared).toBe(true)
  })
})

describe('setGearCategoryBulk', () => {
  it('reclassifies many items at once, leaving unselected ones alone', async () => {
    await db.gear.bulkAdd([item('a', 'shelter'), item('b', 'sleep'), item('c', 'cooking')])
    await setGearCategoryBulk(['a', 'b'], ' shelter ')
    expect((await db.gear.get('a'))?.category).toBe('shelter')
    expect((await db.gear.get('b'))?.category).toBe('shelter')
    expect((await db.gear.get('c'))?.category).toBe('cooking')
  })

  it('no-ops on a blank category', async () => {
    await db.gear.add(item('a', 'sleep'))
    await setGearCategoryBulk(['a'], '   ')
    expect((await db.gear.get('a'))?.category).toBe('sleep')
  })
})

describe('deleteGearBulk', () => {
  it('deletes the free items and keeps ones still assigned to a trip', async () => {
    await db.gear.bulkAdd([item('a'), item('b'), item('c')])
    await toggleGearAssignment('trip-1', 'alice', 'b') // b is in use

    const { blocked } = await deleteGearBulk(['a', 'b', 'c'])

    expect(blocked).toEqual(['b'])
    expect(await db.gear.get('a')).toBeUndefined()
    expect(await db.gear.get('b')).toBeDefined()
    expect(await db.gear.get('c')).toBeUndefined()
  })

  it('drops deleted items from any collections they were in', async () => {
    await db.gear.bulkAdd([item('a'), item('b')])
    const col = await createGearCollection('Kit')
    await toggleCollectionItem(col, 'a')
    await toggleCollectionItem(col, 'b')

    await deleteGearBulk(['a'])

    expect((await db.gearCollections.get(col))?.gearItemIds).toEqual(['b'])
  })
})
