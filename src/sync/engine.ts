// The local sync engine (M7). It reconciles the local Dexie database with a
// cloud workspace through a transport, using the pure last-write-wins core in
// domain/sync.ts. IndexedDB stays the source of truth (PLAN.md §10).
//
// Change capture is diff-based, not hook-based: every sync scans the six tables
// and compares each row against the snapshot stored in `syncMeta`. This catches
// edits from any write path (repos, CSV import, JSON restore, direct UI writes)
// without touching write sites, and the dataset is small enough that a full
// scan is cheap. Likewise, pulls fetch the whole workspace rather than a delta,
// which sidesteps cross-device clock-skew in an incremental cursor; realtime
// handles live, incremental updates.

import { db, type SyncMetaRow } from '../store/db'
import {
  mergeRecords,
  recordKey,
  SYNC_KINDS,
  type SyncKind,
  type SyncRecord,
} from '../domain/sync'

/** How the engine talks to the cloud. Implemented over Supabase in
 *  supabaseTransport.ts; an in-memory version drives the unit tests. */
export interface SyncTransport {
  /** Upsert these records (including tombstones) into the workspace. */
  push(records: SyncRecord[]): Promise<void>
  /** Every record in the workspace. */
  pullAll(): Promise<SyncRecord[]>
}

export interface SyncResult {
  applied: number
  pushed: number
}

const TABLE_NAME: Record<SyncKind, string> = {
  trip: 'trips',
  person: 'people',
  item: 'items',
  meal: 'meals',
  resupply: 'resupplies',
  planEntry: 'planEntries',
  mark: 'marks',
  gearItem: 'gear',
}

// db.table(name) is typed Table<any, any>; the engine only uses id-keyed
// toArray/put/delete, which is uniform across the six tables.
function tableFor(kind: SyncKind) {
  return db.table(TABLE_NAME[kind])
}

function snapshotOf(payload: unknown): string {
  return JSON.stringify(payload)
}

function sameVersion(a: SyncRecord | undefined, b: SyncRecord): boolean {
  return !!a && a.updatedAt === b.updatedAt && a.deleted === b.deleted
}

/** Snapshot the local database as SyncRecords. A row whose serialized form
 *  still matches its `syncMeta` snapshot carries its known timestamp; a new or
 *  edited row (or a row deleted since the last sync) is stamped `now` so it
 *  wins last-write-wins against the older cloud copy. */
async function collectLocalRecords(now: number): Promise<SyncRecord[]> {
  const metaByKey = new Map((await db.syncMeta.toArray()).map((m) => [m.key, m]))
  const seen = new Set<string>()
  const out: SyncRecord[] = []

  for (const kind of SYNC_KINDS) {
    const rows = await tableFor(kind).toArray()
    for (const row of rows) {
      const id = String(row.id)
      const key = `${kind}:${id}`
      seen.add(key)
      const snapshot = snapshotOf(row)
      const meta = metaByKey.get(key)
      const unchanged = !!meta && !meta.deleted && meta.snapshot === snapshot
      out.push({ kind, id, payload: row, updatedAt: unchanged ? meta.updatedAt : now, deleted: false })
    }
  }

  // Rows that have meta but no live object were deleted locally.
  for (const meta of metaByKey.values()) {
    if (seen.has(meta.key)) continue
    out.push({
      kind: meta.kind,
      id: meta.id,
      payload: null,
      updatedAt: meta.deleted ? meta.updatedAt : now,
      deleted: true,
    })
  }

  return out
}

/** Write winners into the local tables: put live payloads, delete tombstones. */
async function applyLocally(records: SyncRecord[]): Promise<void> {
  for (const r of records) {
    const table = tableFor(r.kind)
    if (r.deleted) await table.delete(r.id)
    else await table.put(r.payload)
  }
}

/** Record the reconciled version of each record so the next scan can tell
 *  what changed and won't re-push what's already in sync. */
async function writeMeta(records: SyncRecord[]): Promise<void> {
  const rows: SyncMetaRow[] = records.map((r) => ({
    key: recordKey(r),
    kind: r.kind,
    id: r.id,
    updatedAt: r.updatedAt,
    deleted: r.deleted,
    snapshot: r.deleted ? '' : snapshotOf(r.payload),
  }))
  await db.syncMeta.bulkPut(rows)
}

async function reconcileCore(
  remote: SyncRecord[],
  transport: SyncTransport | null,
  now: number,
): Promise<SyncResult> {
  const local = await collectLocalRecords(now)
  const merged = mergeRecords(local, remote)
  const localByKey = new Map(local.map((r) => [recordKey(r), r]))
  const remoteByKey = new Map(remote.map((r) => [recordKey(r), r]))

  const toApply: SyncRecord[] = []
  const toPush: SyncRecord[] = []
  for (const win of merged) {
    const key = recordKey(win)
    if (!sameVersion(localByKey.get(key), win)) toApply.push(win)
    if (transport && !sameVersion(remoteByKey.get(key), win)) toPush.push(win)
  }

  await applyLocally(toApply)
  if (transport && toPush.length > 0) await transport.push(toPush)
  await writeMeta(merged)
  return { applied: toApply.length, pushed: toPush.length }
}

/** Full two-way sync: pull the whole workspace, resolve last-write-wins
 *  against local state, apply winners locally, and push the ones we own. */
export async function reconcile(transport: SyncTransport, now = Date.now()): Promise<SyncResult> {
  const remote = await transport.pullAll()
  return reconcileCore(remote, transport, now)
}

/** Apply a realtime batch from another device (LWW against local state). Does
 *  not push; any newer local edits go up on the next reconcile. */
export async function applyIncoming(remote: SyncRecord[], now = Date.now()): Promise<SyncResult> {
  return reconcileCore(remote, null, now)
}
