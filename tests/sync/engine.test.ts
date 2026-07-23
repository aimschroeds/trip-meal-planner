import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyIncoming, reconcile, type SyncTransport } from '../../src/sync/engine'
import { db } from '../../src/store/db'
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

/** In-memory transport standing in for the cloud `records` table. Like the real
 *  server it stamps every pushed row with its OWN monotonic clock (modelling the
 *  updated_at trigger) and returns the stamped rows, so client wall clocks never
 *  drive last-write-wins. */
function memoryTransport(initial: SyncRecord[] = []) {
  const store = new Map(initial.map((r) => [recordKey(r), r]))
  let serverClock = 1000
  return {
    store,
    pushed: [] as SyncRecord[],
    async push(records: SyncRecord[]) {
      const ts = ++serverClock
      const stamped = records.map((r) => ({ ...r, updatedAt: ts }))
      for (const s of stamped) store.set(recordKey(s), s)
      this.pushed.push(...stamped)
      return stamped
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
    db.tripConsumables.clear(),
    db.syncMeta.clear(),
    db.syncState.clear(),
  ])
})

describe('reconcile', () => {
  it('uploads existing local rows on first connect and adopts the server timestamp', async () => {
    await db.items.add(oats())
    const t = memoryTransport()

    const result = await reconcile(t)

    expect(result).toEqual({ applied: 0, pushed: 1 })
    expect(t.store.get('item:i1')?.payload).toMatchObject({ name: 'Oats' })
    // Meta adopts the server-assigned timestamp so the row isn't re-pushed.
    const meta = await db.syncMeta.get('item:i1')
    expect(meta?.deleted).toBe(false)
    expect(meta?.updatedAt).toBe(t.store.get('item:i1')?.updatedAt)
  })

  it('applies a remote-only record into the local database', async () => {
    const t = memoryTransport([
      { kind: 'item', id: 'i1', payload: oats({ name: 'Cloud oats' }), updatedAt: 500, deleted: false },
    ])

    const result = await reconcile(t)

    expect(result.applied).toBe(1)
    expect(await db.items.get('i1')).toMatchObject({ name: 'Cloud oats' })
  })

  it('syncs trip consumables both ways', async () => {
    await db.tripConsumables.add({
      id: 'c1',
      tripId: 't1',
      personId: 'p1',
      name: 'Soap',
      category: 'hygiene',
      baseG: 5,
      consumableG: 13,
    })
    const t = memoryTransport([
      {
        kind: 'tripConsumable',
        id: 'c2',
        payload: { id: 'c2', tripId: 't1', personId: 'p2', name: 'Fuel', category: 'cooking', baseG: 100, consumableG: 200 },
        updatedAt: 500,
        deleted: false,
      },
    ])

    const result = await reconcile(t)

    expect(result).toEqual({ applied: 1, pushed: 1 })
    expect(t.store.get('tripConsumable:c1')?.payload).toMatchObject({ name: 'Soap' })
    expect(await db.tripConsumables.get('c2')).toMatchObject({ name: 'Fuel' })
  })

  it('pushes a local edit and it wins', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)
    t.pushed.length = 0

    await db.items.put(oats({ name: 'Local edit' }))
    const result = await reconcile(t)

    expect(result).toEqual({ applied: 0, pushed: 1 })
    expect(t.store.get('item:i1')?.payload).toMatchObject({ name: 'Local edit' })
    expect(await db.items.get('i1')).toMatchObject({ name: 'Local edit' })
  })

  it('does NOT revert a fresh local edit under clock skew', async () => {
    // The classic bug: the workspace copy carries a "future" timestamp because
    // another device's clock ran ahead. A fresh local edit must still win.
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t) // upload; meta adopts the server timestamp
    t.pushed.length = 0

    // Workspace copy now looks far newer than any client clock.
    t.store.set('item:i1', { kind: 'item', id: 'i1', payload: oats(), updatedAt: 9_999_999, deleted: false })

    await db.items.put(oats({ name: 'My edit' }))
    await reconcile(t)

    expect(await db.items.get('i1')).toMatchObject({ name: 'My edit' })
    expect(t.store.get('item:i1')?.payload).toMatchObject({ name: 'My edit' })
  })

  it('accepts a newer cloud edit over an unchanged local row', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)

    t.store.set('item:i1', {
      kind: 'item',
      id: 'i1',
      payload: oats({ name: 'Oatmeal' }),
      updatedAt: 5_000_000,
      deleted: false,
    })
    const result = await reconcile(t)

    expect(result.applied).toBe(1)
    expect(await db.items.get('i1')).toMatchObject({ name: 'Oatmeal' })
  })

  it('propagates a local delete as a tombstone', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)
    t.pushed.length = 0

    await db.items.delete('i1')
    const result = await reconcile(t)

    expect(result.pushed).toBe(1)
    expect(t.store.get('item:i1')).toMatchObject({ deleted: true })
    expect(await db.syncMeta.get('item:i1')).toMatchObject({ deleted: true })
  })

  it('deletes a local row when the cloud has a newer tombstone', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)

    t.store.set('item:i1', { kind: 'item', id: 'i1', payload: null, updatedAt: 5_000_000, deleted: true })
    const result = await reconcile(t)

    expect(result.applied).toBe(1)
    expect(await db.items.get('i1')).toBeUndefined()
  })

  it('is a no-op once everything is in sync', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)

    const result = await reconcile(t)
    expect(result).toEqual({ applied: 0, pushed: 0 })
  })
})

describe('marks (shopping/packing tick-offs)', () => {
  it('uploads a local tick and pulls a remote one', async () => {
    await db.marks.add({ id: 't1|buy|i1', tripId: 't1', scope: 'buy', ref: 'i1' })
    const t = memoryTransport([
      { kind: 'mark', id: 't1|pack|0:i2', payload: { id: 't1|pack|0:i2', tripId: 't1', scope: 'pack', ref: '0:i2' }, updatedAt: 500, deleted: false },
    ])

    await reconcile(t)

    expect(t.store.get('mark:t1|buy|i1')).toMatchObject({ payload: { ref: 'i1' } })
    expect(await db.marks.get('t1|pack|0:i2')).toMatchObject({ scope: 'pack', ref: '0:i2' })
  })

  it('removes a tick when the cloud has a newer tombstone (un-tick)', async () => {
    await db.marks.add({ id: 't1|buy|i1', tripId: 't1', scope: 'buy', ref: 'i1' })
    const t = memoryTransport()
    await reconcile(t)

    t.store.set('mark:t1|buy|i1', { kind: 'mark', id: 't1|buy|i1', payload: null, updatedAt: 5_000_000, deleted: true })
    await reconcile(t)

    expect(await db.marks.get('t1|buy|i1')).toBeUndefined()
  })
})

describe('applyIncoming', () => {
  it('applies a realtime batch without pushing back', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)
    t.pushed.length = 0

    await applyIncoming([{ kind: 'item', id: 'i1', payload: null, updatedAt: 5_000_000, deleted: true }])

    expect(await db.items.get('i1')).toBeUndefined()
    expect(t.pushed).toEqual([]) // realtime apply never calls the transport
  })

  it('never clobbers an un-pushed local edit (the ~1s revert bug)', async () => {
    await db.items.add(oats())
    const t = memoryTransport()
    await reconcile(t)
    t.pushed.length = 0

    // Edit locally but don't sync yet…
    await db.items.put(oats({ name: 'My edit' }))
    // …a realtime message arrives with the stale value, even a "future" stamp.
    await applyIncoming([
      { kind: 'item', id: 'i1', payload: oats({ name: 'Oats' }), updatedAt: 9_999_999, deleted: false },
    ])

    // The un-pushed edit survives, and still syncs up on the next reconcile.
    expect(await db.items.get('i1')).toMatchObject({ name: 'My edit' })
    const result = await reconcile(t)
    expect(result.pushed).toBe(1)
    expect(t.store.get('item:i1')?.payload).toMatchObject({ name: 'My edit' })
  })
})
