import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import { applyIncoming, reconcile, type SyncTransport } from '../../src/sync/engine'
import { recordKey, type SyncRecord } from '../../src/domain/sync'
import type { Item } from '../../src/domain/types'

function oats(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    name: 'Oats',
    caloriesPerGram: 3.8,
    vegetarian: true,
    inputBasis: 'per_100g',
    inputWeightG: 100,
    inputCalories: 380,
    ...over,
  }
}

/** In-memory transport: a Map standing in for the cloud `records` table. */
function memoryTransport(initial: SyncRecord[] = []) {
  const store = new Map(initial.map((r) => [recordKey(r), r]))
  return {
    store,
    pushed: [] as SyncRecord[],
    async push(records: SyncRecord[]) {
      for (const r of records) store.set(recordKey(r), r)
      this.pushed.push(...records)
    },
    async pullAll() {
      return [...store.values()]
    },
  } satisfies SyncTransport & { store: Map<string, SyncRecord>; pushed: SyncRecord[] }
}

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.trips.clear(),
    db.people.clear(),
    db.meals.clear(),
    db.resupplies.clear(),
    db.planEntries.clear(),
    db.marks.clear(),
    db.syncMeta.clear(),
    db.syncState.clear(),
  ])
})

describe('reconcile', () => {
  it('uploads existing local rows on first connect', async () => {
    await db.items.add(oats())
    const t = memoryTransport()

    const result = await reconcile(t, 1000)

    expect(result).toEqual({ applied: 0, pushed: 1 })
    expect(t.store.get('item:i1')?.payload).toMatchObject({ name: 'Oats' })
    // Bookkeeping now exists so the row won't be re-pushed.
    expect(await db.syncMeta.get('item:i1')).toMatchObject({ updatedAt: 1000, deleted: false })
  })

  it('applies a remote-only record into the local database', async () => {
    const t = memoryTransport([
      { kind: 'item', id: 'i1', payload: oats({ name: 'Cloud oats' }), updatedAt: 500, deleted: false },
    ])

    const result = await reconcile(t, 1000)

    expect(result.applied).toBe(1)
    expect(await db.items.get('i1')).toMatchObject({ name: 'Cloud oats' })
  })

  it('keeps the newer local edit and pushes it over an older cloud copy', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t, 1000) // initial upload at t=1000
    t.pushed.length = 0

    await db.items.put(oats({ name: 'Local edit' }))
    const result = await reconcile(t, 3000)

    expect(result).toEqual({ applied: 0, pushed: 1 })
    expect(t.store.get('item:i1')).toMatchObject({ updatedAt: 3000, payload: { name: 'Local edit' } })
    expect(await db.items.get('i1')).toMatchObject({ name: 'Local edit' })
  })

  it('accepts a newer cloud edit over an unchanged local row', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t, 1000)

    // Another device edited the same item later.
    t.store.set('item:i1', {
      kind: 'item',
      id: 'i1',
      payload: oats({ name: 'Oatmeal' }),
      updatedAt: 2000,
      deleted: false,
    })
    const result = await reconcile(t, 1500)

    expect(result.applied).toBe(1)
    expect(await db.items.get('i1')).toMatchObject({ name: 'Oatmeal' })
  })

  it('propagates a local delete as a tombstone', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t, 1000)
    t.pushed.length = 0

    await db.items.delete('i1')
    const result = await reconcile(t, 5000)

    expect(result.pushed).toBe(1)
    expect(t.store.get('item:i1')).toMatchObject({ deleted: true, updatedAt: 5000 })
    expect(await db.syncMeta.get('item:i1')).toMatchObject({ deleted: true })
  })

  it('deletes a local row when the cloud has a newer tombstone', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t, 1000)

    t.store.set('item:i1', { kind: 'item', id: 'i1', payload: null, updatedAt: 2000, deleted: true })
    const result = await reconcile(t, 1500)

    expect(result.applied).toBe(1)
    expect(await db.items.get('i1')).toBeUndefined()
  })

  it('is a no-op once everything is in sync', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t, 1000)

    const result = await reconcile(t, 9000)
    expect(result).toEqual({ applied: 0, pushed: 0 })
  })
})

describe('marks (shopping/packing tick-offs)', () => {
  it('uploads a local tick and pulls a remote one', async () => {
    await db.marks.add({ id: 't1|buy|i1', tripId: 't1', scope: 'buy', ref: 'i1' })
    const t = memoryTransport([
      { kind: 'mark', id: 't1|pack|0:i2', payload: { id: 't1|pack|0:i2', tripId: 't1', scope: 'pack', ref: '0:i2' }, updatedAt: 500, deleted: false },
    ])

    await reconcile(t, 1000)

    // local tick went up…
    expect(t.store.get('mark:t1|buy|i1')).toMatchObject({ payload: { ref: 'i1' } })
    // …and the remote tick landed locally.
    expect(await db.marks.get('t1|pack|0:i2')).toMatchObject({ scope: 'pack', ref: '0:i2' })
  })

  it('removes a tick when the cloud has a newer tombstone (un-tick)', async () => {
    await db.marks.add({ id: 't1|buy|i1', tripId: 't1', scope: 'buy', ref: 'i1' })
    const t = memoryTransport()
    await reconcile(t, 1000)

    t.store.set('mark:t1|buy|i1', { kind: 'mark', id: 't1|buy|i1', payload: null, updatedAt: 2000, deleted: true })
    await reconcile(t, 1500)

    expect(await db.marks.get('t1|buy|i1')).toBeUndefined()
  })
})

describe('applyIncoming', () => {
  it('applies a realtime batch without pushing back', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t, 1000)
    t.pushed.length = 0

    await applyIncoming(
      [{ kind: 'item', id: 'i1', payload: null, updatedAt: 2000, deleted: true }],
      1500,
    )

    expect(await db.items.get('i1')).toBeUndefined()
    expect(t.pushed).toEqual([]) // realtime apply never calls the transport
  })
})
