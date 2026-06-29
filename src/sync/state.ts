// Which cloud workspace this device is connected to (M7). Null/absent means the
// app is purely local. Kept tiny and separate from the engine so the UI can
// read connection state without pulling in sync logic.

import { db } from '../store/db'

export async function getActiveWorkspace(): Promise<string | null> {
  const state = await db.syncState.get('state')
  return state?.workspaceId ?? null
}

export async function setActiveWorkspace(workspaceId: string | null): Promise<void> {
  const existing = await db.syncState.get('state')
  await db.syncState.put({
    id: 'state',
    workspaceId,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
  })
}

export async function markSynced(at = Date.now()): Promise<void> {
  const existing = await db.syncState.get('state')
  await db.syncState.put({
    id: 'state',
    workspaceId: existing?.workspaceId ?? null,
    lastSyncedAt: at,
  })
}

/** Forget all sync bookkeeping so local data becomes purely local again and
 *  nothing is re-pushed — used when disconnecting from a workspace. */
export async function clearSyncState(): Promise<void> {
  await db.transaction('rw', db.syncMeta, db.syncState, async () => {
    await db.syncMeta.clear()
    await db.syncState.clear()
  })
}
