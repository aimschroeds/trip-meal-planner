import { useState } from 'react'
import { matchMealDraft, type MealDraftMatch } from '../domain/mealText'
import { clearApiKey, getApiKey, setApiKey } from '../extract/apiKey'
import { EXTRACT_MODEL } from '../extract/config'
import type { Item } from '../domain/types'

/** Describe a meal in plain text and have it land in the composer as a draft
 *  (Epic 17). Uses the same user-supplied Anthropic key as photo extract; the
 *  result is always a draft for review, never a silent save. */
export function MealTextBuilder({
  items,
  onBuild,
}: {
  items: Item[]
  onBuild: (draft: MealDraftMatch) => void
}) {
  const [hasKey, setHasKey] = useState(getApiKey() !== null)
  const [keyDraft, setKeyDraft] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function build() {
    const apiKey = getApiKey()
    if (!apiKey || text.trim() === '') return
    setBusy(true)
    setError(null)
    setNote(null)
    const client = await import('../extract/mealText')
    try {
      const answer = await client.buildMealFromText(apiKey, text, items.map((i) => i.name))
      const draft = matchMealDraft(answer, items)
      onBuild(draft)
      if (draft.unmatched.length > 0) {
        setNote(
          `Added ${draft.components.length} item${draft.components.length === 1 ? '' : 's'}. ` +
            `Couldn't match: ${draft.unmatched.map((u) => u.name).join(', ')} — add by hand.`,
        )
      } else {
        setNote(`Drafted ${draft.components.length} item${draft.components.length === 1 ? '' : 's'} — review and save.`)
      }
      setText('')
    } catch (e) {
      setError(client.mealTextErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">
        Build a meal from text
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        {!hasKey ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (keyDraft.trim() !== '') {
                setApiKey(keyDraft)
                setKeyDraft('')
                setHasKey(true)
              }
            }}
          >
            <label className="block grow">
              <span className="block text-gray-600">Anthropic API key</span>
              <input
                type="password"
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-ant-…"
              />
            </label>
            <button
              type="submit"
              disabled={keyDraft.trim() === ''}
              className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
            >
              Save key
            </button>
            <p className="w-full text-xs text-gray-500">
              Uses the Anthropic API ({EXTRACT_MODEL}) with your own key (shared with photo
              extract) — a fraction of a cent per meal. The key stays in this browser and is never
              included in backups.
            </p>
          </form>
        ) : (
          <>
            <textarea
              className="w-full rounded border border-gray-300 px-2 py-1"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Oatmeal 80g, 15g chia, 1/8 butter stick, 40g dried blueberries"
            />
            <div className="flex items-center gap-3">
              <button
                className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
                disabled={busy || text.trim() === '' || items.length === 0}
                onClick={() => void build()}
              >
                {busy ? 'Building…' : 'Build meal'}
              </button>
              <button
                className="text-xs text-gray-500 underline"
                onClick={() => {
                  clearApiKey()
                  setHasKey(false)
                }}
              >
                forget API key
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Describe a meal in plain words; it matches your library items, fills quantities, and
              drops a draft into the composer above to review and save.
              {items.length === 0 && ' (add items in the Items tab first)'}
            </p>
          </>
        )}
        {note && (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">{note}</p>
        )}
        {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
      </div>
    </details>
  )
}
