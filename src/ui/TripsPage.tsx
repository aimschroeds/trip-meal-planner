import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import {
  addPersonToTrip,
  createTrip,
  deleteTrip,
  removePersonFromTrip,
  updatePerson,
} from '../store/repos'
import { scaledDailyTarget } from '../domain/density'
import { activeDayFraction } from '../domain/totals'
import {
  hasMainSlot,
  snackCount,
  toggleMainSlot,
  withDayCount,
  withSnackCount,
  type MainMealType,
} from '../domain/trip'
import { classifyDayType, dayEffortKm } from '../domain/effort'
import { applyItinerary, parseItineraryCsv } from '../domain/csv/itinerary'
import { hasItinerary } from '../domain/dayDescription'
import { getApiKey } from '../extract/apiKey'
import type { CsvIssue } from '../domain/csv/items'
import type { Day, DayType, Person, Resupply, ResupplyTiming, Trip } from '../domain/types'
import { fmtCalories, fmtDate, RESUPPLY_TIMINGS, resupplyTimingLabel } from './format'
import { tripDayDate } from '../domain/dates'
import { PlanSection } from './PlanSection'
import { GearSection } from './GearSection'
import { PackBreakdown } from './PackBreakdown'
import { GearPackingList } from './GearPackingList'
import { fileInputClass } from './styles'
import { VegBadge } from './VegBadge'

const DAY_TYPES: DayType[] = ['small', 'average', 'big', 'huge']
const MAINS: MainMealType[] = ['brekkie', 'lunch', 'dinner']

export function TripsPage({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const trips = useLiveQuery(() => db.trips.toArray(), [], [] as Trip[])
  const [name, setName] = useState('')
  const [numDays, setNumDays] = useState('7')

  const selected = trips.find((t) => t.id === selectedId)
  if (selected) {
    return <TripDetail trip={selected} onBack={() => onSelect(null)} />
  }

  const days = Number(numDays)
  const canCreate = name.trim() !== '' && Number.isInteger(days) && days >= 1

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void createTrip(name.trim(), days).then(onSelect)
          setName('')
        }}
      >
        <label className="block">
          <span className="block text-sm text-gray-600">Trip name</span>
          <input
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="GR20 north"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Days</span>
          <input
            className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={numDays}
            onChange={(e) => setNumDays(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!canCreate}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Create trip
        </button>
      </form>

      {trips.length === 0 ? (
        <p className="text-sm text-gray-500">
          No trips yet. Create one above, then add who’s coming and their calorie targets and plan
          each day. Tip: add a few Foods (and optionally Meals) first so there’s food to plan with.
        </p>
      ) : (
        <ul className="space-y-2">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-3"
            >
              <button
                className="min-w-0 flex-1 truncate text-left font-medium text-emerald-800 underline"
                onClick={() => onSelect(trip.id)}
              >
                {trip.name}
              </button>
              <span className="shrink-0 text-sm text-gray-500">
                {trip.days.length} days · {trip.peopleIds.length} people
              </span>
              <button
                className="shrink-0 text-sm text-red-700 underline"
                onClick={() => void deleteTrip(trip.id)}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TripDetail({ trip, onBack }: { trip: Trip; onBack: () => void }) {
  const [view, setView] = useState<'setup' | 'days' | 'plan' | 'carries' | 'shopping'>('setup')
  const [descBusy, setDescBusy] = useState(false)
  const [descNote, setDescNote] = useState<string | null>(null)
  const people = useLiveQuery(
    () => db.people.where('id').anyOf(trip.peopleIds).toArray(),
    [trip.peopleIds.join()],
    [] as Person[],
  )

  async function update(patch: Partial<Trip>) {
    await db.trips.put({ ...trip, ...patch })
  }

  /** Generate a 1–2 sentence eating note per day from the itinerary (Epic 19).
   *  Needs the user's API key; days without a route/name are skipped. Runs both
   *  on demand (the Days header button) and automatically after a CSV import. */
  async function describeDays(days: Day[]) {
    const key = getApiKey()
    if (!key) {
      setDescNote('Add your Anthropic API key on the Backup tab to get day notes.')
      return
    }
    const describable = days.filter(hasItinerary)
    if (describable.length === 0) {
      setDescNote('Add start/end locations (or a leg name) to days first.')
      return
    }
    setDescBusy(true)
    setDescNote(null)
    const client = await import('../extract/dayDescription')
    try {
      const byDay = await client.describeDays(key, describable)
      await update({
        days: days.map((d) => (byDay.has(d.index) ? { ...d, description: byDay.get(d.index) } : d)),
      })
      setDescNote(`Described ${byDay.size} day${byDay.size === 1 ? '' : 's'}.`)
    } catch (e) {
      setDescNote(client.dayDescriptionErrorMessage(e))
    } finally {
      setDescBusy(false)
    }
  }

  async function updateDay(updated: Day) {
    await update({ days: trip.days.map((d) => (d.index === updated.index ? updated : d)) })
  }

  /** Edit a day's itinerary fields; when both distance and ascent are set,
   *  re-derive the day type from effort (Epic 15). */
  async function setDayItinerary(
    day: Day,
    patch: { name?: string; distanceKm?: number; ascentM?: number },
  ) {
    const next: Day = { ...day, ...patch }
    if (next.distanceKm != null && next.ascentM != null) {
      next.type = classifyDayType(dayEffortKm(next.distanceKm, next.ascentM))
    }
    await updateDay(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button className="text-sm text-gray-500 underline" onClick={onBack}>
          ← trips
        </button>
        <h2 className="text-xl font-bold text-gray-800">{trip.name}</h2>
        <nav className="flex gap-2">
          {(['setup', 'days', 'plan', 'carries', 'shopping'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                v === view
                  ? 'rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white'
                  : 'rounded border border-gray-300 px-3 py-1 text-sm text-gray-600'
              }
            >
              {v}
            </button>
          ))}
        </nav>
        {view === 'days' && (
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
            days
            <input
              className="w-16 rounded border border-gray-300 px-2 py-1"
              inputMode="numeric"
              value={trip.days.length}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isInteger(n) && n >= 1 && n <= 60) void update(withDayCount(trip, n))
              }}
            />
          </label>
        )}
      </div>

      {view === 'setup' && (
        <>
          <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-white p-4">
            <label className="text-sm text-gray-700">
              Start date
              <input
                type="date"
                className="ml-2 rounded border border-gray-300 px-2 py-1"
                value={trip.startDate ?? ''}
                onChange={(e) => void update({ startDate: e.target.value || undefined })}
              />
            </label>
            {trip.startDate ? (
              <span className="text-sm text-gray-500">
                Day 1 {fmtDate(tripDayDate(trip.startDate, 1)!)} → day {trip.days.length}{' '}
                {fmtDate(tripDayDate(trip.startDate, trip.days.length)!)}
              </span>
            ) : (
              <span className="text-sm text-gray-400">
                optional — set it to see the date of each day and resupply
              </span>
            )}
          </section>
          <PeopleSection trip={trip} people={people} />
          <FactorsSection trip={trip} onUpdate={update} />
          <ResuppliesSection trip={trip} />
        </>
      )}

      {view === 'plan' && <PlanSection trip={trip} people={people} section="plan" />}

      {view === 'carries' && (
        <>
          <GearSection trip={trip} people={people} />
          <PackBreakdown trip={trip} people={people} />
        </>
      )}

      {view === 'shopping' && (
        <>
          <PlanSection trip={trip} people={people} section="shopping" />
          <GearPackingList trip={trip} people={people} />
        </>
      )}

      {view === 'days' && (
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-gray-800">Days</h3>
          <button
            className="rounded border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-800 disabled:opacity-40"
            disabled={descBusy || !trip.days.some(hasItinerary)}
            onClick={() => void describeDays(trip.days)}
            title="Generate an AI eating note (lunch stops, passes, scenic highlights) for every day with a route"
          >
            {descBusy ? 'describing…' : '✨ describe days'}
          </button>
          {/* descNote reports the result of describe (manual or auto-on-import). */}
          {descNote && <span className="text-xs text-gray-600">{descNote}</span>}
        </div>
        <ItineraryUpload
          trip={trip}
          onApply={(days) => void update({ days })}
          onDescribe={describeDays}
        />
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Day</th>
              <th className="py-1 pr-2">Leg</th>
              <th className="py-1 pr-2 text-right">km</th>
              <th className="py-1 pr-2 text-right">↑ m</th>
              <th className="py-1 pr-2 text-right">effort</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Slots</th>
              <th className="py-1 pr-2">Snacks</th>
              {people.map((p) => (
                <th key={p.id} className="py-1 pr-2 text-right">
                  {p.name} target
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trip.days.map((day) => (
              <tr key={day.index} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 font-medium">
                  {day.index}
                  {tripDayDate(trip.startDate, day.index) && (
                    <span className="block text-xs font-normal whitespace-nowrap text-gray-400">
                      {fmtDate(tripDayDate(trip.startDate, day.index)!)}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    // Uncontrolled + commit on blur (like the km/ascent fields):
                    // a per-keystroke write round-trips through Dexie/liveQuery
                    // and the re-render jumps the caret to the end. Keyed on the
                    // stored value so external edits (CSV import) still refresh it.
                    key={`leg-${day.index}-${day.name ?? ''}`}
                    className="w-32 rounded border border-gray-300 px-1 py-0.5"
                    placeholder="—"
                    defaultValue={day.name ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      void setDayItinerary(day, { name: v === '' ? undefined : v })
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2 text-right">
                  <input
                    key={`km-${day.index}-${day.distanceKm ?? ''}`}
                    className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right"
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={day.distanceKm ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      const n = Number(v)
                      void setDayItinerary(day, {
                        distanceKm:
                          v === '' ? undefined : Number.isFinite(n) && n >= 0 ? n : day.distanceKm,
                      })
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2 text-right">
                  <input
                    key={`asc-${day.index}-${day.ascentM ?? ''}`}
                    className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right"
                    inputMode="numeric"
                    placeholder="—"
                    defaultValue={day.ascentM ?? ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      const n = Number(v)
                      void setDayItinerary(day, {
                        ascentM:
                          v === '' ? undefined : Number.isFinite(n) && n >= 0 ? n : day.ascentM,
                      })
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-500">
                  {day.distanceKm != null && day.ascentM != null
                    ? `${Math.round(dayEffortKm(day.distanceKm, day.ascentM))} km`
                    : '—'}
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    className="rounded border border-gray-300 px-1 py-0.5"
                    value={day.type}
                    onChange={(e) =>
                      void updateDay({ ...day, type: e.target.value as DayType })
                    }
                  >
                    {DAY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t} ({trip.dayTypeFactors[t]}×)
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  {MAINS.map((m) => (
                    <label key={m} className="mr-3 inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={hasMainSlot(day, m)}
                        onChange={() => void updateDay(toggleMainSlot(day, m))}
                      />
                      {m}
                    </label>
                  ))}
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="w-14 rounded border border-gray-300 px-1 py-0.5"
                    inputMode="numeric"
                    value={snackCount(day)}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n) && n >= 0 && n <= 12) {
                        void updateDay(withSnackCount(day, n))
                      }
                    }}
                  />
                </td>
                {people.map((p) => (
                  <td
                    key={p.id}
                    className="py-1.5 pr-2 text-right tabular-nums"
                    title="On-trail target = baseline × day factor × the share of meals checked on trail this day. Unchecked meals (eaten off trail) are discounted."
                  >
                    {fmtCalories(
                      scaledDailyTarget(p.baselineCalories, trip.dayTypeFactors[day.type]) *
                        activeDayFraction(day),
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">
          Uncheck slots on partial first/last days (e.g. off trail by lunch → brekkie + snacks
          only).
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Tip: each snack is one slot, but you fill it with a meal — and a meal can hold several
          items. So a single before-lunch snack of trail mix + a bar + dried fruit is one snack
          here. Dessert after dinner is easiest as part of your dinner meal; add an extra evening
          snack only if you want it tracked separately.
        </p>
      </section>
      )}
    </div>
  )
}

/** Bulk-set day legs, distance, and ascent from a CSV (Epic 15). Each day's
 *  type — and therefore the calorie target — is derived from its effort. */
function ItineraryUpload({
  trip,
  onApply,
  onDescribe,
}: {
  trip: Trip
  onApply: (days: Day[]) => void
  onDescribe: (days: Day[]) => void | Promise<void>
}) {
  const [result, setResult] = useState<{
    applied: number
    unmatched: number[]
    issues: CsvIssue[]
  } | null>(null)

  async function handle(text: string) {
    const { rows, issues } = parseItineraryCsv(text)
    const { days, unmatched } = applyItinerary(trip.days, rows)
    onApply(days)
    setResult({ applied: rows.length - unmatched.length, unmatched, issues })
    // Auto-describe right after a successful import (the user's chosen flow).
    if (rows.length - unmatched.length > 0) await onDescribe(days)
  }

  return (
    <details className="mb-3 rounded border border-gray-200 bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">
        Upload itinerary CSV
      </summary>
      <div className="mt-2 space-y-2 text-sm">
        <input
          type="file"
          accept=".csv,text/csv"
          className={fileInputClass}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void file.text().then(handle)
            e.target.value = ''
          }}
        />
        <p className="text-xs text-gray-500">
          Columns: <code>day, distance_km, ascent_m</code> (plus optional <code>name</code>,{' '}
          <code>start</code>, <code>end</code>). Each day's size is set from its effort — distance +
          ascent ÷ 100 m — which scales that day's calorie target. <code>start</code>/<code>end</code>{' '}
          feed the per-day AI note (the “describe days” button up by the Days heading) — lunch
          stops, named passes, and snack spots. It's a best-effort suggestion — sanity-check places.
        </p>
        {result && (
          <p className="text-xs text-gray-600">
            Applied {result.applied} day{result.applied === 1 ? '' : 's'}.
            {result.unmatched.length > 0 &&
              ` Skipped rows for days not in this trip: ${result.unmatched.join(', ')}.`}
            {result.issues.length > 0 &&
              ` ${result.issues.length} bad row(s): ${result.issues
                .map((i) => `line ${i.line} — ${i.reason}`)
                .join('; ')}.`}
          </p>
        )}
      </div>
    </details>
  )
}

function PeopleSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('2500')
  const [vegetarian, setVegetarian] = useState(false)

  const cal = Number(calories)
  const canAdd = name.trim() !== '' && Number.isFinite(cal) && cal > 0

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">People</h3>
      {people.length > 0 && (
        <ul className="mb-3 space-y-1">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <label className="flex items-center gap-1 text-gray-500" title="Edit this person's baseline — daily targets re-derive; the plan is untouched">
                <input
                  className="w-20 rounded border border-gray-300 px-2 py-0.5 text-right tabular-nums"
                  inputMode="numeric"
                  defaultValue={p.baselineCalories}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n > 0 && n !== p.baselineCalories) {
                      void updatePerson(p.id, { baselineCalories: n })
                    } else {
                      e.target.value = String(p.baselineCalories)
                    }
                  }}
                />
                cal/day baseline
              </label>
              <VegBadge vegetarian={p.vegetarian} />
              <button
                className="text-red-700 underline"
                onClick={() => void removePersonFromTrip(trip.id, p.id)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void addPersonToTrip(trip.id, {
            name: name.trim(),
            baselineCalories: cal,
            vegetarian,
          })
          setName('')
        }}
      >
        <label className="block">
          <span className="block text-sm text-gray-600">Name</span>
          <input
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Baseline cal/day</span>
          <input
            className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 pb-1.5">
          <input
            type="checkbox"
            checked={vegetarian}
            onChange={(e) => setVegetarian(e.target.checked)}
          />
          <span className="text-sm text-gray-600">vegetarian</span>
        </label>
        <button
          type="submit"
          disabled={!canAdd}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Add person
        </button>
      </form>
    </section>
  )
}

function ResuppliesSection({ trip }: { trip: Trip }) {
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).sortBy('dayIndex'),
    [trip.id],
    [] as Resupply[],
  )
  const [dayIndex, setDayIndex] = useState('1')
  const [timing, setTiming] = useState<ResupplyTiming>('before_breakfast')
  const [location, setLocation] = useState('')

  const day = Number(dayIndex)
  const canAdd = Number.isInteger(day) && day >= 1 && day <= trip.days.length

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">Resupplies</h3>
      {resupplies.length > 0 && (
        <ul className="mb-3 space-y-1">
          {resupplies.map((r) => (
            <li key={r.id} className="flex items-center gap-3 text-sm">
              <span>
                {r.location && <span className="font-medium">{r.location} — </span>}
                Day {r.dayIndex}
                {tripDayDate(trip.startDate, r.dayIndex) &&
                  ` (${fmtDate(tripDayDate(trip.startDate, r.dayIndex)!)})`}
                , {resupplyTimingLabel(r.timing)}
              </span>
              <button
                className="text-red-700 underline"
                onClick={() => void db.resupplies.delete(r.id)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void db.resupplies.add({
            id: crypto.randomUUID(),
            tripId: trip.id,
            dayIndex: day,
            timing,
            location: location.trim() || undefined,
          })
          setLocation('')
        }}
      >
        <label className="block">
          <span className="block text-sm text-gray-600">Day</span>
          <input
            className="mt-1 w-16 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={dayIndex}
            onChange={(e) => setDayIndex(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Timing</span>
          <select
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={timing}
            onChange={(e) => setTiming(e.target.value as ResupplyTiming)}
          >
            {RESUPPLY_TIMINGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Location</span>
          <input
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Vizzavona"
          />
        </label>
        <button
          type="submit"
          disabled={!canAdd}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Add resupply
        </button>
      </form>
    </section>
  )
}

function FactorsSection({
  trip,
  onUpdate,
}: {
  trip: Trip
  onUpdate: (patch: Partial<Trip>) => Promise<void>
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">Day-type scaling factors</h3>
      <div className="flex flex-wrap gap-4">
        {DAY_TYPES.map((t) => (
          <label key={t} className="block">
            <span className="block text-sm text-gray-600">{t}</span>
            <input
              className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              defaultValue={trip.dayTypeFactors[t]}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v > 0) {
                  void onUpdate({ dayTypeFactors: { ...trip.dayTypeFactors, [t]: v } })
                } else {
                  e.target.value = String(trip.dayTypeFactors[t])
                }
              }}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        A person's daily target = baseline × factor for the day's effort, then discounted to the
        meals checked on trail that day (unchecked meals are eaten off trail).
      </p>
    </section>
  )
}
