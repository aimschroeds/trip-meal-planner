import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { carryEndpoints, carryKey, deriveCarries } from '../domain/carries'
import { carryTotals, planKey } from '../domain/totals'
import { packagingBaseG } from '../domain/units'
import {
  assignmentGearTotals,
  assignmentOnCarry,
  assignmentQuantityOnCarry,
  carryPackWeightG,
  categoryLabel,
  isBigThree,
  fairShareBreakdown,
  personGearTotals,
  personGearTotalsForCarry,
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

// Summary-first food + gear pack view. Most gear rides every carry, but some is
// pinned to one carry (a heavier rain shell, extra soap), so gear is summed per
// carry; food is consumed, so it varies too — pack weight for a carry = that
// carry's gear base + gear consumable (fuel) + its food + its packaging. Worn is
// on the body, shown separately. The headline is base weight and the heaviest
// pack; the per-carry table and category breakdown are the supporting detail.
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
  const carryKeys = carries.map((c) => carryKey(c))
  const perCarry = carries.map((carry) =>
    carryTotals({ carry, personIds, entriesByKey, mealsById, itemsById }),
  )

  const rows = people.map((p) => {
    // Gear is summed per carry so items pinned to one leg count only there.
    const gearByCarry = carryKeys.map((k) => personGearTotalsForCarry(assignments, gearById, p.id, k))
    const packByCarry = perCarry.map((c, i) => {
      const foodG = c.perPerson.get(p.id)?.weightG ?? 0
      const packagingG = packagingBaseG(carries[i].slots, [p.id], entriesByKey, mealsById, itemsById)
      return carryPackWeightG(gearByCarry[i], foodG) + packagingG
    })
    const foodCalByCarry = perCarry.map((c) => c.perPerson.get(p.id)?.calories ?? 0)
    // No carries yet (nothing planned): all gear rides the one notional pack.
    const gearAll = personGearTotals(assignments, gearById, p.id)
    const heaviestPack = packByCarry.length
      ? Math.max(...packByCarry)
      : gearAll.baseG + gearAll.consumableG
    const heaviestIdx = packByCarry.length ? packByCarry.indexOf(heaviestPack) : -1
    // Base/worn come from the gear on the heaviest carry; everything else in
    // that pack (food + fuel + packaging) is consumable. Worn is on the body.
    const gearAtHeaviest = heaviestIdx >= 0 ? gearByCarry[heaviestIdx] : gearAll
    const base = gearAtHeaviest.baseG
    const worn = gearAtHeaviest.wornG
    const consumable = heaviestPack - base
    return { person: p, base, worn, consumable, heaviestPack, heaviestIdx, packByCarry, foodCalByCarry }
  })

  if (gear.length === 0 && assignments.length === 0 && planEntries.length === 0) return null

  const showGroup = people.length > 1
  const personName = new Map(people.map((p) => [p.id, p.name]))
  const groupCarry = carries.map((_, i) => rows.reduce((n, r) => n + r.packByCarry[i], 0))
  const groupCal = carries.map((_, i) => rows.reduce((n, r) => n + r.foodCalByCarry[i], 0))
  const groupHeaviest = groupCarry.length ? Math.max(...groupCarry) : 0

  // Category breakdown and fair share describe the pack that drives the
  // headline — the group's heaviest carry — so per-carry swaps aren't
  // double-counted. With no pinned gear this is identical to every carry.
  const groupHeaviestIdx = groupCarry.length ? groupCarry.indexOf(groupHeaviest) : -1
  const activeKey = groupHeaviestIdx >= 0 ? carryKeys[groupHeaviestIdx] : undefined
  const activeAssignments =
    activeKey === undefined
      ? assignments
      : assignments
          .filter((a) => assignmentOnCarry(a, activeKey))
          .map((a) => ({ ...a, quantity: assignmentQuantityOnCarry(a, activeKey) }))
  const fair = fairShareBreakdown(activeAssignments, gearById, personIds)

  // Group base weight by gear category (the LighterPack-style breakdown).
  const byCategory = new Map<string, number>()
  for (const a of activeAssignments) {
    const item = gearById.get(a.gearItemId)
    if (!item) continue
    byCategory.set(
      item.category,
      (byCategory.get(item.category) ?? 0) +
        assignmentGearTotals(item, a.quantity, a.wornQuantity).baseG,
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
              {fmtGrams(r.heaviestPack)}
              <span className="ml-1 text-xs font-normal text-gray-500">
                pack
                {r.heaviestIdx >= 0 && carries.length > 1 && ` (heaviest, carry ${carries[r.heaviestIdx].index})`}
              </span>
            </div>
            <div className="tabular-nums text-gray-600">
              base {fmtGrams(r.base)} · consumable {fmtGrams(r.consumable)}
              {r.worn ? ` · worn ${fmtGrams(r.worn)}` : ''}
            </div>
          </div>
        ))}
        {showGroup && (
          <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
            <div className="font-medium text-gray-800">Group</div>
            <div className="tabular-nums text-lg font-semibold text-emerald-800">
              {fmtGrams(rows.reduce((n, r) => n + r.heaviestPack, 0))}
              <span className="ml-1 text-xs font-normal text-gray-500">pack (per-person heaviest)</span>
            </div>
            <div className="tabular-nums text-gray-600">
              base {fmtGrams(rows.reduce((n, r) => n + r.base, 0))} · consumable{' '}
              {fmtGrams(rows.reduce((n, r) => n + r.consumable, 0))}
              {rows.some((r) => r.worn) ? ` · worn ${fmtGrams(rows.reduce((n, r) => n + r.worn, 0))}` : ''}
            </div>
          </div>
        )}
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
                    {fmtGrams(r.heaviestPack)}
                  </td>
                ))}
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(groupHeaviest)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showGroup && fair.sharedTotalG > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-medium text-gray-700">
            Fair share — split group gear evenly
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full max-w-lg border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 text-left text-gray-600">
                  <th className="py-1 pr-2" />
                  <th className="py-1 pr-2 text-right">Personal</th>
                  <th className="py-1 pr-2 text-right">+ shared share</th>
                  <th className="py-1 pr-2 text-right">Fair total</th>
                  <th className="py-1 pr-2 text-right">Carrying</th>
                </tr>
              </thead>
              <tbody>
                {fair.rows.map((r) => {
                  const delta = r.physicalG - r.fairG
                  return (
                    <tr key={r.personId} className="border-b border-gray-100">
                      <td className="py-1 pr-2 text-gray-700">{personName.get(r.personId)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{fmtGrams(r.personalG)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-gray-500">
                        {fmtGrams(fair.perPersonSharedG)}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums font-medium">
                        {fmtGrams(r.fairG)}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {fmtGrams(r.physicalG)}
                        {Math.abs(delta) >= 50 && (
                          <span className={delta > 0 ? 'ml-1 text-xs text-red-700' : 'ml-1 text-xs text-emerald-700'}>
                            {delta > 0 ? '+' : '−'}
                            {fmtGrams(Math.abs(delta))}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Shared gear ({fmtGrams(fair.sharedTotalG)}) is split evenly, so over-packing personal
            kit is that person's own burden. “Carrying” is what each holds now — a red +N means
            they're carrying more than their fair total (hand some shared gear to someone with a
            green −N).
          </p>
        </div>
      )}

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
        Pack weight = that carry’s gear base + gear consumables (fuel) + its food + its packaging.
        Gear pinned to a carry (on the Gear tab) counts only there. Calories are that carry’s food.
        Worn weight is on the body, not counted.
      </p>
    </section>
  )
}
