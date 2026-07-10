import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { toggleGearAssignment } from '../store/repos'
import { categoryLabel, gearTotalG, personGearTotals } from '../domain/gear'
import type { GearAssignment, GearItem, Person, Trip } from '../domain/types'
import { fmtGrams } from './format'

// Gear-assignment editor for a trip's Carries tab (G2): pick which gear is
// carried and by whom, with per-person gear weight roll-ups. The combined
// food + gear pack-weight breakdown lands in G2b.
export function GearSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )
  const gearById = new Map(gear.map((g) => [g.id, g]))
  const assigned = new Set(assignments.map((a) => `${a.personId}|${a.gearItemId}`))
  const sorted = [...gear].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  )

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Gear — who carries what</h3>

      {gear.length === 0 ? (
        <p className="text-sm text-gray-500">
          Add gear on the <span className="font-medium">Gear</span> tab, then check off who carries
          each item here. Weight (base / worn / consumable) rolls up per person.
        </p>
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

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-left text-gray-600">
                  <th className="py-1 pr-2">Item</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2 text-right">Weight</th>
                  {people.map((p) => (
                    <th key={p.id} className="px-2 py-1 text-center">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((g) => (
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
                    {people.map((p) => (
                      <td key={p.id} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${p.name} carries ${g.name}`}
                          checked={assigned.has(`${p.id}|${g.id}`)}
                          onChange={() => void toggleGearAssignment(trip.id, p.id, g.id)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Shared gear (tent, pot): check one carrier. Personal gear (clothing): check it for each
            person who packs their own. The combined food + gear pack-weight breakdown lands next.
          </p>
        </>
      )}
    </section>
  )
}
