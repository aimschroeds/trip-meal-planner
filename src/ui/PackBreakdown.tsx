import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { carryEndpoints, carryKey, deriveCarries } from '../domain/carries'
import { carryTotals, planKey } from '../domain/totals'
import { packagingBaseG } from '../domain/units'
import {
  addGearTotals,
  assignmentGearTotals,
  assignmentOnCarry,
  assignmentQuantityOnCarry,
  assignmentTotalsOnCarry,
  categoryLabel,
  consumableLoadOnCarry,
  gearTotalG,
  isBigThree,
  fairShareBreakdown,
  personConsumableTotalsForCarry,
  personGearTotals,
  personGearTotalsForCarry,
} from '../domain/gear'
import type { GearTotals } from '../domain/gear'
import type {
  GearAssignment,
  GearItem,
  Item,
  Meal,
  Person,
  PlanEntry,
  Resupply,
  Trip,
  TripConsumable,
} from '../domain/types'
import { fmtCalories, fmtGrams } from './format'

// Per-carry pack-weight view, framed around the questions a hiker actually asks:
//   S1 how heavy does it get?  → the summary strip (heaviest pack per person)
//   S2 how does it change leg to leg?  → the per-carry rows read top-to-bottom
//   S3 what's fixed vs what I'll burn?  → base / consumable / worn columns
//   S4 am I carrying my fair share?  → the fair-share table
//   S5 where's my base weight?  → the category breakdown
// Pack = base + consumable; worn rides on the body and is shown apart. Base here
// includes food packaging (a wrapper doesn't deplete); consumable is food + fuel
// + soap. Gear and consumables can vary per carry, so base and consumable both
// move leg to leg — which is exactly what the per-carry tables surface.

/** One person's (or the group's) weight broken down per carry. */
interface PackSeries {
  key: string
  label: string
  packByCarry: number[]
  baseByCarry: number[]
  consumableByCarry: number[]
  wornByCarry: number[]
  calByCarry: number[]
  /** Index into `carries` of the heaviest pack, or -1 when nothing is planned. */
  heaviestIdx: number
  /** The heaviest pack and its split (falls back to notional gear when no carries). */
  hPack: number
  hBase: number
  hConsumable: number
  hWorn: number
}

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
  const consumables = useLiveQuery(
    () => db.tripConsumables.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as TripConsumable[],
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

  const argmax = (xs: number[]): number => (xs.length ? xs.indexOf(Math.max(...xs)) : -1)

  const personSeries: PackSeries[] = people.map((p) => {
    // Gear + trip consumables summed per carry (pinned items count only on their
    // leg). Base = gear base + food packaging; consumable = gear consumable
    // (fuel) + food; worn rides on the body.
    const gearByCarry = carryKeys.map((k) =>
      addGearTotals(
        personGearTotalsForCarry(assignments, gearById, p.id, k),
        personConsumableTotalsForCarry(consumables, p.id, k),
      ),
    )
    const baseByCarry = carries.map(
      (c, i) =>
        gearByCarry[i].baseG +
        packagingBaseG(c.slots, [p.id], entriesByKey, mealsById, itemsById),
    )
    const consumableByCarry = carries.map(
      (_, i) => gearByCarry[i].consumableG + (perCarry[i].perPerson.get(p.id)?.weightG ?? 0),
    )
    const wornByCarry = gearByCarry.map((g) => g.wornG)
    const packByCarry = baseByCarry.map((b, i) => b + consumableByCarry[i])
    const calByCarry = perCarry.map((c) => c.perPerson.get(p.id)?.calories ?? 0)

    // Nothing planned yet: fall back to the notional pack (all gear, one leg).
    const gearAll = addGearTotals(
      personGearTotals(assignments, gearById, p.id),
      personConsumableTotalsForCarry(consumables, p.id, '__none__'),
    )
    const heaviestIdx = argmax(packByCarry)
    return {
      key: p.id,
      label: p.name,
      packByCarry,
      baseByCarry,
      consumableByCarry,
      wornByCarry,
      calByCarry,
      heaviestIdx,
      hPack: heaviestIdx >= 0 ? packByCarry[heaviestIdx] : gearAll.baseG + gearAll.consumableG,
      hBase: heaviestIdx >= 0 ? baseByCarry[heaviestIdx] : gearAll.baseG,
      hConsumable: heaviestIdx >= 0 ? consumableByCarry[heaviestIdx] : gearAll.consumableG,
      hWorn: heaviestIdx >= 0 ? wornByCarry[heaviestIdx] : gearAll.wornG,
    }
  })

  const showGroup = people.length > 1
  const sumByCarry = (pick: (s: PackSeries) => number[]) =>
    carries.map((_, i) => personSeries.reduce((n, s) => n + pick(s)[i], 0))

  const groupSeries: PackSeries = (() => {
    const packByCarry = sumByCarry((s) => s.packByCarry)
    const baseByCarry = sumByCarry((s) => s.baseByCarry)
    const consumableByCarry = sumByCarry((s) => s.consumableByCarry)
    const wornByCarry = sumByCarry((s) => s.wornByCarry)
    const calByCarry = sumByCarry((s) => s.calByCarry)
    const heaviestIdx = argmax(packByCarry)
    const at = (xs: number[], fallback: number) => (heaviestIdx >= 0 ? xs[heaviestIdx] : fallback)
    const sumH = (pick: (s: PackSeries) => number) => personSeries.reduce((n, s) => n + pick(s), 0)
    return {
      key: '__group__',
      label: 'Group',
      packByCarry,
      baseByCarry,
      consumableByCarry,
      wornByCarry,
      calByCarry,
      heaviestIdx,
      hPack: at(packByCarry, sumH((s) => s.hPack)),
      hBase: at(baseByCarry, sumH((s) => s.hBase)),
      hConsumable: at(consumableByCarry, sumH((s) => s.hConsumable)),
      hWorn: at(wornByCarry, sumH((s) => s.hWorn)),
    }
  })()

  const allSeries = showGroup ? [...personSeries, groupSeries] : personSeries

  if (
    gear.length === 0 &&
    assignments.length === 0 &&
    consumables.length === 0 &&
    planEntries.length === 0
  )
    return null

  const personName = new Map(people.map((p) => [p.id, p.name]))

  // Category breakdown and fair share describe the pack that drives the headline
  // — the group's heaviest carry — so per-carry swaps aren't double-counted.
  const activeKey = groupSeries.heaviestIdx >= 0 ? carryKeys[groupSeries.heaviestIdx] : undefined
  const key = activeKey ?? '__none__'
  // Count-based gear on the heaviest carry; weight-varied gear (a map that
  // changes grams per leg) is folded in as extras below, like consumables.
  const activeAssignments =
    activeKey === undefined
      ? assignments.filter((a) => !a.carryWeights)
      : assignments
          .filter((a) => !a.carryWeights && assignmentOnCarry(a, activeKey))
          .map((a) => ({ ...a, quantity: assignmentQuantityOnCarry(a, activeKey) }))
  const activeConsumables = consumables
    .map((c) => ({ c, load: consumableLoadOnCarry(c, key) }))
    .filter((x): x is { c: TripConsumable; load: GearTotals } => x.load !== null)
  const activeWeightGear = assignments.flatMap((a) => {
    if (!a.carryWeights) return []
    const item = gearById.get(a.gearItemId)
    if (!item) return []
    const load = assignmentTotalsOnCarry(item, a, key)
    return gearTotalG(load) > 0 ? [{ a, item, load }] : []
  })
  const fair = fairShareBreakdown(activeAssignments, gearById, personIds, [
    ...activeConsumables.map(({ c, load }) => ({
      personId: c.personId,
      weightG: gearTotalG(load),
      shared: c.shared,
    })),
    ...activeWeightGear.map(({ a, item, load }) => ({
      personId: a.personId,
      weightG: gearTotalG(load),
      shared: item.shared,
    })),
  ])

  const byCategory = new Map<string, number>()
  for (const { c, load } of activeConsumables) {
    byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + load.baseG)
  }
  for (const { item, load } of activeWeightGear) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + load.baseG)
  }
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

  const carryLabel = (i: number) =>
    endpoints[i].from || endpoints[i].to
      ? `${endpoints[i].from ?? 'start'} → ${endpoints[i].to ?? 'finish'}`
      : null

  return (
    <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Pack weight — food + gear</h3>

      {/* S1 — heaviest pack per person, compared at a glance. Pack = base +
          consumable; worn is on the body, kept apart from the pack number. */}
      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs tracking-wide text-gray-500 uppercase">
              <th className="py-1 pr-3 font-medium">Heaviest pack</th>
              <th className="py-1 pr-3 text-right font-medium">total</th>
              <th className="py-1 pr-3 text-right font-medium">base</th>
              <th className="py-1 pr-3 text-right font-medium">consumable</th>
              <th className="py-1 text-right font-medium">worn (on body)</th>
            </tr>
          </thead>
          <tbody>
            {allSeries.map((s) => (
              <tr
                key={s.key}
                className={`border-b border-gray-100 ${s.key === '__group__' ? 'text-gray-800' : ''}`}
              >
                <td className="py-1.5 pr-3 font-medium text-gray-800">
                  {s.label}
                  {s.heaviestIdx >= 0 && carries.length > 1 && (
                    <span className="ml-1 text-xs font-normal text-gray-400">
                      carry {carries[s.heaviestIdx].index}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-lg font-semibold text-emerald-800">
                  {fmtGrams(s.hPack)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">
                  {fmtGrams(s.hBase)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">
                  {fmtGrams(s.hConsumable)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-400">
                  {s.hWorn ? fmtGrams(s.hWorn) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* S2 + S3 — one table per person (and the group): read a column top to
          bottom to watch consumable burn down and spot the resupply spikes. */}
      {carries.length === 0 ? (
        <p className="text-sm text-gray-500">
          Plan days and meals to see how weight changes carry by carry.
        </p>
      ) : (
        <div className="space-y-4">
          {allSeries.map((s) => (
            <div key={s.key}>
              <h4 className="mb-1 text-sm font-medium text-gray-700">
                {s.label}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  heaviest {fmtGrams(s.hPack)}
                  {s.heaviestIdx >= 0 && carries.length > 1
                    ? ` · carry ${carries[s.heaviestIdx].index}`
                    : ''}
                </span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-300 text-xs tracking-wide text-gray-500 uppercase">
                      <th className="py-1 pr-2 text-left font-medium">Carry</th>
                      <th className="py-1 px-2 text-right font-medium">Pack</th>
                      <th className="py-1 px-2 text-right font-medium">Base</th>
                      <th className="py-1 px-2 text-right font-medium">Consumable</th>
                      <th className="py-1 px-2 text-right font-medium">Worn</th>
                      <th className="py-1 pl-2 text-right font-medium">Cal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carries.map((carry, i) => {
                      const heavy = s.heaviestIdx === i
                      const label = carryLabel(i)
                      return (
                        <tr
                          key={carry.index}
                          className={`border-b border-gray-100 ${heavy ? 'bg-emerald-50/60' : ''}`}
                        >
                          <td className="py-1.5 pr-2">
                            <span
                              className={`font-medium ${heavy ? 'text-emerald-900' : 'text-gray-800'}`}
                            >
                              Carry {carry.index}
                            </span>
                            {label && <span className="block text-xs text-gray-500">{label}</span>}
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right tabular-nums ${
                              heavy ? 'font-semibold text-emerald-900' : 'text-gray-800'
                            }`}
                          >
                            {fmtGrams(s.packByCarry[i])}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-gray-600">
                            {fmtGrams(s.baseByCarry[i])}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-gray-600">
                            {fmtGrams(s.consumableByCarry[i])}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-gray-400">
                            {s.wornByCarry[i] ? fmtGrams(s.wornByCarry[i]) : '—'}
                          </td>
                          <td className="py-1.5 pl-2 text-right tabular-nums text-gray-400">
                            {fmtCalories(s.calByCarry[i])}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* S4 — fair share of shared group gear (measured on the heaviest carry). */}
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
            Measured on the heaviest carry. Shared gear ({fmtGrams(fair.sharedTotalG)}) is split
            evenly, so over-packing personal kit is that person's own burden. “Carrying” is what each
            holds now — a red +N means more than their fair total (hand some shared gear to someone
            with a green −N).
          </p>
        </div>
      )}

      {/* S5 — where the base weight lives (the LighterPack lens for trimming). */}
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
        Pack = base + consumable. Base is gear base + food packaging (a wrapper doesn't deplete);
        consumable is food + fuel + soap, which burns down between resupplies. Worn weight rides on
        the body and isn't in the pack. Gear and consumables pinned to a carry count only there.
      </p>
    </section>
  )
}
