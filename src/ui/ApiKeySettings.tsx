import { useState } from 'react'
import { clearApiKey, getApiKey, setApiKey } from '../extract/apiKey'

// A single, generic place to set the Anthropic API key that powers all the AI
// features (photo/link item extraction, build-a-meal-from-text, AI day notes).
// The key lives only in localStorage — never Dexie, a backup, or a synced
// workspace.
export function ApiKeySettings() {
  const [hasKey, setHasKey] = useState(() => getApiKey() !== null)
  const [draft, setDraft] = useState('')

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="font-semibold text-gray-800">AI features — Anthropic API key</h2>
      <p className="text-sm text-gray-600">
        Optional. Powers photo/link item extraction, “build a meal from text”, and AI day notes.
        Your key is stored only in this browser — never synced, backed up, or shared. Get one at{' '}
        <span className="font-mono text-xs">console.anthropic.com</span>.
      </p>
      {hasKey ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-emerald-700">✓ Key saved on this device</span>
          <button
            className="text-gray-500 underline"
            onClick={() => {
              clearApiKey()
              setHasKey(false)
            }}
          >
            forget key
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="sk-ant-…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            disabled={draft.trim() === ''}
            onClick={() => {
              setApiKey(draft)
              setDraft('')
              setHasKey(true)
            }}
          >
            Save key
          </button>
        </div>
      )}
    </section>
  )
}
