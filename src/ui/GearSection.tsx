import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import {
  removeGearFromTrip,
  setGearQuantity,
  setGearWornQuantity,
  toggleGearAssignment,
} from '../store/repos'
import { categoryLabel, gearTotalG, isBigThree, ownerPersonIds, personGearTotals } from '../domain/gear'
import type { GearAssignment, GearCollection, GearItem, Person, Trip } from '../domain/types'
import { fmtGrams } from './format'
import { GearLibraryPanel } from './GearLibraryPanel'

// Inline gear manager for the trip's Gear tab: the gear on this trip is always
// visible (grouped by category, with carrier/qty/worn controls); add more from
// a fly-in library panel or by applying a collection.
export function GearSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const [browsing, setBrowsing] = useState(false)
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )
  const collections = useLiveQuery(() => db.gearCollections.toArray(), [], [] as GearCollection[])

  const gearById = new Map(gear.map((g) => [g.id, g]))
  const assigned = new Set(assignments.map((a) => `${a.personId}|${a.gearItemId}`))
  const qtyByKey = new Map(assignments.map((a) => [`${a.personId}|${a.gearItemId}`, a.quantity ?? 1]))
  const wornByKey = new Map(
    assignments.map((a) => [`${a.personId}|${a.gearItemId}`, a.wornQuantity ?? a.quantity ?? 1]),
  )
  const onTripIds = new Set(assignments.map((a) => a.gearItemId))
  const defaultCarrier = people[0]?.id
  const multi = people.length > 1

  const byCatName = (a: GearItem, b: GearItem) =>
    Number(isBigThree(b.category)) - Number(isBigThree(a.category)) ||
    categoryLabel(a.category).localeCompare(categoryLabel(b.category)) ||
    a.name.localeCompare(b.name)
  const onTrip = [...onTripIds]
    .map((id) => gearById.get(id))
    .filter((g): g is GearItem => !!g)
    .sort(byCatName)

  function addToTrip(g: GearItem) {
    if (onTripIds.has(g.id)) return
    const carriers = ownerPersonIds(g.owners, people)
    const targets = carriers.length ? carriers : defaultCarrier ? [defaultCarrier] : []
    for (const pid of targets) void toggleGearAssignment(trip.id, pid, g.id)
  }
  function applyCollection(id: string) {
    const c = collections.find((x) => x.id === id)
    if (!c) return
    for (const gid of c.gearItemIds) {
      const g = gearById.get(gid)
      if (g) addToTrip(g)
    }
  }

  // Group the on-trip gear by category for display.
  const grouped = new Map<string, GearItem[]>()
  for (const g of onTrip) {
    const list = grouped.get(g.category) ?? []
    list.push(g)
    grouped.set(g.category, list)
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Gear — what you’re taking</h3>

      {gear.length === 0 ? (
        <p className="text-sm text-gray-500">
          Add gear on the <span className="font-medium">Gear</span> tab first, then add it here.
        </p>
      ) : people.length === 0 ? (
        <p className="text-sm text-gray-500">Add people in the Setup view first.</p>
      ) : (
        <>
          {multi && onTrip.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {people.map((p) => {
                const t = personGearTotals(assignments, gearById, p.id)
                return (
                  <span key={p.id} className="tabular-nums">
                    {p.name}: {fmtGrams(gearTotalG(t))}
                  </span>
                )
              })}
            </div>
          )}

          {onTrip.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing added yet — use “Add gear from library” below.
            </p>
          ) : (
            <div className="space-y-2">
              {[...grouped.keys()].map((cat) => (
                <div key={cat}>
                  <h4 className="mb-0.5 text-xs font-medium tracking-wide text-gray-500 uppercase">
                    {categoryLabel(cat)}
                  </h4>
                  <ul className="space-y-1">
                    {grouped.get(cat)!.map((g) => {
                      const wearable = (g.wornWeightG ?? 0) > 0
                      const carriers = people.filter((p) => assigned.has(`${p.id}|${g.id}`))
                      return (
                        <li key={g.id} className="text-sm">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 flex-1 truncate text-gray-800">
                              {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                              {g.name}
                              {g.owners?.length ? (
                                <span className="ml-1 rounded bg-violet-100 px-1 text-xs text-violet-800">
                                  {g.owners.join(', ')}
                                </span>
                              ) : null}
                              {g.shared && (
                                <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">
                                  shared
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums text-gray-400">{fmtGrams(g.weightG)}</span>
                            {!multi && defaultCarrier && (
                              <QtyWorn
                                trip={trip}
                                personId={defaultCarrier}
                                g={g}
                                qty={qtyByKey.get(`${defaultCarrier}|${g.id}`) ?? 1}
                                worn={wornByKey.get(`${defaultCarrier}|${g.id}`) ?? 1}
                                wearable={wearable}
                              />
                            )}
                            <button
                              className="text-red-700"
                              title="remove from trip"
                              onClick={() => void removeGearFromTrip(trip.id, g.id)}
                            >
                              ✕
                            </button>
                          </div>
                          {multi && (
                            <div className="mt-0.5 ml-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                              carried by:
                              {people.map((p) => {
                                const on = assigned.has(`${p.id}|${g.id}`)
                                return (
                                  <span key={p.id} className="flex items-center gap-1">
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() =>
                                          void toggleGearAssignment(trip.id, p.id, g.id)
                                        }
                                      />
                                      {p.name}
                                    </label>
                                    {on && (
                                      <QtyWorn
                                        trip={trip}
                                        personId={p.id}
                                        g={g}
                                        qty={qtyByKey.get(`${p.id}|${g.id}`) ?? 1}
                                        worn={wornByKey.get(`${p.id}|${g.id}`) ?? 1}
                                        wearable={wearable}
                                      />
                                    )}
                                  </span>
                                )
                              })}
                              {carriers.length === 0 && (
                                <span className="text-gray-400">nobody yet</span>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
              onClick={() => setBrowsing(true)}
            >
              ➕ Add gear from library
            </button>
            {collections.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                or a collection:
                <select
                  className="rounded border border-gray-300 px-1 py-1 text-sm"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) applyCollection(e.target.value)
                  }}
                >
                  <option value="">— pick a kit —</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.gearItemIds.length})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </>
      )}

      {browsing && (
        <GearLibraryPanel
          title={`Add gear — ${trip.name}`}
          subtitle="Check items to add them to this trip"
          onClose={() => setBrowsing(false)}
          isSelected={(g) => onTripIds.has(g.id)}
          onToggle={(g) =>
            onTripIds.has(g.id) ? void removeGearFromTrip(trip.id, g.id) : addToTrip(g)
          }
        />
      )}
    </section>
  )
}

// Compact quantity (and worn, for wearable items) steppers for one assignment.
function QtyWorn({
  trip,
  personId,
  g,
  qty,
  worn,
  wearable,
}: {
  trip: Trip
  personId: string
  g: GearItem
  qty: number
  worn: number
  wearable: boolean
}) {
  return (
    <>
      <span className="flex items-center gap-1 text-xs text-gray-500">
        ×
        <input
          type="number"
          min={1}
          className="w-12 rounded border border-gray-300 px-1 py-0.5"
          value={qty}
          onChange={(e) =>
            void setGearQuantity(trip.id, personId, g.id, Number(e.target.value) || 1)
          }
        />
      </span>
      {wearable && (
        <span
          className="flex items-center gap-1 text-xs text-gray-500"
          title="How many are worn on the body (the rest are packed = base weight)"
        >
          worn
          <input
            type="number"
            min={0}
            max={qty}
            className="w-12 rounded border border-gray-300 px-1 py-0.5"
            value={worn}
            onChange={(e) =>
              void setGearWornQuantity(trip.id, personId, g.id, Number(e.target.value) || 0)
            }
          />
        </span>
      )}
    </>
  )
}
