import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import {
  removeGearFromTrip,
  setGearCarryScope,
  setGearQuantity,
  setGearWornQuantity,
  toggleGearAssignment,
} from '../store/repos'
import {
  addGearTotals,
  assignmentGearTotals,
  categoryLabel,
  defaultWornQuantity,
  gearTotalG,
  isBigThree,
  ownerPersonIds,
  personGearTotals,
  ZERO_GEAR_TOTALS,
} from '../domain/gear'
import type { GearTotals } from '../domain/gear'
import { carryEndpoints, carryKey, deriveCarries } from '../domain/carries'
import type {
  GearAssignment,
  GearCollection,
  GearItem,
  Person,
  Resupply,
  Trip,
} from '../domain/types'
import { fmtGrams } from './format'
import { GearLibraryPanel } from './GearLibraryPanel'

// The packed/worn/consumable split under a row's total — shown only when it's
// more than plain packed base weight (i.e. something is worn or depletes), so
// ordinary gear stays uncluttered.
function splitLabel(t: GearTotals): string | null {
  if (t.wornG === 0 && t.consumableG === 0) return null
  const parts: string[] = []
  if (t.baseG > 0) parts.push(`${fmtGrams(t.baseG)} packed`)
  if (t.wornG > 0) parts.push(`${fmtGrams(t.wornG)} worn`)
  if (t.consumableG > 0) parts.push(`${fmtGrams(t.consumableG)} consumable`)
  return parts.join(' · ')
}

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
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as Resupply[],
  )

  // Carries this trip splits into, for pinning gear to one leg. Labelled by
  // number and (when known) endpoints, e.g. "Carry 2 (Vizzavona → finish)".
  const carries = deriveCarries(trip, resupplies)
  const carryEnds = carryEndpoints(carries, resupplies)
  const carryOptions = carries.map((c, i) => {
    const e = carryEnds[i]
    const where = e.from || e.to ? ` (${e.from ?? 'start'} → ${e.to ?? 'finish'})` : ''
    return { key: carryKey(c), label: `Carry ${c.index}${where}` }
  })
  const carryKeySet = new Set(carryOptions.map((o) => o.key))

  const gearById = new Map(gear.map((g) => [g.id, g]))
  const assigned = new Set(assignments.map((a) => `${a.personId}|${a.gearItemId}`))
  // An item's carry scope (shared across its carriers): the first assignment's.
  const carryByItem = new Map<string, string | undefined>()
  for (const a of assignments) {
    if (!carryByItem.has(a.gearItemId)) carryByItem.set(a.gearItemId, a.carryKey)
  }
  const qtyByKey = new Map(assignments.map((a) => [`${a.personId}|${a.gearItemId}`, a.quantity ?? 1]))
  // Raw worn count per assignment (undefined = "use the item's default"), so the
  // effective worn value is resolved per row with defaultWornQuantity().
  const wornRawByKey = new Map(
    assignments.map((a) => [`${a.personId}|${a.gearItemId}`, a.wornQuantity]),
  )
  const onTripIds = new Set(assignments.map((a) => a.gearItemId))

  // Total base/worn/consumable an item contributes across everyone carrying it —
  // the row headline reflects quantity (and worn/consumable), not the unit weight.
  const itemTotals = (g: GearItem): GearTotals => {
    let t = ZERO_GEAR_TOTALS
    for (const a of assignments) {
      if (a.gearItemId !== g.id) continue
      t = addGearTotals(t, assignmentGearTotals(g, a.quantity, a.wornQuantity))
    }
    return t
  }
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
  // Pin an item to one carry (or clear to every carry) for all its carriers.
  function setItemCarry(g: GearItem, key: string) {
    for (const p of people) {
      if (assigned.has(`${p.id}|${g.id}`)) void setGearCarryScope(trip.id, p.id, g.id, key || undefined)
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
                      const carriers = people.filter((p) => assigned.has(`${p.id}|${g.id}`))
                      const totals = itemTotals(g)
                      const split = splitLabel(totals)
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
                            <span className="flex flex-col items-end leading-tight">
                              <span className="tabular-nums text-gray-700">
                                {fmtGrams(gearTotalG(totals))}
                              </span>
                              {split && <span className="text-xs text-gray-400">{split}</span>}
                            </span>
                            {carryOptions.length > 1 &&
                              (() => {
                                const scope = carryByItem.get(g.id)
                                const stale = scope !== undefined && !carryKeySet.has(scope)
                                return (
                                  <select
                                    className="rounded border border-gray-300 px-1 py-0.5 text-xs text-gray-600"
                                    title="Which carry this item rides (default: every carry)"
                                    value={scope ?? ''}
                                    onChange={(e) => setItemCarry(g, e.target.value)}
                                  >
                                    <option value="">Every carry</option>
                                    {stale && <option value={scope}>Carry (removed)</option>}
                                    {carryOptions.map((o) => (
                                      <option key={o.key} value={o.key}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                )
                              })()}
                            {!multi &&
                              defaultCarrier &&
                              (() => {
                                const key = `${defaultCarrier}|${g.id}`
                                const qty = qtyByKey.get(key) ?? 1
                                return (
                                  <QtyWorn
                                    trip={trip}
                                    personId={defaultCarrier}
                                    g={g}
                                    qty={qty}
                                    worn={wornRawByKey.get(key) ?? defaultWornQuantity(g, qty)}
                                  />
                                )
                              })()}
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
                                    {on &&
                                      (() => {
                                        const key = `${p.id}|${g.id}`
                                        const qty = qtyByKey.get(key) ?? 1
                                        return (
                                          <QtyWorn
                                            trip={trip}
                                            personId={p.id}
                                            g={g}
                                            qty={qty}
                                            worn={wornRawByKey.get(key) ?? defaultWornQuantity(g, qty)}
                                          />
                                        )
                                      })()}
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

// Compact quantity + worn steppers for one assignment. Worn is a per-trip,
// whole-unit choice available on any item: a single unit shows a checkbox, more
// than one a count (how many are worn; the rest ride in the pack as base weight).
function QtyWorn({
  trip,
  personId,
  g,
  qty,
  worn,
}: {
  trip: Trip
  personId: string
  g: GearItem
  qty: number
  worn: number
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
      {qty === 1 ? (
        <label
          className="flex items-center gap-1 text-xs text-gray-500"
          title="Worn on the body (kept out of the pack) rather than packed"
        >
          <input
            type="checkbox"
            checked={worn >= 1}
            onChange={(e) => void setGearWornQuantity(trip.id, personId, g.id, e.target.checked ? 1 : 0)}
          />
          worn
        </label>
      ) : (
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
