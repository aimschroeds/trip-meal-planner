// The local sync engine (M7). It reconciles the local Dexie database with a
// cloud workspace through a transport, using the pure last-write-wins core in
// domain/sync.ts. IndexedDB stays the source of truth (PLAN.md §10).
//
// Change capture is diff-based, not hook-based: every sync scans the synced
// tables and compares each row against the snapshot stored in `syncMeta`, so it
// catches edits from any write path (repos, CSV import, JSON restore, direct UI
// writes) without touching write sites, and the dataset is small enough that a
// full scan is cheap. Pulls fetch the whole workspace; realtime handles live
// incremental updates.
//
// Timestamps are SERVER-authoritative: the server stamps `updated_at` on every
// write and the client adopts that value (returned from push, or seen on pull).
// So last-write-wins never depends on a device's wall clock — which drifts
// between devices and used to revert a fresh edit whose local clock ran behind
// the workspace copy. On top of that, an un-pushed local edit ("dirty") is
// protected: incoming remote records never overwrite it, so realtime can't
// clobber a change you just made before it has synced up.

import { db, type SyncMetaRow } from '../store/db'
import {
  pickWinner,
  recordKey,
  SYNC_KINDS,
  type SyncKind,
  type SyncRecord,
} from '../domain/sync'

/** How the engine talks to the cloud. Implemented over Supabase in
 *  supabaseTransport.ts; an in-memory version drives the unit tests. */
export interface SyncTransport {
  /** Upsert these records (including tombstones); the server stamps each one's
   *  updated_at and the stamped rows are returned so the client can adopt them. */
  push(records: SyncRecord[]): Promise<SyncRecord[]>
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
  gearAssignment: 'gearAssignments',
  gearCollection: 'gearCollections',
  tripConsumable: 'tripConsumables',
}

// db.table(name) is typed Table<any, any>; the engine only uses id-keyed
// toArray/put/delete, which is uniform across the synced tables.
function tableFor(kind: SyncKind) {
  return db.table(TABLE_NAME[kind])
}

function snapshotOf(payload: unknown): string {
  return JSON.stringify(payload)
}

function sameVersion(a: SyncRecord | undefined, b: SyncRecord): boolean {
  return !!a && a.updatedAt === b.updatedAt && a.deleted === b.deleted
}

interface LocalRecord {
  record: SyncRecord
  /** Edited (or newly created/deleted) since the last sync — not yet on the
   *  server. Protected: remote never overwrites it, and it's pushed. */
  dirty: boolean
}

/** Snapshot the local database as SyncRecords, flagging which have un-synced
 *  local edits. A clean row carries its last known SERVER timestamp (from
 *  `syncMeta`); a dirty row's timestamp is a placeholder — it wins by being
 *  dirty and gets a real server timestamp when pushed. */
async function collectLocalRecords(): Promise<LocalRecord[]> {
  const metaByKey = new Map((await db.syncMeta.toArray()).map((m) => [m.key, m]))
  const seen = new Set<string>()
  const out: LocalRecord[] = []

  for (const kind of SYNC_KINDS) {
    const rows = await tableFor(kind).toArray()
    for (const row of rows) {
      const id = String(row.id)
      const key = `${kind}:${id}`
      seen.add(key)
      const meta = metaByKey.get(key)
      const clean = !!meta && !meta.deleted && meta.snapshot === snapshotOf(row)
      out.push({
        record: { kind, id, payload: row, updatedAt: meta?.updatedAt ?? 0, deleted: false },
        dirty: !clean,
      })
    }
  }

  // Rows with meta but no live object were deleted locally.
  for (const meta of metaByKey.values()) {
    if (seen.has(meta.key)) continue
    out.push({
      record: { kind: meta.kind, id: meta.id, payload: null, updatedAt: meta.updatedAt, deleted: true },
      dirty: !meta.deleted, // a fresh local delete is dirty; an already-synced tombstone is clean
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

/** Record the reconciled version of each record so the next scan can tell what
 *  changed and won't re-push what's already in sync. */
async function writeMeta(records: SyncRecord[]): Promise<void> {
  if (records.length === 0) return
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
): Promise<SyncResult> {
  const localList = await collectLocalRecords()
  const localByKey = new Map(localList.map((l) => [recordKey(l.record), l]))
  const remoteByKey = new Map(remote.map((r) => [recordKey(r), r]))
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys()])

  const toApply: SyncRecord[] = []
  const toPush: SyncRecord[] = []
  for (const key of keys) {
    const l = localByKey.get(key)
    const r = remoteByKey.get(key)
    if (l?.dirty) {
      // An un-pushed local edit wins and is always pushed (its timestamp is a
      // placeholder equal to the last-synced one, so a version check can't tell
      // it apart from the remote — but the payload has changed).
      if (transport) toPush.push(l.record)
    } else if (l && r) {
      const win = pickWinner(l.record, r) // server-timestamp LWW
      if (!sameVersion(l.record, win)) toApply.push(win)
      if (transport && !sameVersion(r, win)) toPush.push(win)
    } else {
      const win = (l?.record ?? r) as SyncRecord
      if (!l) toApply.push(win) // remote-only → apply locally
      if (transport && !r) toPush.push(win) // local-only → push
    }
  }

  await applyLocally(toApply)

  // Meta is written only for rows we applied (adopting the server timestamp) or
  // pushed (adopting the server's freshly-stamped timestamp). An un-pushed dirty
  // row is deliberately left untracked so it stays dirty until it syncs up.
  const written = new Map<string, SyncRecord>()
  for (const w of toApply) written.set(recordKey(w), w)
  if (transport && toPush.length > 0) {
    const stamped = await transport.push(toPush)
    const stampedByKey = new Map(stamped.map((s) => [recordKey(s), s]))
    for (const w of toPush) written.set(recordKey(w), stampedByKey.get(recordKey(w)) ?? w)
  }
  await writeMeta([...written.values()])

  return { applied: toApply.length, pushed: transport ? toPush.length : 0 }
}

/** Full two-way sync: pull the whole workspace, resolve last-write-wins against
 *  local state, apply winners locally, and push local edits (server-stamped). */
export async function reconcile(transport: SyncTransport): Promise<SyncResult> {
  const remote = await transport.pullAll()
  return reconcileCore(remote, transport)
}

/** Apply a realtime batch from another device. Does not push; a remote record
 *  never overwrites an un-pushed local edit (those go up on the next reconcile). */
export async function applyIncoming(remote: SyncRecord[]): Promise<SyncResult> {
  return reconcileCore(remote, null)
}
