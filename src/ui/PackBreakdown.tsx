import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { carryEndpoints, deriveCarries } from '../domain/carries'
import { carryTotals, planKey } from '../domain/totals'
import { packagingBaseG } from '../domain/units'
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
import { fmtCalories, fmtGrams } from './format'

// Summary-first food + gear pack view. Gear rides every carry (constant); food
// is consumed, so it varies per carry — pack weight for a carry = gear base +
// gear consumable (fuel) + that carry's food + its packaging. Worn is on the
// body, shown separately. The headline is base weight and the heaviest pack;
// the per-carry table and category breakdown are the supporting detail.
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
  const endpoints = carryEndpoints(carries, resupplies)
  const perCarry = carries.map((carry) =>
    carryTotals({ carry, personIds, entriesByKey, mealsById, itemsById }),
  )

  const rows = people.map((p) => {
    const gearT = personGearTotals(assignments, gearById, p.id)
    const packByCarry = perCarry.map((c, i) => {
      const foodG = c.perPerson.get(p.id)?.weightG ?? 0
      const packagingG = packagingBaseG(carries[i].slots, [p.id], entriesByKey, mealsById, itemsById)
      return carryPackWeightG(gearT, foodG) + packagingG
    })
    const foodCalByCarry = perCarry.map((c) => c.perPerson.get(p.id)?.calories ?? 0)
    const heaviest = packByCarry.length
      ? Math.max(...packByCarry)
      : gearT.baseG + gearT.consumableG
    const heaviestIdx = packByCarry.length ? packByCarry.indexOf(heaviest) : -1
    return { person: p, gearT, packByCarry, foodCalByCarry, heaviest, heaviestIdx }
  })

  if (gear.length === 0 && assignments.length === 0 && planEntries.length === 0) return null

  const showGroup = people.length > 1
  const groupCarry = carries.map((_, i) => rows.reduce((n, r) => n + r.packByCarry[i], 0))
  const groupCal = carries.map((_, i) => rows.reduce((n, r) => n + r.foodCalByCarry[i], 0))
  const groupHeaviest = groupCarry.length ? Math.max(...groupCarry) : 0

  // Group base weight by gear category (the LighterPack-style breakdown).
  const byCategory = new Map<string, number>()
  for (const a of assignments) {
    const item = gearById.get(a.gearItemId)
    if (!item) continue
    byCategory.set(
      item.category,
      (byCategory.get(item.category) ?? 0) + gearWeightSplit(item).baseG * (a.quantity ?? 1),
    )
  }
  const categoryRows = [...byCategory.entries()].sort(
    (a, b) => Number(isBigThree(b[0])) - Number(isBigThree(a[0])) || b[1] - a[1],
  )
  const bigThreeBase = categoryRows.filter(([c]) => isBigThree(c)).reduce((n, [, g]) => n + g, 0)
  const totalBase = categoryRows.reduce((n, [, g]) => n + g, 0)

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Pack weight — food + gear</h3>

      {/* Headline: the numbers you actually care about, per person. */}
      <div className="flex flex-wrap gap-3">
        {rows.map((r) => (
          <div key={r.person.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <div className="font-medium text-gray-800">{r.person.name}</div>
            <div className="tabular-nums text-lg font-semibold text-emerald-800">
              {fmtGrams(r.heaviest)}
              {r.heaviestIdx >= 0 && carries.length > 1 && (
                <span className="ml-1 text-xs font-normal text-gray-500">
                  heaviest (carry {carries[r.heaviestIdx].index})
                </span>
              )}
              {carries.length <= 1 && (
                <span className="ml-1 text-xs font-normal text-gray-500">pack</span>
              )}
            </div>
            <div className="tabular-nums text-gray-600">
              base {fmtGrams(r.gearT.baseG)}
              {r.gearT.wornG ? ` · worn ${fmtGrams(r.gearT.wornG)}` : ''}
            </div>
          </div>
        ))}
      </div>

      {/* One per-carry table: pack weight (top) + that carry's food calories. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Carry</th>
              {people.map((p) => (
                <th key={p.id} className="py-1 pr-2 text-right">
                  {p.name}
                </th>
              ))}
              {showGroup && <th className="py-1 pr-2 text-right">Group</th>}
            </tr>
          </thead>
          <tbody>
            {carries.map((carry, i) => (
              <tr key={carry.index} className="border-b border-gray-100">
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-gray-800">Carry {carry.index}</span>
                  {(endpoints[i].from || endpoints[i].to) && (
                    <span className="block text-xs text-gray-500">
                      {endpoints[i].from ?? 'start'} → {endpoints[i].to ?? 'finish'}
                    </span>
                  )}
                </td>
                {rows.map((r) => (
                  <td key={r.person.id} className="py-1.5 pr-2 text-right tabular-nums">
                    <div className={r.heaviestIdx === i ? 'font-semibold text-gray-800' : ''}>
                      {fmtGrams(r.packByCarry[i])}
                    </div>
                    <div className="text-xs text-gray-400">{fmtCalories(r.foodCalByCarry[i])}</div>
                  </td>
                ))}
                {showGroup && (
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    <div>{fmtGrams(groupCarry[i])}</div>
                    <div className="text-xs text-gray-400">{fmtCalories(groupCal[i])}</div>
                  </td>
                )}
              </tr>
            ))}
            {showGroup && carries.length > 1 && (
              <tr className="font-medium">
                <td className="py-1.5 pr-2">Heaviest</td>
                {rows.map((r) => (
                  <td key={r.person.id} className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtGrams(r.heaviest)}
                  </td>
                ))}
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(groupHeaviest)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {categoryRows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            Base weight by category (whole group)
          </summary>
          <table className="mt-2 w-full max-w-sm border-collapse text-sm">
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
        </details>
      )}

      <p className="text-xs text-gray-500">
        Pack weight = gear base + gear consumables (fuel) + that carry’s food + its packaging.
        Calories are that carry’s food. Worn weight is on the body, not counted.
      </p>
    </section>
  )
}
