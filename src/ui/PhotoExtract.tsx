import { useState } from 'react'
import type { ExtractedItem } from '../domain/extract'
import { clearApiKey, getApiKey, setApiKey } from '../extract/apiKey'
import { EXTRACT_MODEL } from '../extract/config'
import { fileToJpegBase64 } from '../extract/image'

/** Snap 1–2 photos of a product (front of pack and/or nutrition label) and
 *  prefill the Add Item form from them (PLAN.md §9.5). Extraction is a
 *  draft, never a silent write — the user reviews before saving. */
export function PhotoExtract({ onExtract }: { onExtract: (item: ExtractedItem) => void }) {
  const [hasKey, setHasKey] = useState(getApiKey() !== null)
  const [keyDraft, setKeyDraft] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractedName, setExtractedName] = useState<string | null>(null)

  async function extract() {
    const apiKey = getApiKey()
    if (!apiKey || files.length === 0) return
    setBusy(true)
    setError(null)
    setExtractedName(null)
    // Dynamic import keeps the Anthropic SDK out of the main bundle.
    const client = await import('../extract/client')
    try {
      const photos = await Promise.all(files.map((f) => fileToJpegBase64(f)))
      const item = await client.extractItemFromPhotos(apiKey, photos)
      onExtract(item)
      setExtractedName(item.name)
      setFiles([])
    } catch (e) {
      setError(client.extractErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">
        Add item from photos
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
              Reading labels uses the Anthropic API ({EXTRACT_MODEL}) with your own key — a few
              cents per item at most. The key and your photos go only to Anthropic, directly from
              this browser. The key is kept in this browser only and is never included in backups.
            </p>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="text-sm"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []).slice(0, 2))
                  setExtractedName(null)
                  e.target.value = ''
                }}
              />
              <button
                className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white disabled:opacity-40"
                disabled={busy || files.length === 0}
                onClick={() => void extract()}
              >
                {busy ? 'Reading label…' : 'Extract item'}
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
              {files.length > 0
                ? `${files.length} photo${files.length === 1 ? '' : 's'} selected — front of pack and/or the nutrition label work best.`
                : 'Take or pick 1–2 photos: the front of the pack and/or the nutrition label.'}
            </p>
          </>
        )}
        {extractedName && (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
            Read “{extractedName}” — review the prefilled form above, fix anything it got wrong,
            then Add.
          </p>
        )}
        {error && (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-red-800">{error}</p>
        )}
      </div>
    </details>
  )
}
