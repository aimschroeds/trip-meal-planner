import { useEffect, useState } from 'react'
import { useSync } from './useSync'
import { clearJoinToken, readJoinToken } from '../sync/workspace'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Connected',
  syncing: 'Syncing…',
  synced: 'All changes synced',
  error: 'Sync error',
}

export function SyncPanel() {
  const sync = useSync()
  const [tokenInput, setTokenInput] = useState('')
  const [copied, setCopied] = useState(false)
  // A join token in the URL means this page was opened from a share link;
  // derived so it disappears the moment we connect.
  const pendingJoin = !sync.connected ? readJoinToken() : null

  // Once connected, drop the handled join token from the URL.
  useEffect(() => {
    if (sync.connected) clearJoinToken()
  }, [sync.connected])

  if (!sync.configured) {
    return (
      <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-800">Cloud sync &amp; sharing</h2>
        <p className="text-sm text-gray-500">
          Not enabled for this build. Data stays in this browser; use Export/Import below to move
          it between devices.
        </p>
      </section>
    )
  }

  async function copyLink() {
    if (!sync.shareLink) return
    await navigator.clipboard.writeText(sync.shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800">Cloud sync &amp; sharing</h2>
        {sync.connected && (
          <span
            className={
              sync.status === 'error'
                ? 'text-xs font-medium text-red-700'
                : 'text-xs font-medium text-emerald-700'
            }
          >
            {STATUS_LABEL[sync.status] ?? 'Connected'}
          </span>
        )}
      </div>

      {!sync.connected && (
        <>
          <p className="text-sm text-gray-600">
            Publish this planner to the cloud to use it across devices and share it with hiking
            partners. Everyone with the link shares one library and all its trips, syncing live.
          </p>
          {pendingJoin && (
            <div className="space-y-2 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
              <p className="text-emerald-900">
                You opened a <span className="font-medium">share link</span>. Connect to join that
                shared planner — your current local data will be merged in and kept in sync.
              </p>
              <button
                className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-50"
                disabled={sync.busy}
                onClick={() => void sync.connect(pendingJoin)}
              >
                {sync.busy ? 'Connecting…' : 'Connect to shared planner'}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={sync.busy}
              onClick={() => void sync.publish()}
            >
              {sync.busy ? 'Publishing…' : 'Publish to cloud'}
            </button>
            <span className="text-sm text-gray-400">or join with a link:</span>
            <input
              type="text"
              placeholder="paste a share link"
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button
              className="rounded border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-800 disabled:opacity-50"
              disabled={sync.busy || !tokenInput.trim()}
              onClick={() => void sync.connect(tokenInput.trim())}
            >
              Connect
            </button>
          </div>
        </>
      )}

      {sync.connected && (
        <>
          <p className="text-sm text-gray-600">
            This planner is synced to the cloud. Share the link below to let others view and edit it
            together.
          </p>
          {sync.shareLink && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                className="min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700"
                value={sync.shareLink}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="rounded border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-800"
                onClick={() => void copyLink()}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-50"
              disabled={sync.busy}
              onClick={() => sync.syncNow()}
            >
              Sync now
            </button>
            <button className="text-gray-500 underline" disabled={sync.busy} onClick={() => void sync.disconnect()}>
              Disconnect
            </button>
            {sync.lastSyncedAt && (
              <span className="text-gray-400">
                last synced {new Date(sync.lastSyncedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </>
      )}

      {sync.error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {sync.error}
        </p>
      )}
    </section>
  )
}
