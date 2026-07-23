import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import { renameGearCategory, setGearCategory } from '../../src/store/repos'
import type { GearItem } from '../../src/domain/types'

const item = (id: string, category: string): GearItem => ({ id, name: id, category, weightG: 100 })

beforeEach(async () => {
  await db.gear.clear()
})

describe('setGearCategory', () => {
  it('reclassifies one item, leaving others alone', async () => {
    await db.gear.bulkAdd([item('a', 'shelter'), item('b', 'sleep')])
    await setGearCategory('a', 'misc')
    expect((await db.gear.get('a'))?.category).toBe('misc')
    expect((await db.gear.get('b'))?.category).toBe('sleep')
  })

  it('trims the name and no-ops on blank', async () => {
    await db.gear.add(item('a', 'shelter'))
    await setGearCategory('a', '   ')
    expect((await db.gear.get('a'))?.category).toBe('shelter')
    await setGearCategory('a', ' cooking ')
    expect((await db.gear.get('a'))?.category).toBe('cooking')
  })
})

describe('renameGearCategory', () => {
  it('moves every item in the category to the new name', async () => {
    await db.gear.bulkAdd([item('a', 'clothing'), item('b', 'clothing'), item('c', 'sleep')])
    await renameGearCategory('clothing', 'Layers')
    expect((await db.gear.get('a'))?.category).toBe('Layers')
    expect((await db.gear.get('b'))?.category).toBe('Layers')
    expect((await db.gear.get('c'))?.category).toBe('sleep')
  })

  it('no-ops on a blank or unchanged name', async () => {
    await db.gear.add(item('a', 'clothing'))
    await renameGearCategory('clothing', '  ')
    await renameGearCategory('clothing', 'clothing')
    expect((await db.gear.get('a'))?.category).toBe('clothing')
  })
})
