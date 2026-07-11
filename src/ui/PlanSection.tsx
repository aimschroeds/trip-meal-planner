import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type MarkRow } from '../store/db'
import { applyPlanWrites, clearPlanEntry, setPlanEntry, setPlannedSlot, toggleMark } from '../store/repos'
import {
  carryEnd,
  carryEndpoints,
  carryStart,
  deriveCarries,
  keyedSlots,
  type KeyedSlot,
  type SlotRef,
} from '../domain/carries'
import { copyDayPlan } from '../domain/copyDay'
import { dayLegLabel } from '../domain/dayDescription'
import { generateDayPlan } from '../domain/generate'
import { mealSlotTypes, rollUpMeal } from '../domain/rollups'
import {
  carryTotals,
  combineTotals,
  dayTotals,
  entryTotals,
  findMissingSlots,
  planKey,
  type DayStatus,
} from '../domain/totals'
import {
  carryPrepIngredientTotals,
  carryPrepList,
  carryShoppingList,
  defaultServingG,
  entryItemLines,
  tripShoppingList,
} from '../domain/units'
import { itemsToCsv } from '../domain/csv/items'
import { mealsToCsv } from '../domain/csv/meals'
import type { Day, Item, Meal, PlanPart, Person, PlanEntry, Resupply, Slot, Trip } from '../domain/types'
import { downloadCsv } from './download'
import {
  fmtCalories,
  fmtDensity,
  fmtGrams,
  fmtPrepIngredient,
  fmtPrepPortion,
  fmtPurchase,
  fmtSlot,
  MEAL_TYPE_LABEL,
  resupplyTimingLabel,
} from './format'
import { GroupedCombobox } from './GroupedCombobox'

const OFF_TRAIL = '@offtrail'

const STATUS_STYLES: Record<DayStatus, string> = {
  ok: 'bg-green-100 text-green-800',
  under: 'bg-red-100 text-red-800',
  over: 'bg-amber-100 text-amber-800',
  partial: 'bg-sky-100 text-sky-800',
}

const STATUS_LABELS: Record<DayStatus, string> = {
  ok: 'on target',
  under: 'under',
  over: 'over',
  partial: 'partially estimated',
}

export function PlanSection({
  trip,
  people,
  section,
}: {
  trip: Trip
  people: Person[]
  /** Which slice to show: the per-person meal grid ('plan'), the carry
   *  boundaries table ('carries'), or the shopping + packing lists
   *  ('shopping'). All share this component's derived totals. */
  section: 'plan' | 'carries' | 'shopping'
}) {
  const [personId, setPersonId] = useState<string | null>(null)
  const [packingView, setPackingView] = useState<'flat' | 'nested'>('flat')
  const [prepView, setPrepView] = useState<'recipe' | 'ingredient'>('recipe')
  // Shopping/packing tick-offs are persisted as `mark` rows and synced, so the
  // checklist is shared live with collaborators. `buy` marks key on item id;
  // `pack` marks key on `${carryIndex}:${itemId}`.
  const marks = useLiveQuery(
    () => db.marks.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as MarkRow[],
  )
  const bought = new Set(marks.filter((m) => m.scope === 'buy').map((m) => m.ref))
  const packed = new Set(marks.filter((m) => m.scope === 'pack').map((m) => m.ref))
  const prepped = new Set(marks.filter((m) => m.scope === 'prep').map((m) => m.ref))
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const meals = useLiveQuery(() => db.meals.toArray(), [], [] as Meal[])
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as Resupply[],
  )
  const allEntries = useLiveQuery(
    () => db.planEntries.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as PlanEntry[],
  )

  const person = people.find((p) => p.id === personId) ?? people[0]
  if (!person) {
    return <p className="text-sm text-gray-500">Add people in the Setup view first.</p>
  }

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const mealsById = new Map(meals.map((m) => [m.id, m]))
  const peopleById = new Map(people.map((p) => [p.id, p]))
  const entriesByKey = new Map(
    allEntries.map((e) => [planKey(e.personId, e.dayIndex, e.slotKey), e]),
  )
  const carries = deriveCarries(trip, resupplies)
  const endpoints = carryEndpoints(carries, resupplies)
  const personIds = people.map((p) => p.id)

  const perCarry = carries.map((carry) =>
    carryTotals({ carry, personIds, entriesByKey, mealsById, itemsById }),
  )
  const tripGroup = combineTotals(perCarry.map((c) => c.group))
  const zeroTotals = { weightG: 0, calories: 0, density: 0 }
  // Trip-wide totals for every person, for the Carries table's per-person columns.
  const tripPerPerson = new Map(
    personIds.map((pid) => [
      pid,
      combineTotals(perCarry.map((c) => c.perPerson.get(pid) ?? zeroTotals)),
    ]),
  )

  // Generation fills unlocked, on-trail slots around manual picks; tapping
  // again regenerates with fresh randomness (stories 8.1-8.3).
  async function generateForDay(day: Day) {
    const dayEntries = allEntries.filter(
      (e) => e.personId === person.id && e.dayIndex === day.index,
    )
    const generated = generateDayPlan({
      trip,
      day,
      person,
      meals,
      itemsById,
      existingEntries: dayEntries,
      rng: Math.random,
    })
    const generatedKeys = new Set(generated.map((e) => e.slotKey))
    for (const e of dayEntries) {
      if (e.kind !== 'offTrail' && !e.locked && !generatedKeys.has(e.slotKey)) {
        await clearPlanEntry(trip.id, person.id, day.index, e.slotKey)
      }
    }
    for (const e of generated) await setPlanEntry(e)
  }

  async function generateAll() {
    for (const day of trip.days) await generateForDay(day)
  }

  // Export scoped to what this trip's plan actually uses (story 4.10).
  function exportUsed() {
    const parts = allEntries.flatMap((e) => e.parts ?? [])
    const usedMealIds = new Set(
      parts.flatMap((p) => (p.kind === 'meal' ? [p.mealId] : [])),
    )
    const usedMeals = meals.filter((m) => usedMealIds.has(m.id))
    const usedItemIds = new Set([
      ...usedMeals.flatMap((m) => m.components.map((c) => c.itemId)),
      ...parts.flatMap((p) => (p.kind === 'item' ? [p.itemId] : [])),
    ])
    const slug = trip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    downloadCsv(`${slug}-meals.csv`, mealsToCsv(usedMeals, itemsById))
    downloadCsv(`${slug}-items.csv`, itemsToCsv(items.filter((i) => usedItemIds.has(i.id))))
  }

  return (
    <div className="space-y-6">
      {/* The person selector only governs the per-person meal grid, so it lives
          on the Plan tab. The Carries tab is a whole-group view (every person's
          carry weight is a column) — no toggle, to avoid implying it scopes the
          shopping/packing lists, which are shared. */}
      {section === 'plan' && (
        <div className="flex flex-wrap items-center gap-2">
          {people.length > 1 &&
            people.map((p) => (
              <button
                key={p.id}
                onClick={() => setPersonId(p.id)}
                className={
                  p.id === person.id
                    ? 'rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white'
                    : 'rounded border border-gray-300 px-3 py-1 text-sm text-gray-600'
                }
              >
                {p.name}
              </button>
            ))}
          <button
            className="ml-auto rounded border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-800 disabled:opacity-40"
            disabled={meals.length === 0}
            onClick={() => void generateAll()}
            title="Fill unlocked slots on every day; locked picks and off-trail slots are kept"
          >
            ✨ generate all days
          </button>
        </div>
      )}

      {section === 'plan' && (
        <div className="space-y-4">
          {trip.days.map((day) => (
            <DayCard
              key={day.index}
              trip={trip}
              day={day}
              person={person}
              entriesByKey={entriesByKey}
              dayResupplies={resupplies.filter((r) => r.dayIndex === day.index)}
              meals={meals}
              mealsById={mealsById}
              itemsById={itemsById}
              onGenerate={() => void generateForDay(day)}
            />
          ))}
        </div>
      )}

      {section === 'carries' && (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center">
          <h3 className="font-semibold text-gray-800">Carries</h3>
          <button
            className="ml-auto text-sm text-emerald-700 underline disabled:text-gray-400"
            disabled={allEntries.length === 0}
            onClick={exportUsed}
          >
            export this trip's meals + items CSV
          </button>
        </div>
        <p className="mb-2 text-xs text-gray-500">
          What each person carries between resupplies (weight on top, calories below). The shopping
          and packing lists below cover the whole group.
        </p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Carry</th>
              <th className="py-1 pr-2">Boundary</th>
              {people.map((p) => (
                <th key={p.id} className="py-1 pr-2 text-right">
                  {p.name}
                </th>
              ))}
              {people.length > 1 && <th className="py-1 pr-2 text-right">Group</th>}
              <th className="py-1 pr-2 text-right">Density</th>
            </tr>
          </thead>
          <tbody>
            {carries.map((carry, i) => (
              <tr key={carry.index} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 font-medium">{carry.index}</td>
                <td className="py-1.5 pr-2 text-gray-600">
                  {(endpoints[i].from || endpoints[i].to) && (
                    <span className="font-medium text-gray-800">
                      {endpoints[i].from ?? 'start'} → {endpoints[i].to ?? 'finish'}
                      <br />
                    </span>
                  )}
                  d{carryStart(carry).dayIndex} {fmtSlot(carryStart(carry).slot)} → d
                  {carryEnd(carry).dayIndex} {fmtSlot(carryEnd(carry).slot)}
                </td>
                {people.map((p) => {
                  const t = perCarry[i].perPerson.get(p.id) ?? zeroTotals
                  return <WeightCalCell key={p.id} weightG={t.weightG} calories={t.calories} />
                })}
                {people.length > 1 && (
                  <WeightCalCell weightG={perCarry[i].group.weightG} calories={perCarry[i].group.calories} />
                )}
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtDensity(perCarry[i].group.density)}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-1.5 pr-2">Trip</td>
              <td className="py-1.5 pr-2" />
              {people.map((p) => {
                const t = tripPerPerson.get(p.id) ?? zeroTotals
                return <WeightCalCell key={p.id} weightG={t.weightG} calories={t.calories} />
              })}
              {people.length > 1 && (
                <WeightCalCell weightG={tripGroup.weightG} calories={tripGroup.calories} />
              )}
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtDensity(tripGroup.density)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      )}

      {section === 'shopping' && (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-1 font-semibold text-gray-800">Shopping &amp; packing</h3>
        <details className="mt-3" open>
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            🛒 Shopping list — buy for the whole trip
          </summary>
          {(() => {
            const shopping = tripShoppingList({
              carries,
              personIds,
              entriesByKey,
              mealsById,
              itemsById,
            })
            const toggle = (id: string) => void toggleMark(trip.id, 'buy', id)
            return shopping.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Nothing planned yet.</p>
            ) : (
              <>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {shopping.map((s) => {
                    const checked = bought.has(s.item.id)
                    return (
                      <li key={s.item.id}>
                        <label className="flex cursor-pointer items-baseline gap-2">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={checked}
                            onChange={() => toggle(s.item.id)}
                          />
                          <span
                            className={`min-w-0 flex-1 truncate ${checked ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                          >
                            {s.item.brand && <span className="text-gray-400">{s.item.brand} · </span>}
                            {s.item.name}
                          </span>
                          <span
                            className={`shrink-0 font-medium ${checked ? 'text-gray-400 line-through' : 'text-emerald-800'}`}
                          >
                            {fmtPurchase(s.purchase)}
                          </span>
                          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-400">
                            {fmtGrams(s.grams)}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 text-xs text-gray-500">
                  Whole-trip totals for everyone, scaling included. Items entered per package or
                  with a piece weight show whole packs/pieces; the rest show weight (buy a bag).
                  Tick-offs are saved and shared live with anyone you've synced with.
                </p>
              </>
            )
          })()}
        </details>

        <details className="mt-3" open>
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            🥣 Prep list — measure this out, per resupply carry
          </summary>

          <div className="mt-2 flex gap-1">
            <button
              onClick={() => setPrepView('recipe')}
              className={
                prepView === 'recipe'
                  ? 'rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white'
                  : 'rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600'
              }
            >
              By recipe
            </button>
            <button
              onClick={() => setPrepView('ingredient')}
              className={
                prepView === 'ingredient'
                  ? 'rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white'
                  : 'rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600'
              }
            >
              By ingredient
            </button>
          </div>

          {prepView === 'recipe' ? (
            <div className="mt-2 space-y-4">
              {carries.map((carry, i) => {
                const groups = carryPrepList({ carry, personIds, entriesByKey, mealsById, itemsById })
                const { from, to } = endpoints[i]
                const togglePrepped = (key: string) => void toggleMark(trip.id, 'prep', key)
                let lastMealType: string | null = null
                return (
                  <div key={carry.index}>
                    <div className="flex items-baseline gap-2 border-b border-gray-200 pb-1 text-sm">
                      <span className="font-medium text-gray-800">
                        Carry {carry.index}
                        {(from || to) && ` · ${from ?? 'start'} → ${to ?? 'finish'}`}
                      </span>
                    </div>
                    {groups.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">Nothing planned yet.</p>
                    ) : (
                      groups.map((g) => {
                        const showHeader = g.mealType !== lastMealType
                        lastMealType = g.mealType
                        const key = `${carry.index}:${g.key}`
                        const isPrepped = prepped.has(key)
                        return (
                          <div key={g.key}>
                            {showHeader && (
                              <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {MEAL_TYPE_LABEL[g.mealType]}
                              </div>
                            )}
                            <label className="mt-0.5 flex cursor-pointer items-baseline gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="shrink-0"
                                checked={isPrepped}
                                onChange={() => togglePrepped(key)}
                              />
                              <span
                                className={`min-w-0 flex-1 ${isPrepped ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                              >
                                <span className="font-medium text-emerald-800">{g.count}×</span>{' '}
                                {g.lines.map((l) => fmtPrepIngredient(l)).join(' + ')}
                              </span>
                            </label>
                          </div>
                        )
                      })
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-2 space-y-4">
              {carries.map((carry, i) => {
                const groups = carryPrepList({ carry, personIds, entriesByKey, mealsById, itemsById })
                const mealTotals = carryPrepIngredientTotals(groups)
                const { from, to } = endpoints[i]
                const togglePrepped = (key: string) => void toggleMark(trip.id, 'prep', key)
                return (
                  <div key={carry.index}>
                    <div className="flex items-baseline gap-2 border-b border-gray-200 pb-1 text-sm">
                      <span className="font-medium text-gray-800">
                        Carry {carry.index}
                        {(from || to) && ` · ${from ?? 'start'} → ${to ?? 'finish'}`}
                      </span>
                    </div>
                    {mealTotals.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">Nothing planned yet.</p>
                    ) : (
                      mealTotals.map(({ mealType, totals }) => (
                        <div key={mealType} className="mt-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {MEAL_TYPE_LABEL[mealType]}
                          </div>
                          {totals.map((t) => (
                            <div key={t.item.id} className="mt-1 pl-2">
                              <div className="flex items-baseline gap-2 text-sm">
                                <span className="font-medium text-gray-800">
                                  {t.item.brand && (
                                    <span className="text-gray-400">{t.item.brand} · </span>
                                  )}
                                  {t.item.name}
                                </span>
                                {t.portions.length > 1 && (
                                  <span className="text-xs tabular-nums text-gray-500">
                                    {fmtGrams(t.totalGrams)} total
                                  </span>
                                )}
                              </div>
                              <ul className="mt-0.5 space-y-0.5 text-sm">
                                {t.portions.map((p) => {
                                  const key = `${carry.index}:ing:${mealType}:${t.item.id}:${p.grams}`
                                  const isPrepped = prepped.has(key)
                                  return (
                                    <li key={key}>
                                      <label className="flex cursor-pointer items-baseline gap-2 pl-2">
                                        <input
                                          type="checkbox"
                                          className="shrink-0"
                                          checked={isPrepped}
                                          onChange={() => togglePrepped(key)}
                                        />
                                        <span
                                          className={isPrepped ? 'text-gray-400 line-through' : 'text-gray-800'}
                                        >
                                          {fmtPrepPortion(t.item, p)}
                                        </span>
                                      </label>
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="mt-2 text-xs text-gray-500">
            What to physically measure out before packing. "By recipe" groups identical meals —
            the same person eating it twice, or different people eating the same thing — into one
            recipe with a count, so you batch-prep instead of weighing each portion separately.
            "By ingredient" pivots the same recipes around each ingredient within each meal time
            instead, so you can measure out a shared item like oatmeal once for every breakfast
            that needs it, then divide it into the recipes. Tick-offs are saved and shared live;
            the two views track separate tick-offs.
          </p>
        </details>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            🎒 Packing list — per resupply carry
          </summary>

          <div className="mt-2 flex gap-1">
            <button
              onClick={() => setPackingView('flat')}
              className={
                packingView === 'flat'
                  ? 'rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white'
                  : 'rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600'
              }
            >
              Flat (combined)
            </button>
            <button
              onClick={() => setPackingView('nested')}
              className={
                packingView === 'nested'
                  ? 'rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white'
                  : 'rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600'
              }
            >
              By day / meal / hiker
            </button>
          </div>

          {packingView === 'flat' ? (
            <div className="mt-2 space-y-4">
              {carries.map((carry, i) => {
                const lines = carryShoppingList({
                  carry,
                  personIds,
                  entriesByKey,
                  mealsById,
                  itemsById,
                })
                const { from, to } = endpoints[i]
                const togglePacked = (key: string) => void toggleMark(trip.id, 'pack', key)
                return (
                  <div key={carry.index}>
                    <div className="flex items-baseline gap-2 border-b border-gray-200 pb-1 text-sm">
                      <span className="font-medium text-gray-800">
                        Carry {carry.index}
                        {(from || to) && ` · ${from ?? 'start'} → ${to ?? 'finish'}`}
                      </span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-gray-500">
                        {fmtGrams(perCarry[i].group.weightG)} total
                      </span>
                    </div>
                    {lines.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">Nothing planned yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {lines.map((l) => {
                          const key = `${carry.index}:${l.item.id}`
                          const isPacked = packed.has(key)
                          return (
                            <li key={l.item.id}>
                              <label className="flex cursor-pointer items-baseline gap-2">
                                <input
                                  type="checkbox"
                                  className="shrink-0"
                                  checked={isPacked}
                                  onChange={() => togglePacked(key)}
                                />
                                <span
                                  className={`min-w-0 flex-1 truncate ${isPacked ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                                >
                                  {l.item.brand && (
                                    <span className="text-gray-400">{l.item.brand} · </span>
                                  )}
                                  {l.item.name}
                                </span>
                                {l.units !== null && (
                                  <span
                                    className={`shrink-0 text-xs ${isPacked ? 'text-gray-400' : 'text-gray-500'}`}
                                  >
                                    {Math.round(l.units * 10) / 10}{' '}
                                    {(l.item.unitName || 'piece') + (l.units === 1 ? '' : 's')}
                                  </span>
                                )}
                                <span
                                  className={`w-16 shrink-0 text-right tabular-nums ${isPacked ? 'text-gray-400 line-through' : 'font-medium text-emerald-800'}`}
                                >
                                  {fmtGrams(l.grams)}
                                </span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-2 space-y-4">
              {carries.map((carry, i) => {
                const { from, to } = endpoints[i]
                const togglePacked = (key: string) => void toggleMark(trip.id, 'pack', key)
                // Carry.slots is already chronological (day, then slot within the
                // day), so grouping by consecutive dayIndex keeps that order.
                const dayGroups: { dayIndex: number; slots: SlotRef[] }[] = []
                for (const ref of carry.slots) {
                  const last = dayGroups[dayGroups.length - 1]
                  if (last && last.dayIndex === ref.dayIndex) last.slots.push(ref)
                  else dayGroups.push({ dayIndex: ref.dayIndex, slots: [ref] })
                }
                return (
                  <div key={carry.index}>
                    <div className="flex items-baseline gap-2 border-b border-gray-200 pb-1 text-sm">
                      <span className="font-medium text-gray-800">
                        Carry {carry.index}
                        {(from || to) && ` · ${from ?? 'start'} → ${to ?? 'finish'}`}
                      </span>
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-gray-500">
                        {fmtGrams(perCarry[i].group.weightG)} total
                      </span>
                    </div>
                    {dayGroups.map(({ dayIndex, slots }) => {
                      const day = trip.days.find((d) => d.index === dayIndex)
                      return (
                        <div key={dayIndex} className="mt-2">
                          <div className="text-sm font-medium text-gray-700">
                            {day ? dayLegLabel(day) : `Day ${dayIndex}`}
                          </div>
                          {slots.map((ref) => {
                            const perPersonLines = personIds
                              .map((pid) => ({
                                pid,
                                lines: entryItemLines(
                                  entriesByKey.get(planKey(pid, ref.dayIndex, ref.key)),
                                  mealsById,
                                  itemsById,
                                ),
                              }))
                              .filter((x) => x.lines.length > 0)
                            if (perPersonLines.length === 0) return null
                            return (
                              <div key={ref.key} className="mt-1 pl-3">
                                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                  {fmtSlot(ref.slot)}
                                </div>
                                <ul className="mt-0.5 space-y-0.5 text-sm">
                                  {perPersonLines.flatMap(({ pid, lines }) =>
                                    lines.map((l) => {
                                      const key = `${carry.index}:${ref.dayIndex}:${ref.key}:${pid}:${l.item.id}`
                                      const isPacked = packed.has(key)
                                      return (
                                        <li key={key}>
                                          <label className="flex cursor-pointer items-baseline gap-2 pl-2">
                                            <input
                                              type="checkbox"
                                              className="shrink-0"
                                              checked={isPacked}
                                              onChange={() => togglePacked(key)}
                                            />
                                            <span className="w-16 shrink-0 truncate text-xs font-medium text-gray-500">
                                              {peopleById.get(pid)?.name ?? pid}
                                            </span>
                                            <span
                                              className={`min-w-0 flex-1 truncate ${isPacked ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                                            >
                                              {l.item.brand && (
                                                <span className="text-gray-400">{l.item.brand} · </span>
                                              )}
                                              {l.item.name}
                                            </span>
                                            <span
                                              className={`w-16 shrink-0 text-right tabular-nums ${isPacked ? 'text-gray-400 line-through' : 'font-medium text-emerald-800'}`}
                                            >
                                              {fmtGrams(l.grams)}
                                            </span>
                                          </label>
                                        </li>
                                      )
                                    }),
                                  )}
                                </ul>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          <p className="mt-2 text-xs text-gray-500">
            What to put in each carry's resupply box. "Flat" combines everyone's food into one
            line per item, for buying/packing efficiently. "By day / meal / hiker" breaks it out
            per person, for checking the plan itself. Tick-offs are saved and shared live; the two
            views track separate tick-offs.
          </p>
        </details>

        {(() => {
          const missing = findMissingSlots({ days: trip.days, personIds, entriesByKey })
          if (missing.length === 0) return null
          const grouped = new Map<
            string,
            { dayIndex: number; slot: Slot; slotKey: string; names: string[] }
          >()
          for (const m of missing) {
            const gKey = `${m.dayIndex}:${m.slotKey}`
            const name = peopleById.get(m.personId)?.name ?? m.personId
            const existing = grouped.get(gKey)
            if (existing) existing.names.push(name)
            else grouped.set(gKey, { dayIndex: m.dayIndex, slot: m.slot, slotKey: m.slotKey, names: [name] })
          }
          const rows = [...grouped.values()].sort(
            (a, b) => a.dayIndex - b.dayIndex || a.slotKey.localeCompare(b.slotKey),
          )
          return (
            <details className="mt-3" open>
              <summary className="cursor-pointer text-sm font-medium text-amber-800">
                ⚠️ Missing — {missing.length} unplanned meal{missing.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-0.5 text-sm">
                {rows.map((r) => {
                  const day = trip.days.find((d) => d.index === r.dayIndex)
                  return (
                    <li key={`${r.dayIndex}:${r.slotKey}`} className="text-gray-700">
                      <span className="font-medium text-gray-800">
                        {day ? dayLegLabel(day) : `Day ${r.dayIndex}`}
                      </span>
                      {' · '}
                      {fmtSlot(r.slot)}
                      {' — '}
                      <span className="text-amber-800">{r.names.join(', ')}</span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-xs text-gray-500">
                Meal slots nobody has assigned any food to yet — add something in the Plan tab, or
                mark it off-trail if it's intentionally not carried.
              </p>
            </details>
          )
        })()}
      </section>
      )}
    </div>
  )
}

/** A carries-table cell: carry weight on top, calories beneath. */
function WeightCalCell({ weightG, calories }: { weightG: number; calories: number }) {
  return (
    <td className="py-1.5 pr-2 text-right tabular-nums">
      <div>{fmtGrams(weightG)}</div>
      <div className="text-xs font-normal text-gray-500">{fmtCalories(calories)}</div>
    </td>
  )
}

function DayCard({
  trip,
  day,
  person,
  entriesByKey,
  dayResupplies,
  meals,
  mealsById,
  itemsById,
  onGenerate,
}: {
  trip: Trip
  day: Day
  person: Person
  entriesByKey: ReadonlyMap<string, PlanEntry>
  dayResupplies: Resupply[]
  meals: Meal[]
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
  onGenerate: () => void
}) {
  const slots = keyedSlots(day)
  const dayEntries = slots
    .map((s) => entriesByKey.get(planKey(person.id, day.index, s.key)))
    .filter((e): e is PlanEntry => e !== undefined)

  const totals = dayTotals({
    day,
    person,
    factors: trip.dayTypeFactors,
    entries: dayEntries,
    mealsById,
    itemsById,
  })

  // Leg + distance/ascent meta line (Epic 19): the description reads better
  // with the raw itinerary numbers visible next to it.
  const legText = day.start || day.end || day.name ? dayLegLabel(day) : null
  const stats = [
    day.distanceKm != null ? `${day.distanceKm} km` : null,
    day.ascentM != null ? `↑ ${day.ascentM} m` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-3">
        <h4 className="font-semibold text-gray-800">
          Day {day.index}
          <span className="ml-2 font-normal text-gray-500">
            {day.type} · target {fmtCalories(totals.target)}
          </span>
        </h4>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[totals.status]}`}
        >
          {STATUS_LABELS[totals.status]} · {fmtCalories(totals.calories)} (
          {totals.delta >= 0 ? '+' : ''}
          {Math.round(totals.deltaPct * 100)}%) · {fmtGrams(totals.weightG)}
          {totals.weightG > 0 && ` · ${fmtDensity(totals.density)}`}
        </span>
        <button
          className="rounded border border-emerald-700 px-2 py-0.5 text-xs font-medium text-emerald-800 disabled:opacity-40"
          disabled={meals.length === 0}
          onClick={onGenerate}
          title="Fill unlocked slots; tap again to regenerate"
        >
          ✨ generate
        </button>
      </div>
      {(legText || stats) && (
        <p className="text-xs text-gray-600">
          {legText && <span className="font-medium">{legText}</span>}
          {legText && stats && ' · '}
          {stats && <span className="text-gray-500">{stats}</span>}
        </p>
      )}
      {day.description && (
        <p className="mb-2 mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs italic text-gray-600">
          {day.description}
        </p>
      )}
      {dayResupplies.length > 0 && (
        <div className="mb-2 mt-1 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-800">
          🛒 Resupply{' '}
          {dayResupplies
            .map((r) => `${r.location ? `${r.location} ` : ''}(${resupplyTimingLabel(r.timing)})`)
            .join(', ')}{' '}
          — a town stop is a chance to log a big off-trail meal in one go.
        </div>
      )}
      <CopyDayControl trip={trip} sourceDay={day} person={person} entriesByKey={entriesByKey} />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {slots.map((keyed) => (
          <SlotCell
            key={keyed.key}
            trip={trip}
            dayIndex={day.index}
            person={person}
            keyed={keyed}
            entry={entriesByKey.get(planKey(person.id, day.index, keyed.key))}
            meals={meals}
            mealsById={mealsById}
            itemsById={itemsById}
          />
        ))}
      </div>
    </section>
  )
}

/** Copy one day's slots onto chosen other days for this person (Epic 14) —
 *  build a representative day, then replicate it and just vary the dinners. */
function CopyDayControl({
  trip,
  sourceDay,
  person,
  entriesByKey,
}: {
  trip: Trip
  sourceDay: Day
  person: Person
  entriesByKey: ReadonlyMap<string, PlanEntry>
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const otherDays = trip.days.filter((d) => d.index !== sourceDay.index)

  const slotEntries = (day: Day): Map<string, PlanEntry> => {
    const m = new Map<string, PlanEntry>()
    for (const ks of keyedSlots(day)) {
      const e = entriesByKey.get(planKey(person.id, day.index, ks.key))
      if (e) m.set(ks.key, e)
    }
    return m
  }

  const hasContent = (e: PlanEntry) =>
    e.kind === 'offTrail' || (e.parts?.length ?? 0) > 0
  const sourceHasContent = [...slotEntries(sourceDay).values()].some(hasContent)

  function reset() {
    setOpen(false)
    setSelected(new Set())
  }

  async function apply() {
    const targets = [...selected]
      .map((i) => trip.days.find((d) => d.index === i))
      .filter((d): d is Day => d !== undefined)
      .map((day) => ({ day, existing: slotEntries(day) }))
    const plan = copyDayPlan({
      tripId: trip.id,
      personId: person.id,
      source: slotEntries(sourceDay),
      targets,
    })
    if (plan.overwrites > 0) {
      const ok = window.confirm(
        `Replace ${plan.overwrites} slot${plan.overwrites === 1 ? '' : 's'} that already ` +
          `have food on the selected day${selected.size === 1 ? '' : 's'}?` +
          (plan.skippedLocked > 0 ? ` (${plan.skippedLocked} locked slot(s) kept)` : ''),
      )
      if (!ok) return
    }
    await applyPlanWrites(plan.writes)
    reset()
  }

  if (!open) {
    return (
      <button
        className="mt-1 rounded border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-600 disabled:opacity-40"
        disabled={!sourceHasContent || otherDays.length === 0}
        onClick={() => setOpen(true)}
        title="Copy this day's plan to other days"
      >
        ⧉ copy to days…
      </button>
    )
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
      <span className="text-xs text-gray-600">copy day {sourceDay.index} to:</span>
      {otherDays.map((d) => (
        <label
          key={d.index}
          className={`cursor-pointer rounded px-1.5 py-0.5 text-xs ${
            selected.has(d.index)
              ? 'bg-emerald-700 text-white'
              : 'border border-gray-300 bg-white text-gray-600'
          }`}
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={selected.has(d.index)}
            onChange={() =>
              setSelected((s) => {
                const n = new Set(s)
                if (n.has(d.index)) n.delete(d.index)
                else n.add(d.index)
                return n
              })
            }
          />
          {d.index}
        </label>
      ))}
      <button
        className="text-xs text-emerald-700 underline"
        onClick={() => setSelected(new Set(otherDays.map((d) => d.index)))}
      >
        all
      </button>
      <button
        className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
        disabled={selected.size === 0}
        onClick={() => void apply()}
      >
        copy
      </button>
      <button className="text-xs text-gray-500 underline" onClick={reset}>
        cancel
      </button>
    </div>
  )
}

function SlotCell({
  trip,
  dayIndex,
  person,
  keyed,
  entry,
  meals,
  mealsById,
  itemsById,
}: {
  trip: Trip
  dayIndex: number
  person: Person
  keyed: KeyedSlot
  entry: PlanEntry | undefined
  meals: Meal[]
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}) {
  // Vegetarian people only see vegetarian meals/items (story 1.3).
  const eligibleMeals = meals
    .filter((m) => mealSlotTypes(m).includes(keyed.slot.type))
    .filter((m) => !person.vegetarian || rollUpMeal(m, itemsById).vegetarian)
    .sort((a, b) => a.name.localeCompare(b.name))
  const eligibleItems = [...itemsById.values()]
    .filter((i) => !person.vegetarian || i.vegetarian)
    .sort((a, b) => a.name.localeCompare(b.name))

  const loc = {
    tripId: trip.id,
    personId: person.id,
    dayIndex,
    slotKey: keyed.key,
    locked: entry?.locked,
  }
  const isOffTrail = entry?.kind === 'offTrail'
  const parts: PlanPart[] = entry?.kind === 'planned' ? (entry.parts ?? []) : []

  const setParts = (next: PlanPart[]) => void setPlannedSlot(loc, next)
  const removePart = (i: number) => setParts(parts.filter((_, idx) => idx !== i))
  const setItemGrams = (i: number, grams: number) =>
    setParts(parts.map((p, idx) => (idx === i && p.kind === 'item' ? { ...p, grams } : p)))

  function addPart(value: string) {
    if (value === OFF_TRAIL) {
      void setPlanEntry({ ...loc, kind: 'offTrail' })
    } else if (value.startsWith('m:')) {
      setParts([...parts, { kind: 'meal', mealId: value.slice(2) }])
    } else if (value.startsWith('i:')) {
      const item = itemsById.get(value.slice(2))
      const grams = item ? (defaultServingG(item) ?? item.inputWeightG) : 0
      setParts([...parts, { kind: 'item', itemId: value.slice(2), grams }])
    }
  }

  function partCalories(p: PlanPart): number {
    if (p.kind === 'meal') {
      const meal = mealsById.get(p.mealId)
      return meal ? rollUpMeal(meal, itemsById, p.quantityScale ?? 1).calories : 0
    }
    return p.grams * (itemsById.get(p.itemId)?.caloriesPerGram ?? 0)
  }

  const detail =
    entry && (parts.length > 0 || (isOffTrail && entry.offTrailCalories != null))
      ? entryTotals(entry, mealsById, itemsById)
      : null

  return (
    <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-600">{fmtSlot(keyed.slot)}</span>
        {detail && (
          <span className="text-xs tabular-nums text-gray-500">
            {fmtCalories(detail.calories)}
            {detail.weightG > 0 && ` · ${fmtGrams(detail.weightG)}`}
          </span>
        )}
        {(parts.length > 0 || isOffTrail) && (
          <label
            className="ml-auto flex shrink-0 items-center gap-0.5 text-xs text-gray-500"
            title="Locked slots survive generation"
          >
            <input
              type="checkbox"
              checked={entry?.locked ?? false}
              onChange={(e) =>
                void setPlanEntry({ ...entry!, locked: e.target.checked })
              }
            />
            lock
          </label>
        )}
      </div>

      {isOffTrail ? (
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span className="text-gray-600">off-trail (restaurant/town)</span>
          <input
            className="w-20 rounded border border-gray-300 px-1 py-0.5"
            inputMode="numeric"
            placeholder="est. cal"
            defaultValue={entry.offTrailCalories ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim()
              const cal = Number(v)
              void setPlanEntry({
                ...loc,
                kind: 'offTrail',
                offTrailCalories: v !== '' && Number.isFinite(cal) && cal >= 0 ? cal : undefined,
              })
            }}
          />
          <button
            className="text-xs text-gray-500 underline"
            onClick={() => void clearPlanEntry(trip.id, person.id, dayIndex, keyed.key)}
          >
            remove
          </button>
        </div>
      ) : (
        <>
          {parts.length > 0 && (
            <ul className="mt-1 space-y-1">
              {parts.map((p, i) => (
                <li
                  key={`${p.kind}:${p.kind === 'meal' ? p.mealId : p.itemId}:${i}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {p.kind === 'meal'
                      ? (mealsById.get(p.mealId)?.name ?? '— missing meal —')
                      : (itemsById.get(p.itemId)?.name ?? '— missing item —')}
                  </span>
                  {p.kind === 'item' && (
                    <>
                      <input
                        className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right"
                        inputMode="decimal"
                        defaultValue={p.grams}
                        onBlur={(e) => {
                          const g = Number(e.target.value)
                          if (Number.isFinite(g) && g >= 0) setItemGrams(i, g)
                        }}
                      />
                      <span className="text-xs text-gray-500">g</span>
                    </>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-gray-400">
                    {fmtCalories(partCalories(p))}
                  </span>
                  <button
                    className="shrink-0 text-xs text-red-700 underline"
                    onClick={() => removePart(i)}
                    title="remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <GroupedCombobox
            placeholder="+ add meal or item…"
            onSelect={addPart}
            options={[
              ...(parts.length === 0
                ? [{ value: OFF_TRAIL, label: 'off-trail (restaurant/town)', group: '' }]
                : []),
              ...eligibleMeals.map((m) => {
                const r = rollUpMeal(m, itemsById)
                return {
                  value: `m:${m.id}`,
                  label: m.name,
                  group: 'Meals',
                  hint: r.weightG > 0 ? fmtDensity(r.calories / r.weightG) : undefined,
                }
              }),
              ...eligibleItems.map((i) => ({
                value: `i:${i.id}`,
                label: i.name,
                sublabel: i.brand,
                group: 'Items',
                hint: fmtDensity(i.caloriesPerGram),
              })),
            ]}
          />
        </>
      )}
    </div>
  )
}
