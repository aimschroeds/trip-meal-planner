// Drives cloud sync from React (M7): on connect it reconciles, subscribes to
// realtime, and re-syncs on focus and a slow timer; it also exposes the
// publish/connect/disconnect actions and a status for the UI. IndexedDB stays
// the source of truth — this only schedules reconciles.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { applyIncoming, reconcile } from '../sync/engine'
import { isSyncConfigured } from '../sync/supabase'
import { markSynced } from '../sync/state'
import { supabaseTransport } from '../sync/supabaseTransport'
import {
  buildShareLink,
  connectWorkspace,
  disconnectWorkspace,
  publishWorkspace,
} from '../sync/workspace'

// A full pull is cheap at this scale; realtime carries fast incoming updates,
// so the timer mostly flushes local edits. Kept slow to stay quiet.
const SYNC_INTERVAL_MS = 8000

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

export function useSync() {
  const configured = isSyncConfigured()
  const state = useLiveQuery(() => db.syncState.get('state'), [])
  const workspaceId = state?.workspaceId ?? null

  const [status, setStatus] = useState<SyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  const runSync = useCallback(async (wsId: string) => {
    if (runningRef.current) return
    runningRef.current = true
    setStatus('syncing')
    try {
      await reconcile(supabaseTransport(wsId))
      await markSynced()
      setStatus('synced')
      setError(null)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      runningRef.current = false
    }
  }, [])

  // While connected: initial sync + realtime + focus/timer reconciles.
  useEffect(() => {
    if (!configured || !workspaceId) return
    let unsub: (() => void) | undefined
    let cancelled = false

    // Deferred so the initial reconcile's setState doesn't run synchronously
    // inside the effect (it's an external-system kick-off, not render state).
    const initial = setTimeout(() => void runSync(workspaceId), 0)
    void supabaseTransport(workspaceId)
      .subscribe((records) => void applyIncoming(records))
      .then((u) => {
        if (cancelled) u()
        else unsub = u
      })

    const onFocus = () => {
      if (document.visibilityState === 'visible') void runSync(workspaceId)
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    const timer = setInterval(onFocus, SYNC_INTERVAL_MS)

    return () => {
      cancelled = true
      clearTimeout(initial)
      unsub?.()
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [configured, workspaceId, runSync])

  const withBusy = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const publish = useCallback(() => withBusy(() => publishWorkspace().then(() => undefined)), [withBusy])
  const connect = useCallback(
    (token: string) => withBusy(() => connectWorkspace(token).then(() => undefined)),
    [withBusy],
  )
  const disconnect = useCallback(() => withBusy(() => disconnectWorkspace()), [withBusy])
  const syncNow = useCallback(() => {
    if (workspaceId) void runSync(workspaceId)
  }, [workspaceId, runSync])

  return {
    configured,
    connected: !!workspaceId,
    workspaceId,
    shareLink: state?.linkToken ? buildShareLink(state.linkToken) : null,
    lastSyncedAt: state?.lastSyncedAt ?? null,
    status,
    error,
    busy,
    publish,
    connect,
    disconnect,
    syncNow,
  }
}
