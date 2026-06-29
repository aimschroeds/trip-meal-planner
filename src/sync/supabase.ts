// The cloud sync target (Supabase). Like src/extract/, this is networked code:
// it is the only place that talks to a server, loads its SDK dynamically so the
// main bundle stays lean, and is inert until configured. IndexedDB remains the
// local source of truth — this layer only pushes/pulls SyncRecords (PLAN.md §10).
//
// The Anthropic API key never reaches this layer or the cloud: it stays in
// localStorage, never in Dexie, backups, or a workspace.

import type { SupabaseClient } from '@supabase/supabase-js'

interface SyncConfig {
  url: string
  anonKey: string
}

export function syncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  return url && anonKey ? { url, anonKey } : null
}

/** Whether cloud sync is available in this build (env vars present). When
 *  false the app is purely local — nothing is ever uploaded and the sync UI
 *  stays hidden. */
export function isSyncConfigured(): boolean {
  return syncConfig() !== null
}

let clientPromise: Promise<SupabaseClient> | null = null

/** Lazily create the singleton Supabase client; the dynamic import keeps the
 *  SDK out of the initial bundle. Throws if sync isn't configured. */
export async function getSupabase(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise
  const cfg = syncConfig()
  if (!cfg) {
    throw new Error('Cloud sync is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
  }
  clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    }),
  )
  return clientPromise
}

/** Ensure there's a signed-in user, returning its id. The share-link model
 *  uses anonymous auth: each device gets a stable identity with no sign-up
 *  step. Requires "Allow anonymous sign-ins" enabled on the project. */
export async function ensureAnonSession(): Promise<string> {
  const supabase = await getSupabase()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.user) return session.user.id

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  if (!data.user) throw new Error('Anonymous sign-in returned no user.')
  return data.user.id
}
