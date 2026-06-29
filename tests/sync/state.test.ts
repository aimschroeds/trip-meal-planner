import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import {
  clearSyncState,
  getActiveWorkspace,
  markSynced,
  setActiveWorkspace,
} from '../../src/sync/state'

beforeEach(async () => {
  await Promise.all([db.syncMeta.clear(), db.syncState.clear()])
})

describe('sync state', () => {
  it('defaults to no active workspace (purely local)', async () => {
    expect(await getActiveWorkspace()).toBeNull()
  })

  it('remembers the connected workspace', async () => {
    await setActiveWorkspace('ws-1')
    expect(await getActiveWorkspace()).toBe('ws-1')
  })

  it('preserves lastSyncedAt across a workspace change and markSynced', async () => {
    await setActiveWorkspace('ws-1')
    await markSynced(1234)
    await setActiveWorkspace('ws-2')
    expect(await db.syncState.get('state')).toMatchObject({ workspaceId: 'ws-2', lastSyncedAt: 1234 })
  })

  it('clears all bookkeeping on disconnect', async () => {
    await setActiveWorkspace('ws-1')
    await db.syncMeta.put({ key: 'item:i1', kind: 'item', id: 'i1', updatedAt: 1, deleted: false, snapshot: '{}' })

    await clearSyncState()

    expect(await getActiveWorkspace()).toBeNull()
    expect(await db.syncMeta.count()).toBe(0)
  })
})
