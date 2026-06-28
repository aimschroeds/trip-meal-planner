import { useRef, useState } from 'react'

export interface ComboOption {
  value: string
  label: string
  /** Section heading; '' for an ungrouped option (e.g. an action). */
  group: string
  /** Optional muted text shown after the label (e.g. an item's brand); also
   *  matched by the type-to-filter search. */
  sublabel?: string
  /** Optional right-aligned metadata (e.g. calorie density). */
  hint?: string
}

/** A searchable, grouped action picker. Unlike a value-holding combobox this
 *  always resets after a pick — it drives an "add" action — so it suits the
 *  plan view's "+ add meal or item" slot picker (meals + items + off-trail),
 *  giving it type-to-filter instead of a long native <select>. */
export function GroupedCombobox({
  options,
  onSelect,
  placeholder,
}: {
  options: ComboOption[]
  onSelect: (value: string) => void
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const q = query.trim().toLowerCase()
  const filtered =
    q === ''
      ? options
      : options.filter(
          (o) =>
            o.label.toLowerCase().includes(q) || (o.sublabel?.toLowerCase().includes(q) ?? false),
        )
  const groups: { group: string; opts: ComboOption[] }[] = []
  for (const o of filtered) {
    let g = groups.find((x) => x.group === o.group)
    if (!g) {
      g = { group: o.group, opts: [] }
      groups.push(g)
    }
    g.opts.push(o)
  }

  function choose(value: string) {
    onSelect(value)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative mt-1 w-full">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        className="w-full rounded border border-gray-300 px-1 py-0.5 text-sm text-gray-600"
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
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
            groups.map((g) => (
              <li key={g.group || '_'}>
                {g.group && (
                  <div className="px-2 pt-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                    {g.group}
                  </div>
                )}
                <ul>
                  {g.opts.map((o) => (
                    <li key={o.value}>
                      <button
                        type="button"
                        className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-emerald-50"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          if (blurTimer.current) clearTimeout(blurTimer.current)
                          choose(o.value)
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {o.label}
                          {o.sublabel && (
                            <span className="ml-2 text-xs text-gray-400">{o.sublabel}</span>
                          )}
                        </span>
                        {o.hint && (
                          <span className="shrink-0 tabular-nums text-xs text-gray-400">
                            {o.hint}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
