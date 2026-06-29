// M7 sync core (pure). The cloud backend (src/sync/) is a sync *target*, not
// the source of truth: every synced domain object becomes a SyncRecord with a
// last-write-wins clock, and conflicts resolve here with no I/O. Because plans
// are individual per person (story 5.3), genuine conflicts are rare and per-row
// last-write-wins is sufficient — no CRDT (see PLAN.md §10).

export type SyncKind = 'trip' | 'person' | 'item' | 'meal' | 'resupply' | 'planEntry'

/** The six synced tables, in a stable order. */
export const SYNC_KINDS: readonly SyncKind[] = [
  'trip',
  'person',
  'item',
  'meal',
  'resupply',
  'planEntry',
]

export interface SyncRecord<T = unknown> {
  kind: SyncKind
  id: string
  /** The domain object, or null when this record is a tombstone. */
  payload: T | null
  /** Epoch ms of the last write — the last-write-wins clock. */
  updatedAt: number
  /** True when the record represents a deletion (payload is then null). */
  deleted: boolean
}

export function recordKey(r: Pick<SyncRecord, 'kind' | 'id'>): string {
  return `${r.kind}:${r.id}`
}

function stableKey(r: SyncRecord): string {
  return JSON.stringify(r.payload ?? null)
}

/** Pick the winning version of one record. Deliberately commutative so every
 *  device converges to the same value regardless of merge order: a newer
 *  `updatedAt` wins; on a tie a deletion wins (a delete is final); failing
 *  that, a stable comparison of the payloads breaks it. */
export function pickWinner<T>(a: SyncRecord<T>, b: SyncRecord<T>): SyncRecord<T> {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.deleted !== b.deleted) return a.deleted ? a : b
  return stableKey(a) >= stableKey(b) ? a : b
}

/** Merge two sets of records by key, keeping the winner of each pair. The
 *  result order is unspecified; callers key off `recordKey`. */
export function mergeRecords<T>(a: SyncRecord<T>[], b: SyncRecord<T>[]): SyncRecord<T>[] {
  const byKey = new Map<string, SyncRecord<T>>()
  for (const r of [...a, ...b]) {
    const k = recordKey(r)
    const existing = byKey.get(k)
    byKey.set(k, existing ? pickWinner(existing, r) : r)
  }
  return [...byKey.values()]
}

/** Records changed strictly after a cursor (epoch ms) — the delta to push or
 *  the delta a pull returns. */
export function changedSince<T>(records: SyncRecord<T>[], sinceMs: number): SyncRecord<T>[] {
  return records.filter((r) => r.updatedAt > sinceMs)
}

/** The newest `updatedAt` across a set (or `fallback` when empty) — the cursor
 *  to remember for the next incremental pull. */
export function latestCursor(records: SyncRecord[], fallback = 0): number {
  return records.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), fallback)
}

const WORKSPACE_TOKEN_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Pull a workspace link token (a UUID) out of arbitrary input — a bare token,
 *  a full share URL, or a `#join=…` fragment — so the connect field is
 *  forgiving about what gets pasted. Returns null when there's no token. */
export function extractWorkspaceToken(input: string): string | null {
  const match = input.match(WORKSPACE_TOKEN_RE)
  return match ? match[0].toLowerCase() : null
}
