import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { removeGearFromTrip, toggleGearAssignment } from '../store/repos'
import { categoryLabel, isBigThree, ownerPersonId } from '../domain/gear'
import type { GearAssignment, GearItem, Person, Trip } from '../domain/types'
import { fmtGrams } from './format'

// A searchable picker for choosing which gear goes on a trip. Shows the whole
// library grouped by category; check to add/remove (add assigns to the first
// person, then who-carries can be adjusted per item on multi-person trips).
export function GearPickerModal({
  trip,
  people,
  onClose,
}: {
  trip: Trip
  people: Person[]
  onClose: () => void
}) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const assigned = new Set(assignments.map((a) => `${a.personId}|${a.gearItemId}`))
  const onTripIds = new Set(assignments.map((a) => a.gearItemId))
  const defaultCarrier = people[0]?.id
  const multi = people.length > 1

  const q = query.trim().toLowerCase()
  const filtered = gear.filter(
    (g) =>
      q === '' ||
      g.name.toLowerCase().includes(q) ||
      (g.brand ?? '').toLowerCase().includes(q) ||
      (g.owner ?? '').toLowerCase().includes(q) ||
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

  function toggleOnTrip(g: GearItem) {
    if (onTripIds.has(g.id)) {
      void removeGearFromTrip(trip.id, g.id)
      return
    }
    // Personal gear auto-assigns to the person whose name matches its owner;
    // otherwise it goes to the first person and can be reassigned below.
    const carrier = ownerPersonId(g.owner, people) ?? defaultCarrier
    if (carrier) void toggleGearAssignment(trip.id, carrier, g.id)
  }

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
            <h3 className="font-semibold text-gray-800">Gear for this trip</h3>
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
            placeholder="search gear by name, brand, or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            {onTripIds.size} on this trip — check to add or remove
            {multi ? '; set who carries below each one' : ''}.
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {gear.length === 0 ? (
            <p className="text-sm text-gray-500">
              No gear in your library yet — add some on the <span className="font-medium">Gear</span>{' '}
              tab first.
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
                    const on = onTripIds.has(g.id)
                    return (
                      <li key={g.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={on} onChange={() => toggleOnTrip(g)} />
                          <span className={on ? 'font-medium text-gray-800' : 'text-gray-700'}>
                            {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                            {g.name}
                          </span>
                          <span className="tabular-nums text-gray-400">{fmtGrams(g.weightG)}</span>
                          {g.owner && (
                            <span className="rounded bg-violet-100 px-1 text-xs text-violet-800">
                              {g.owner}
                            </span>
                          )}
                          {g.shared && (
                            <span className="rounded bg-sky-100 px-1 text-xs text-sky-800">
                              shared
                            </span>
                          )}
                        </label>
                        {on && multi && (
                          <div className="ml-6 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                            carried by:
                            {people.map((p) => (
                              <label key={p.id} className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={assigned.has(`${p.id}|${g.id}`)}
                                  onChange={() => void toggleGearAssignment(trip.id, p.id, g.id)}
                                />
                                {p.name}
                              </label>
                            ))}
                          </div>
                        )}
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
