import { useRef, useState } from 'react'
import type { Item } from '../domain/types'

/** A searchable, alphabetical item picker. Replaces a long native <select>
 *  (which only jumps by first letter and shows items in insertion order) with
 *  a type-to-filter combobox. Dependency-free; emits the chosen item id. */
export function ItemCombobox({
  items,
  value,
  onSelect,
  placeholder = '— pick item —',
  autoFocus = false,
}: {
  items: Item[]
  value: string
  onSelect: (itemId: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const selected = items.find((i) => i.id === value)
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))
  const q = query.trim().toLowerCase()
  const filtered = q === '' ? sorted : sorted.filter((i) => i.name.toLowerCase().includes(q))

  function choose(itemId: string) {
    onSelect(itemId)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        autoFocus={autoFocus}
        className="w-full rounded border border-gray-300 px-2 py-1"
        placeholder={placeholder}
        // Closed: show the selected item's name. Open: show what's being typed.
        value={open ? query : (selected?.name ?? '')}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => {
          setOpen(true)
          setQuery(e.target.value)
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120)
        }}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-gray-300 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-gray-400">no match</li>
          ) : (
            filtered.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-emerald-50 ${
                    i.id === value ? 'font-medium text-emerald-800' : 'text-gray-700'
                  }`}
                  // Fire before the input's blur so the click isn't lost.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    if (blurTimer.current) clearTimeout(blurTimer.current)
                    choose(i.id)
                  }}
                >
                  {i.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
