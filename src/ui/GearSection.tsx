import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import {
  flattenGearCarries,
  removeGearFromTrip,
  setGearCarries,
  setGearCarryQuantities,
  setGearQuantity,
  setGearWornQuantity,
  toggleGearAssignment,
} from '../store/repos'
import {
  addGearTotals,
  assignmentGearTotals,
  assignmentQuantityOnCarry,
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
import { OwnerPills } from './OwnerPills'
import { GearLibraryPanel } from './GearLibraryPanel'

interface CarryOption {
  key: string
  /** "Carry 2" — short chip label. */
  short: string
  /** "Carry 2 (Vizzavona → Corte)" — full title for the chip tooltip. */
  full: string
}

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

// Inline gear manager for the trip's Gear tab. Each item is a card: a header
// with its name and total weight, then one control line per person carrying it
// (quantity, whether it's worn, and which carries it rides). Add more from a
// fly-in library panel or by applying a collection.
export function GearSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const [browsing, setBrowsing] = useState(false)
  // When the library panel closes after adding exactly one item, scroll the
  // on-trip list to it (and briefly highlight it) so it's easy to find.
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
  const onTripBeforeAdd = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!scrollTargetId) return
    document
      .getElementById(`trip-gear-${scrollTargetId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setScrollTargetId(null), 1600)
    return () => clearTimeout(t)
  }, [scrollTargetId])
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

  // The carries this trip splits into — the options for pinning gear to a leg.
  const carries = deriveCarries(trip, resupplies)
  const carryEnds = carryEndpoints(carries, resupplies)
  const carryOptions: CarryOption[] = carries.map((c, i) => {
    const e = carryEnds[i]
    const where = e.from || e.to ? ` (${e.from ?? 'start'} → ${e.to ?? 'finish'})` : ''
    return { key: carryKey(c), short: `Carry ${c.index}`, full: `Carry ${c.index}${where}` }
  })
  const perCarry = carryOptions.length > 1

  const gearById = new Map(gear.map((g) => [g.id, g]))
  const assignmentByKey = new Map(assignments.map((a) => [`${a.personId}|${a.gearItemId}`, a]))
  const onTripIds = new Set(assignments.map((a) => a.gearItemId))

  // Total base/worn/consumable an item contributes across everyone carrying it —
  // the header weight reflects quantity (and worn/consumable), not unit weight.
  // With per-carry amounts it shows the heaviest leg (like the pack headline).
  const itemTotals = (g: GearItem): GearTotals => {
    let t = ZERO_GEAR_TOTALS
    for (const a of assignments) {
      if (a.gearItemId !== g.id) continue
      const qty = a.carryQuantities
        ? Math.max(0, ...Object.values(a.carryQuantities).map((v) => Math.round(v)))
        : a.quantity
      if (a.carryQuantities && (qty ?? 0) <= 0) continue
      t = addGearTotals(t, assignmentGearTotals(g, qty, a.wornQuantity))
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
  function openLibrary() {
    onTripBeforeAdd.current = new Set(onTripIds)
    setBrowsing(true)
  }
  function closeLibrary() {
    const added = [...onTripIds].filter((id) => !onTripBeforeAdd.current.has(id))
    setBrowsing(false)
    if (added.length === 1) setScrollTargetId(added[0])
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
          {/* Add controls up top, so they're the first thing you reach. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
              onClick={openLibrary}
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
              Nothing added yet — use “Add gear from library” above.
            </p>
          ) : (
            <div className="space-y-3">
              {[...grouped.keys()].map((cat) => (
                <div key={cat}>
                  <h4 className="mb-1 text-xs font-medium tracking-wide text-gray-500 uppercase">
                    {categoryLabel(cat)}
                  </h4>
                  <ul className="space-y-1.5">
                    {grouped.get(cat)!.map((g) => {
                      const totals = itemTotals(g)
                      const split = splitLabel(totals)
                      const carriers = people.filter((p) => assignmentByKey.has(`${p.id}|${g.id}`))
                      return (
                        <li
                          key={g.id}
                          id={`trip-gear-${g.id}`}
                          className={`rounded-md border px-2.5 py-2 transition-colors ${
                            scrollTargetId === g.id
                              ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300'
                              : 'border-gray-100 bg-gray-50/40'
                          }`}
                        >
                          {/* Header: name + badges on the left, weight on the right. */}
                          <div className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                              {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                              {g.name}
                              <OwnerPills owners={g.owners} />
                              {g.shared && (
                                <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">
                                  shared
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-right leading-tight">
                              <span className="text-sm tabular-nums text-gray-700">
                                {fmtGrams(gearTotalG(totals))}
                              </span>
                              {split && <span className="block text-xs text-gray-400">{split}</span>}
                            </span>
                            <button
                              className="shrink-0 text-gray-400 hover:text-red-700"
                              title="Remove from trip"
                              onClick={() => void removeGearFromTrip(trip.id, g.id)}
                            >
                              ✕
                            </button>
                          </div>

                          {/* Who carries it — toggle chips (multi-person trips). */}
                          {multi && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="text-xs text-gray-400">carried by</span>
                              {people.map((p) => {
                                const on = assignmentByKey.has(`${p.id}|${g.id}`)
                                return (
                                  <button
                                    key={p.id}
                                    onClick={() => void toggleGearAssignment(trip.id, p.id, g.id)}
                                    className={`rounded-full border px-2 py-0.5 text-xs ${
                                      on
                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                        : 'border-gray-300 text-gray-500 hover:border-gray-400'
                                    }`}
                                  >
                                    {p.name}
                                  </button>
                                )
                              })}
                            </div>
                          )}

                          {/* One control line per carrier: quantity, worn, carries. */}
                          <div className="mt-1.5 space-y-1.5">
                            {carriers.map((p) => (
                              <CarrierControls
                                key={p.id}
                                trip={trip}
                                g={g}
                                a={assignmentByKey.get(`${p.id}|${g.id}`)!}
                                personName={multi ? p.name : undefined}
                                carryOptions={perCarry ? carryOptions : []}
                              />
                            ))}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {browsing && (
        <GearLibraryPanel
          title={`Add gear — ${trip.name}`}
          subtitle="Check items to add them to this trip"
          onClose={closeLibrary}
          isSelected={(g) => onTripIds.has(g.id)}
          onToggle={(g) =>
            onTripIds.has(g.id) ? void removeGearFromTrip(trip.id, g.id) : addToTrip(g)
          }
        />
      )}
    </section>
  )
}

// One person's controls for one item: quantity, how many are worn, and (when the
// trip has more than one carry) which carries it rides. Everything on this line
// belongs to this one person, so there's no ambiguity about what a control means.
// "vary by carry" swaps the single quantity for a per-carry amount (2 socks on
// one leg, 3 on another); it's opt-in so the common case stays a single line.
function CarrierControls({
  trip,
  g,
  a,
  personName,
  carryOptions,
}: {
  trip: Trip
  g: GearItem
  a: GearAssignment
  /** Set on multi-person trips to label whose line this is. */
  personName?: string
  /** Empty when the trip has a single carry (then carry controls are hidden). */
  carryOptions: CarryOption[]
}) {
  const varying = a.carryQuantities !== undefined
  const active = new Set(a.carryKeys ?? [])
  const everyCarry = active.size === 0
  // Largest amount on any leg — the ceiling for the (single) worn count.
  const maxQty = Math.max(1, a.quantity ?? 1, ...Object.values(a.carryQuantities ?? {}))
  const qty = a.quantity ?? 1
  const worn = a.wornQuantity ?? defaultWornQuantity(g, varying ? maxQty : qty)

  function toggleCarry(key: string) {
    const next = new Set(active)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    void setGearCarries(trip.id, a.personId, g.id, [...next])
  }
  function startVary() {
    const seed: Record<string, number> = {}
    for (const o of carryOptions) seed[o.key] = assignmentQuantityOnCarry(a, o.key)
    void setGearCarryQuantities(trip.id, a.personId, g.id, seed)
  }
  function stopVary() {
    const map = a.carryQuantities ?? {}
    const kept = carryOptions.filter((o) => Math.round(map[o.key] ?? 0) > 0)
    const flatQty = Math.max(1, ...carryOptions.map((o) => Math.round(map[o.key] ?? 0)))
    const every = kept.length === carryOptions.length
    void flattenGearCarries(trip.id, a.personId, g.id, flatQty, every ? [] : kept.map((o) => o.key))
  }
  function setCarryQty(key: string, val: number) {
    const map = { ...(a.carryQuantities ?? {}) }
    map[key] = Math.max(0, Math.round(val))
    void setGearCarryQuantities(trip.id, a.personId, g.id, map)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
      {personName && (
        <span className="w-16 shrink-0 truncate font-medium text-gray-700">{personName}</span>
      )}

      {!varying && (
        <span className="flex items-center gap-1" title="How many this person carries">
          <span className="text-gray-400">×</span>
          <input
            type="number"
            min={1}
            className="w-12 rounded border border-gray-300 px-1 py-0.5"
            value={qty}
            onChange={(e) =>
              void setGearQuantity(trip.id, a.personId, g.id, Number(e.target.value) || 1)
            }
          />
        </span>
      )}

      {!varying && qty === 1 ? (
        <label
          className="flex items-center gap-1"
          title="Worn on the body (kept out of the pack) rather than packed"
        >
          <input
            type="checkbox"
            checked={worn >= 1}
            onChange={(e) =>
              void setGearWornQuantity(trip.id, a.personId, g.id, e.target.checked ? 1 : 0)
            }
          />
          worn
        </label>
      ) : (
        <span
          className="flex items-center gap-1"
          title="How many are worn on the body (the rest are packed = base weight)"
        >
          <span className="text-gray-400">worn</span>
          <input
            type="number"
            min={0}
            max={maxQty}
            className="w-12 rounded border border-gray-300 px-1 py-0.5"
            value={worn}
            onChange={(e) =>
              void setGearWornQuantity(trip.id, a.personId, g.id, Number(e.target.value) || 0)
            }
          />
        </span>
      )}

      {carryOptions.length > 1 && !varying && (
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-gray-400">carries</span>
          <button
            onClick={() => void setGearCarries(trip.id, a.personId, g.id, [])}
            title="Rides every carry"
            className={`rounded-full border px-2 py-0.5 ${
              everyCarry
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-gray-300 text-gray-500 hover:border-gray-400'
            }`}
          >
            Every
          </button>
          {carryOptions.map((o) => {
            const on = active.has(o.key)
            return (
              <button
                key={o.key}
                onClick={() => toggleCarry(o.key)}
                title={o.full}
                className={`rounded-full border px-2 py-0.5 ${
                  on
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-gray-300 text-gray-500 hover:border-gray-400'
                }`}
              >
                {o.short.replace('Carry ', '')}
              </button>
            )
          })}
          <button
            onClick={startVary}
            title="Carry a different amount on different carries"
            className="text-gray-400 underline hover:text-gray-600"
          >
            vary by carry
          </button>
        </span>
      )}

      {carryOptions.length > 1 && varying && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-gray-400">amount per carry</span>
          {carryOptions.map((o) => (
            <span key={o.key} className="flex items-center gap-1" title={o.full}>
              <span className="text-gray-400">{o.short.replace('Carry ', 'C')}</span>
              <input
                type="number"
                min={0}
                className="w-11 rounded border border-gray-300 px-1 py-0.5"
                value={Math.round(a.carryQuantities?.[o.key] ?? 0)}
                onChange={(e) => setCarryQty(o.key, Number(e.target.value) || 0)}
              />
            </span>
          ))}
          <button
            onClick={stopVary}
            title="Use one amount on every carry"
            className="text-gray-400 underline hover:text-gray-600"
          >
            same for all
          </button>
        </span>
      )}
    </div>
  )
}
