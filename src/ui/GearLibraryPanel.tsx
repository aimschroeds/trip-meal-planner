import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { categoryLabel, isBigThree } from '../domain/gear'
import type { GearItem } from '../domain/types'
import { fmtGrams } from './format'
import { OwnerPills } from './OwnerPills'

// A hideable fly-in side panel listing the whole gear library to select from.
// Shared by the trip gear tab and the collection builder so "what's available"
// (this panel) stays visually distinct from "what's selected" (the main view).
export function GearLibraryPanel({
  title,
  subtitle,
  onClose,
  isSelected,
  onToggle,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  /** Is this item in the target set (on the trip / in the collection)? */
  isSelected: (g: GearItem) => boolean
  /** Add or remove the item from the target set. */
  onToggle: (g: GearItem) => void
}) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(false)

  // Slide in on mount (rAF so it animates from off-screen), Esc to close.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

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
  const selectedCount = gear.filter(isSelected).length

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className={`flex h-full w-full max-w-md flex-col bg-white shadow-xl transition-transform duration-200 ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2 border-b border-gray-200 p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-gray-800">{title}</h3>
              {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
            </div>
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
            placeholder="search your gear library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            {selectedCount} selected · check to add or remove
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {gear.length === 0 ? (
            <p className="text-sm text-gray-500">
              Your gear library is empty — add gear with the form on this tab first.
            </p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-gray-500">No gear matches “{query}”.</p>
          ) : (
            categories.map((category) => (
              <div key={category}>
                <h4 className="mb-1 border-b border-gray-100 pb-0.5 text-xs font-medium tracking-wide text-gray-500 uppercase">
                  {categoryLabel(category)}
                </h4>
                <ul className="space-y-1">
                  {byCategory.get(category)!.map((g) => {
                    const on = isSelected(g)
                    return (
                      <li key={g.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input type="checkbox" checked={on} onChange={() => onToggle(g)} />
                          <span className={on ? 'font-medium text-gray-800' : 'text-gray-700'}>
                            {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                            {g.name}
                          </span>
                          <span className="tabular-nums text-gray-400">{fmtGrams(g.weightG)}</span>
                          <OwnerPills owners={g.owners} />
                          {g.shared && (
                            <span className="rounded bg-sky-100 px-1 text-xs text-sky-800">
                              shared
                            </span>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
