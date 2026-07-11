import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { removeGearFromTrip, toggleGearAssignment } from '../store/repos'
import { categoryLabel, gearTotalG, personGearTotals } from '../domain/gear'
import type { GearAssignment, GearItem, Person, Trip } from '../domain/types'
import { fmtGrams } from './format'

// Gear selection for a trip (Carries tab). You add gear from your library to
// this trip (pick the one tent you're taking — the others never appear), then
// choose who carries each. Weight rolls up per person. Only gear you've added
// counts toward the pack breakdown.
export function GearSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )
  const gearById = new Map(gear.map((g) => [g.id, g]))
  const assigned = new Set(assignments.map((a) => `${a.personId}|${a.gearItemId}`))
  const onTripIds = new Set(assignments.map((a) => a.gearItemId))

  const byCatName = (a: GearItem, b: GearItem) =>
    a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  const onTrip = [...onTripIds]
    .map((id) => gearById.get(id))
    .filter((g): g is GearItem => !!g)
    .sort(byCatName)
  const offTrip = gear.filter((g) => !onTripIds.has(g.id)).sort(byCatName)

  const defaultCarrier = people[0]?.id
  const multi = people.length > 1

  function addGear(gearItemId: string) {
    if (gearItemId && defaultCarrier) void toggleGearAssignment(trip.id, defaultCarrier, gearItemId)
  }

  // Options for the "add" picker, grouped by category.
  const offByCategory = new Map<string, GearItem[]>()
  for (const g of offTrip) {
    const list = offByCategory.get(g.category) ?? []
    list.push(g)
    offByCategory.set(g.category, list)
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Gear — what you’re taking</h3>

      {gear.length === 0 ? (
        <p className="text-sm text-gray-500">
          Add gear on the <span className="font-medium">Gear</span> tab first, then add it to this
          trip here.
        </p>
      ) : people.length === 0 ? (
        <p className="text-sm text-gray-500">Add people in the Setup view first.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            {people.map((p) => {
              const t = personGearTotals(assignments, gearById, p.id)
              return (
                <div key={p.id} className="rounded border border-gray-200 px-3 py-2">
                  <div className="font-medium text-gray-800">{p.name}</div>
                  <div className="text-gray-600 tabular-nums">
                    {fmtGrams(gearTotalG(t))} gear · base {fmtGrams(t.baseG)}
                    {t.wornG ? ` · worn ${fmtGrams(t.wornG)}` : ''}
                    {t.consumableG ? ` · consum. ${fmtGrams(t.consumableG)}` : ''}
                  </div>
                </div>
              )
            })}
          </div>

          {onTrip.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing added yet — add gear for this trip below.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-600">
                    <th className="py-1 pr-2">Item</th>
                    <th className="py-1 pr-2">Category</th>
                    <th className="py-1 pr-2 text-right">Weight</th>
                    {multi && people.map((p) => (
                      <th key={p.id} className="px-2 py-1 text-center">
                        {p.name}
                      </th>
                    ))}
                    <th className="py-1 pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {onTrip.map((g) => (
                    <tr key={g.id} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2">
                        {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                        {g.name}
                        {g.shared && (
                          <span className="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">
                            shared
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-gray-600">{categoryLabel(g.category)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(g.weightG)}</td>
                      {multi && people.map((p) => (
                        <td key={p.id} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${p.name} carries ${g.name}`}
                            checked={assigned.has(`${p.id}|${g.id}`)}
                            onChange={() => void toggleGearAssignment(trip.id, p.id, g.id)}
                          />
                        </td>
                      ))}
                      <td className="py-1.5 pr-2 text-right">
                        <button
                          className="text-red-700 underline"
                          onClick={() => void removeGearFromTrip(trip.id, g.id)}
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {offTrip.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              Add gear to this trip:
              <select
                className="rounded border border-gray-300 px-2 py-1"
                value=""
                onChange={(e) => addGear(e.target.value)}
              >
                <option value="">— pick gear —</option>
                {[...offByCategory.keys()]
                  .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)))
                  .map((cat) => (
                    <optgroup key={cat} label={categoryLabel(cat)}>
                      {offByCategory.get(cat)!.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({fmtGrams(g.weightG)})
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
              {multi && <span className="text-xs text-gray-400">added to {people[0].name}; set carriers above</span>}
            </label>
          )}
        </>
      )}
    </section>
  )
}
