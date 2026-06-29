// High-level workspace operations (M7): create or join a shared workspace, run
// the initial sync, and build/read the share link. The link carries the secret
// token in the URL hash so opening it lands on the app ready to connect.

import { ensureAnonSession, getSupabase } from './supabase'
import { reconcile } from './engine'
import { supabaseTransport } from './supabaseTransport'
import { clearSyncState, setActiveWorkspace } from './state'
import { extractWorkspaceToken } from '../domain/sync'

export interface Connected {
  workspaceId: string
  token: string
}

/** Create a fresh cloud workspace from this device's data and return a link
 *  token others can redeem. Uploads the current local database. */
export async function publishWorkspace(name?: string): Promise<Connected> {
  await ensureAnonSession()
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('create_workspace', { name: name ?? 'My workspace' })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  const workspaceId = String(row.workspace_id)
  const token = String(row.link_token)
  await setActiveWorkspace(workspaceId, token)
  await reconcile(supabaseTransport(workspaceId))
  return { workspaceId, token }
}

/** Join an existing workspace by redeeming a link token, then sync. */
export async function connectWorkspace(rawToken: string): Promise<Connected> {
  const token = extractWorkspaceToken(rawToken)
  if (!token) throw new Error('That doesn’t look like a valid share link.')
  await ensureAnonSession()
  const supabase = await getSupabase()
  const { data, error } = await supabase.rpc('redeem_link', { link_token: token })
  if (error) throw new Error(error.message)
  const workspaceId = String(data)
  await setActiveWorkspace(workspaceId, token)
  await reconcile(supabaseTransport(workspaceId))
  return { workspaceId, token }
}

/** Leave the workspace: forget local sync bookkeeping so data becomes purely
 *  local again. The cloud copy is untouched (rejoin with the link any time). */
export async function disconnectWorkspace(): Promise<void> {
  await clearSyncState()
}

/** A shareable URL for a workspace edit link (token in the hash). */
export function buildShareLink(token: string): string {
  return `${location.origin}${location.pathname}#join=${token}`
}

/** A pending join token from the URL hash, if this page was opened via a link. */
export function readJoinToken(): string | null {
  return extractWorkspaceToken(location.hash)
}

/** Drop the join token from the URL once it's been handled. */
export function clearJoinToken(): void {
  if (readJoinToken()) {
    history.replaceState(null, '', location.pathname + location.search)
  }
}
