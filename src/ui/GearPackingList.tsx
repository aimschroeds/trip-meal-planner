import { useLiveQuery } from 'dexie-react-hooks'
import { db, type MarkRow } from '../store/db'
import { toggleGearPacked } from '../store/repos'
import { isGearPacked } from '../domain/gear'
import type { GearAssignment, GearItem, Person, Trip } from '../domain/types'
import { fmtGrams } from './format'

// Gear half of the trip's packing list (the food half is per-carry above).
// Gear is carried the whole trip, so it's a simple per-person checklist. Ticks
// reuse the shared `pack` marks (namespaced `gear:person:item`) so they sync.
export function GearPackingList({ trip, people }: { trip: Trip; people: Person[] }) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )
  const marks = useLiveQuery(
    () => db.marks.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as MarkRow[],
  )

  if (assignments.length === 0) return null

  const gearById = new Map(gear.map((g) => [g.id, g]))
  const packed = new Set(marks.filter((m) => m.scope === 'pack').map((m) => m.ref))
  const isPackedFor = (personId: string, gearItemId: string, qty: number) =>
    isGearPacked(packed, personId, gearItemId, qty)
  const togglePack = (personId: string, gearItemId: string, qty: number) =>
    void toggleGearPacked(trip.id, personId, gearItemId, qty, packed)

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 font-semibold text-gray-800">🎒 Gear to pack</h3>
      <div className="space-y-3">
        {people.map((p) => {
          const items = assignments
            .filter((a) => a.personId === p.id)
            .map((a) => ({ a, g: gearById.get(a.gearItemId) }))
            .filter((x): x is { a: GearAssignment; g: GearItem } => !!x.g)
            .sort((x, y) => x.g.category.localeCompare(y.g.category) || x.g.name.localeCompare(y.g.name))
          if (items.length === 0) return null
          const total = items.reduce((n, { a, g }) => n + g.weightG * (a.quantity ?? 1), 0)
          const doneCount = items.filter(({ a, g }) =>
            isPackedFor(p.id, g.id, a.quantity ?? 1),
          ).length
          return (
            <div key={p.id}>
              <div className="flex items-baseline gap-2 border-b border-gray-200 pb-0.5 text-sm">
                <span className="font-medium text-gray-800">{p.name}</span>
                <span className="text-xs text-gray-500 tabular-nums">
                  {doneCount}/{items.length} packed · {fmtGrams(total)}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-sm">
                {items.map(({ a, g }) => {
                  const qty = a.quantity ?? 1
                  const isPacked = isPackedFor(p.id, g.id, qty)
                  return (
                    <li key={g.id}>
                      <label className="flex cursor-pointer items-baseline gap-2">
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={isPacked}
                          onChange={() => togglePack(p.id, g.id, qty)}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate ${isPacked ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                        >
                          {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                          {g.name}
                          {qty > 1 && <span className="text-gray-500"> ×{qty}</span>}
                        </span>
                        <span
                          className={`w-16 shrink-0 text-right tabular-nums ${isPacked ? 'text-gray-400 line-through' : 'font-medium text-emerald-800'}`}
                        >
                          {fmtGrams(g.weightG * qty)}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
