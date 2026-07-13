import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { gearWeightSplit, personGearTotals, gearTotalG } from '../domain/gear'
import type { GearAssignment, GearItem, Person, Trip } from '../domain/types'
import { fmtGrams } from './format'
import { GearPickerModal } from './GearPickerModal'

// Compact gear summary for the Carries tab: what's on the trip and (for groups)
// who carries how much, with a button to open the searchable picker. The full
// add/remove/assign flow lives in the modal so this stays a one-glance summary.
export function GearSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )
  const [open, setOpen] = useState(false)

  const gearById = new Map(gear.map((g) => [g.id, g]))
  const onTripIds = new Set(assignments.map((a) => a.gearItemId))
  const onTrip = [...onTripIds].map((id) => gearById.get(id)).filter((g): g is GearItem => !!g)
  const totalG = onTrip.reduce((n, g) => n + g.weightG, 0)
  const baseG = onTrip.reduce((n, g) => n + gearWeightSplit(g).baseG, 0)
  const multi = people.length > 1

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold text-gray-800">Gear</h3>
        <span className="text-sm text-gray-600 tabular-nums">
          {onTrip.length === 0
            ? 'none added yet'
            : `${onTrip.length} items · ${fmtGrams(totalG)} (base ${fmtGrams(baseG)})`}
        </span>
        <button
          className="ml-auto rounded border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
          onClick={() => setOpen(true)}
        >
          Manage gear
        </button>
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

      {open && <GearPickerModal trip={trip} people={people} onClose={() => setOpen(false)} />}
    </section>
  )
}
