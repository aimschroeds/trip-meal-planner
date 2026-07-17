import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { toggleCollectionItem } from '../store/repos'
import { categoryLabel, isBigThree } from '../domain/gear'
import type { GearCollection, GearItem } from '../domain/types'
import { fmtGrams } from './format'

// Searchable checklist to set which gear belongs to a collection. Mirrors the
// trip gear picker, but toggles collection membership rather than assignment.
export function CollectionEditorModal({
  collectionId,
  onClose,
}: {
  collectionId: string
  onClose: () => void
}) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const collection = useLiveQuery(
    () => db.gearCollections.get(collectionId),
    [collectionId],
    undefined as GearCollection | undefined,
  )
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const memberIds = new Set(collection?.gearItemIds ?? [])
  const memberWeight = gear
    .filter((g) => memberIds.has(g.id))
    .reduce((n, g) => n + g.weightG, 0)

  const q = query.trim().toLowerCase()
  const filtered = gear.filter(
    (g) =>
      q === '' ||
      g.name.toLowerCase().includes(q) ||
      (g.brand ?? '').toLowerCase().includes(q) ||
      (g.owners ?? []).join(' ').toLowerCase().includes(q) ||
      categoryLabel(g.category).toLowerCase().includes(q) ||
      g.category.toLowerCase().includes(q),
  )
  const byCategory = new Map<string, GearItem[]>()
  for (const g of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = byCategory.get(g.category) ?? []
    list.push(g)
    byCategory.set(g.category, list)
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) =>
      Number(isBigThree(b)) - Number(isBigThree(a)) ||
      categoryLabel(a).localeCompare(categoryLabel(b)),
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2 border-b border-gray-200 p-3">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-800">
              {collection ? `Edit: ${collection.name}` : 'Collection'}
            </h3>
            <button
              className="ml-auto rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white"
              onClick={onClose}
            >
              Done
            </button>
          </div>
          <input
            type="search"
            autoFocus
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="search gear to add to this collection…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-xs text-gray-500 tabular-nums">
            {memberIds.size} in this collection · {fmtGrams(memberWeight)}
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {gear.length === 0 ? (
            <p className="text-sm text-gray-500">Add gear on the Gear tab first.</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-gray-500">No gear matches “{query}”.</p>
          ) : (
            categories.map((category) => (
              <div key={category}>
                <h4 className="mb-1 border-b border-gray-100 pb-0.5 text-xs font-medium tracking-wide text-gray-500 uppercase">
                  {categoryLabel(category)}
                </h4>
                <ul className="space-y-1">
                  {byCategory.get(category)!.map((g) => (
                    <li key={g.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={memberIds.has(g.id)}
                          onChange={() => void toggleCollectionItem(collectionId, g.id)}
                        />
                        <span className={memberIds.has(g.id) ? 'font-medium text-gray-800' : 'text-gray-700'}>
                          {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                          {g.name}
                        </span>
                        <span className="tabular-nums text-gray-400">{fmtGrams(g.weightG)}</span>
                        {g.owners?.length ? (
                          <span className="rounded bg-violet-100 px-1 text-xs text-violet-800">
                            {g.owners.join(', ')}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
