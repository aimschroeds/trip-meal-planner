// Supabase implementation of the engine's SyncTransport (M7): maps SyncRecords
// to the workspace-scoped `records` table and exposes a realtime subscription.
// Deliberately thin — all conflict logic lives in the pure engine/core.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from './supabase'
import type { SyncTransport } from './engine'
import type { SyncKind, SyncRecord } from '../domain/sync'

interface RecordRow {
  workspace_id: string
  kind: SyncKind
  id: string
  payload: unknown
  updated_at: string
  deleted_at: string | null
}

function toRow(workspaceId: string, r: SyncRecord): RecordRow {
  const iso = new Date(r.updatedAt).toISOString()
  return {
    workspace_id: workspaceId,
    kind: r.kind,
    id: r.id,
    payload: r.deleted ? null : r.payload,
    updated_at: iso,
    deleted_at: r.deleted ? iso : null,
  }
}

function fromRow(row: RecordRow): SyncRecord {
  return {
    kind: row.kind,
    id: row.id,
    payload: row.payload ?? null,
    updatedAt: Date.parse(row.updated_at),
    deleted: row.deleted_at != null,
  }
}

export interface SupabaseTransport extends SyncTransport {
  /** Stream record changes from other devices; returns an unsubscribe fn. */
  subscribe(onRecords: (records: SyncRecord[]) => void): Promise<() => void>
}

export function supabaseTransport(workspaceId: string): SupabaseTransport {
  return {
    async push(records) {
      if (records.length === 0) return
      const supabase = await getSupabase()
      const { error } = await supabase
        .from('records')
        .upsert(records.map((r) => toRow(workspaceId, r)), { onConflict: 'workspace_id,kind,id' })
      if (error) throw new Error(error.message)
    },

    async pullAll() {
      const supabase = await getSupabase()
      // The workspace is small; one select returns everything (PostgREST caps
      // at 1000 rows — paginate here if a workspace ever outgrows that).
      const { data, error } = await supabase.from('records').select('*').eq('workspace_id', workspaceId)
      if (error) throw new Error(error.message)
      return (data as RecordRow[]).map(fromRow)
    },

    async subscribe(onRecords) {
      const supabase = await getSupabase()
      const channel: RealtimeChannel = supabase
        .channel(`workspace:${workspaceId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'records',
            filter: `workspace_id=eq.${workspaceId}`,
          },
          (payload) => {
            const row = payload.new as Partial<RecordRow>
            if (row && row.kind && row.id) onRecords([fromRow(row as RecordRow)])
          },
        )
        .subscribe()
      return () => {
        void supabase.removeChannel(channel)
      }
    },
  }
}
