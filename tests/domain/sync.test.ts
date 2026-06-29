import { describe, expect, it } from 'vitest'
import {
  changedSince,
  extractWorkspaceToken,
  latestCursor,
  mergeRecords,
  pickWinner,
  recordKey,
  type SyncRecord,
} from '../../src/domain/sync'

function rec<T>(over: Partial<SyncRecord<T>> & { id: string }): SyncRecord<T> {
  return {
    kind: 'item',
    payload: ({ v: 1 } as unknown) as T,
    updatedAt: 1000,
    deleted: false,
    ...over,
  }
}

describe('recordKey', () => {
  it('namespaces the id by kind so different tables never collide', () => {
    expect(recordKey({ kind: 'item', id: 'x' })).toBe('item:x')
    expect(recordKey({ kind: 'meal', id: 'x' })).not.toBe(recordKey({ kind: 'item', id: 'x' }))
  })
})

describe('pickWinner', () => {
  it('keeps the newer write', () => {
    const older = rec({ id: 'a', updatedAt: 1000 })
    const newer = rec({ id: 'a', updatedAt: 2000 })
    expect(pickWinner(older, newer)).toBe(newer)
    expect(pickWinner(newer, older)).toBe(newer)
  })

  it('lets a deletion win a timestamp tie (a delete is final)', () => {
    const edit = rec({ id: 'a', updatedAt: 1000, deleted: false })
    const tombstone = rec({ id: 'a', updatedAt: 1000, deleted: true, payload: null })
    expect(pickWinner(edit, tombstone)).toBe(tombstone)
    expect(pickWinner(tombstone, edit)).toBe(tombstone)
  })

  it('is commutative for concurrent edits (same value regardless of order)', () => {
    const a = rec({ id: 'a', updatedAt: 1000, payload: { v: 'aaa' } })
    const b = rec({ id: 'a', updatedAt: 1000, payload: { v: 'bbb' } })
    expect(pickWinner(a, b)).toEqual(pickWinner(b, a))
  })
})

describe('mergeRecords', () => {
  it('unions distinct records and resolves conflicts by key', () => {
    const local = [
      rec({ id: 'keep-local', updatedAt: 3000, payload: { v: 'L' } }),
      rec({ id: 'only-local', updatedAt: 1000 }),
    ]
    const remote = [
      rec({ id: 'keep-local', updatedAt: 2000, payload: { v: 'R' } }),
      rec({ id: 'only-remote', kind: 'meal', updatedAt: 1000 }),
    ]
    const merged = mergeRecords(local, remote)
    const byKey = new Map(merged.map((r) => [recordKey(r), r]))
    expect(merged).toHaveLength(3)
    expect(byKey.get('item:keep-local')?.payload).toEqual({ v: 'L' })
    expect(byKey.get('item:only-local')).toBeDefined()
    expect(byKey.get('meal:only-remote')).toBeDefined()
  })

  it('a remote tombstone overrides an older local edit', () => {
    const local = [rec({ id: 'gone', updatedAt: 1000, payload: { v: 'edit' } })]
    const remote = [rec({ id: 'gone', updatedAt: 2000, deleted: true, payload: null })]
    const merged = mergeRecords(local, remote)
    expect(merged).toHaveLength(1)
    expect(merged[0].deleted).toBe(true)
  })
})

describe('extractWorkspaceToken', () => {
  const token = '0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d'

  it('reads a bare token', () => {
    expect(extractWorkspaceToken(token)).toBe(token)
  })

  it('pulls the token out of a full share link or join fragment', () => {
    expect(extractWorkspaceToken(`https://x.dev/trip-meal-planner/#join=${token}`)).toBe(token)
    expect(extractWorkspaceToken(`  #join=${token.toUpperCase()}  `)).toBe(token)
  })

  it('returns null when there is no token', () => {
    expect(extractWorkspaceToken('not a link')).toBeNull()
  })
})

describe('changedSince / latestCursor', () => {
  const records = [
    rec({ id: 'a', updatedAt: 1000 }),
    rec({ id: 'b', updatedAt: 2000 }),
    rec({ id: 'c', updatedAt: 3000 }),
  ]

  it('returns only records strictly after the cursor', () => {
    expect(changedSince(records, 1000).map((r) => r.id)).toEqual(['b', 'c'])
    expect(changedSince(records, 3000)).toEqual([])
  })

  it('reports the newest timestamp, or the fallback when empty', () => {
    expect(latestCursor(records)).toBe(3000)
    expect(latestCursor([], 42)).toBe(42)
  })
})
