import { useState } from 'react'
import { matchMealDraft, type MealDraftMatch } from '../domain/mealText'
import { clearApiKey, getApiKey, setApiKey } from '../extract/apiKey'
import { EXTRACT_MODEL } from '../extract/config'
import { fmtCalories } from './format'
import type { Item } from '../domain/types'

/** Describe one or more meals in plain text; the model drafts them, this
 *  previews them (matched to library items, with real serving sizes), and you
 *  save the batch (Epic 17). Same user-supplied Anthropic key as photo extract;
 *  nothing is saved until you confirm. */
export function MealTextBuilder({
  items,
  onSave,
}: {
  items: Item[]
  onSave: (drafts: MealDraftMatch[]) => void
}) {
  const [hasKey, setHasKey] = useState(getApiKey() !== null)
  const [keyDraft, setKeyDraft] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<MealDraftMatch[] | null>(null)

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const mealCalories = (d: MealDraftMatch) =>
    d.components.reduce((n, c) => n + c.grams * (itemsById.get(c.itemId)?.caloriesPerGram ?? 0), 0)

  async function build() {
    const apiKey = getApiKey()
    if (!apiKey || text.trim() === '') return
    setBusy(true)
    setError(null)
    setNote(null)
    setDrafts(null)
    const client = await import('../extract/mealText')
    try {
      const answers = await client.buildMealsFromText(apiKey, text, items)
      setDrafts(answers.map((a) => matchMealDraft(a, items)))
    } catch (e) {
      setError(client.mealTextErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function saveAll() {
    if (!drafts) return
    const saveable = drafts.filter((d) => d.components.length > 0)
    onSave(saveable)
    setNote(`Saved ${saveable.length} meal${saveable.length === 1 ? '' : 's'} to the library.`)
    setDrafts(null)
    setText('')
  }

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">
        Build meals from text
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
              extract) — a fraction of a cent. The key stays in this browser and is never included
              in backups.
            </p>
          </form>
        ) : (
          <>
            <textarea
              className="w-full rounded border border-gray-300 px-2 py-1"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                'Describe one or more meals, e.g.\n' +
                'Breakfast: oatmeal, chia, 1/8 butter stick, dried blueberries\n' +
                'Dinner: chicken fajita bowl + hot choc'
              }
            />
            <div className="flex items-center gap-3">
              <button
                className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
                disabled={busy || text.trim() === '' || items.length === 0}
                onClick={() => void build()}
              >
                {busy ? 'Building…' : 'Build meals'}
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
              Describe meals in plain words; it matches your library items and grounds quantities in
              their serving sizes. Review below, then save.
              {items.length === 0 && ' (add items in the Items tab first)'}
            </p>
          </>
        )}

        {drafts && drafts.length > 0 && (
          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
            <p className="font-medium text-gray-800">
              {drafts.length} meal{drafts.length === 1 ? '' : 's'} drafted — review:
            </p>
            <ul className="space-y-2">
              {drafts.map((d, i) => (
                <li key={i} className="rounded border border-gray-200 bg-white p-2">
                  <div className="font-medium text-gray-800">
                    {d.name} <span className="font-normal text-gray-500">· {d.type}</span>{' '}
                    <span className="font-normal text-gray-500">· {fmtCalories(mealCalories(d))}</span>
                  </div>
                  <div className="text-gray-600">
                    {d.components
                      .map((c) => `${itemsById.get(c.itemId)?.name ?? '?'} ${Math.round(c.grams)}g`)
                      .join(', ') || '(no matched items)'}
                  </div>
                  {d.unmatched.length > 0 && (
                    <div className="text-amber-700">
                      couldn’t match: {d.unmatched.map((u) => u.name).join(', ')} — add by hand after
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button
                className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-40"
                disabled={drafts.every((d) => d.components.length === 0)}
                onClick={saveAll}
              >
                Save {drafts.filter((d) => d.components.length > 0).length} to library
              </button>
              <button className="text-gray-500 underline" onClick={() => setDrafts(null)}>
                discard
              </button>
            </div>
          </div>
        )}
        {note && (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">{note}</p>
        )}
        {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>}
      </div>
    </details>
  )
}
