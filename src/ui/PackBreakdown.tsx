import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { deriveCarries } from '../domain/carries'
import { carryTotals, planKey } from '../domain/totals'
import {
  carryPackWeightG,
  categoryLabel,
  gearWeightSplit,
  isBigThree,
  personGearTotals,
} from '../domain/gear'
import type {
  GearAssignment,
  GearItem,
  Item,
  Meal,
  Person,
  PlanEntry,
  Resupply,
  Trip,
} from '../domain/types'
import { fmtGrams } from './format'

// Unified food + gear pack-weight breakdown (Gear epic G2b): what each person
// actually carries. Gear rides every carry (constant); food is consumed, so it
// varies per carry — pack weight for a carry = gear base + gear consumable +
// that carry's food. Worn weight is on the body, shown separately.
export function PackBreakdown({ trip, people }: { trip: Trip; people: Person[] }) {
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const meals = useLiveQuery(() => db.meals.toArray(), [], [] as Meal[])
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as Resupply[],
  )
  const planEntries = useLiveQuery(
    () => db.planEntries.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as PlanEntry[],
  )
  const assignments = useLiveQuery(
    () => db.gearAssignments.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as GearAssignment[],
  )

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const mealsById = new Map(meals.map((m) => [m.id, m]))
  const gearById = new Map(gear.map((g) => [g.id, g]))
  const entriesByKey = new Map(planEntries.map((e) => [planKey(e.personId, e.dayIndex, e.slotKey), e]))
  const personIds = people.map((p) => p.id)

  const carries = deriveCarries(trip, resupplies)
  const perCarry = carries.map((carry) =>
    carryTotals({ carry, personIds, entriesByKey, mealsById, itemsById }),
  )

  // Per-person derived numbers.
  const rows = people.map((p) => {
    const gearT = personGearTotals(assignments, gearById, p.id)
    const foodByCarry = perCarry.map((c) => c.perPerson.get(p.id)?.weightG ?? 0)
    const packByCarry = foodByCarry.map((foodG) => carryPackWeightG(gearT, foodG))
    return { person: p, gearT, packByCarry, heaviest: packByCarry.length ? Math.max(...packByCarry) : gearT.baseG + gearT.consumableG }
  })

  const nothing =
    gear.length === 0 && assignments.length === 0 && planEntries.length === 0
  if (nothing) return null

  const showGroup = people.length > 1
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0)
  const groupCarry = carries.map((_, i) => rows.reduce((n, r) => n + r.packByCarry[i], 0))

  // Group base weight by gear category (the LighterPack-style breakdown).
  const byCategory = new Map<string, number>()
  for (const a of assignments) {
    const item = gearById.get(a.gearItemId)
    if (!item) continue
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + gearWeightSplit(item).baseG)
  }
  const categoryRows = [...byCategory.entries()].sort(
    (a, b) => Number(isBigThree(b[0])) - Number(isBigThree(a[0])) || b[1] - a[1],
  )
  const bigThreeBase = categoryRows
    .filter(([c]) => isBigThree(c))
    .reduce((n, [, g]) => n + g, 0)
  const totalBase = categoryRows.reduce((n, [, g]) => n + g, 0)

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Pack weight — food + gear</h3>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2" />
              {people.map((p) => (
                <th key={p.id} className="py-1 pr-2 text-right">
                  {p.name}
                </th>
              ))}
              {showGroup && <th className="py-1 pr-2 text-right">Group</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-1.5 pr-2 text-gray-600" title="In-pack gear that doesn't deplete">
                Base weight
              </td>
              {rows.map((r) => (
                <td key={r.person.id} className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtGrams(r.gearT.baseG)}
                </td>
              ))}
              {showGroup && (
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtGrams(sum((r) => r.gearT.baseG))}
                </td>
              )}
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-1.5 pr-2 text-gray-600" title="Worn on the body, not in the pack">
                Worn
              </td>
              {rows.map((r) => (
                <td key={r.person.id} className="py-1.5 pr-2 text-right tabular-nums text-gray-500">
                  {r.gearT.wornG ? fmtGrams(r.gearT.wornG) : '—'}
                </td>
              ))}
              {showGroup && (
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-500">
                  {sum((r) => r.gearT.wornG) ? fmtGrams(sum((r) => r.gearT.wornG)) : '—'}
                </td>
              )}
            </tr>
            {carries.map((carry, i) => (
              <tr key={carry.index} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 text-gray-600">Carry {carry.index} pack</td>
                {rows.map((r) => (
                  <td key={r.person.id} className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtGrams(r.packByCarry[i])}
                  </td>
                ))}
                {showGroup && (
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(groupCarry[i])}</td>
                )}
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-1.5 pr-2" title="The heaviest a pack gets — what to size for">
                Heaviest carry
              </td>
              {rows.map((r) => (
                <td key={r.person.id} className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtGrams(r.heaviest)}
                </td>
              ))}
              {showGroup && (
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtGrams(groupCarry.length ? Math.max(...groupCarry) : 0)}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {categoryRows.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium text-gray-700">
            Base weight by category (whole group)
          </h4>
          <table className="w-full max-w-sm border-collapse text-sm">
            <tbody>
              {categoryRows.map(([category, g]) => (
                <tr key={category} className="border-b border-gray-100">
                  <td className="py-1 pr-2 text-gray-600">
                    {categoryLabel(category)}
                    {isBigThree(category) && (
                      <span className="ml-1 rounded bg-emerald-50 px-1 text-xs text-emerald-800">
                        big 3
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtGrams(g)}</td>
                </tr>
              ))}
              <tr className="text-gray-600">
                <td className="py-1 pr-2">Big 3 subtotal</td>
                <td className="py-1 pr-2 text-right tabular-nums">{fmtGrams(bigThreeBase)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-1 pr-2">Total base</td>
                <td className="py-1 pr-2 text-right tabular-nums">{fmtGrams(totalBase)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Pack weight = gear base + gear consumables (fuel) + that carry’s food. Food packaging will
        add to base weight in a later update.
      </p>
    </section>
  )
}
