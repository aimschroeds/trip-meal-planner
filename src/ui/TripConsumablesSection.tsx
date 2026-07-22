import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import {
  createTripConsumable,
  deleteTripConsumable,
  updateTripConsumable,
} from '../store/repos'
import { carryEndpoints, carryKey, deriveCarries } from '../domain/carries'
import { consumableLoadOnCarry, consumableMaxLoad, gearTotalG } from '../domain/gear'
import type { Person, Resupply, Trip, TripConsumable } from '../domain/types'
import { fmtGrams } from './format'

interface CarryOption {
  key: string
  short: string
  full: string
}

// Trip-only consumables — soap, fuel, sunscreen — that deplete on the trail.
// Deliberately separate from the gear library: their fill is trip- (and often
// leg-) specific. Each has a container (base) + a depleting amount, either the
// same on every carry or varied per carry. They flow into the Carries pack view.
export function TripConsumablesSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const consumables = useLiveQuery(
    () => db.tripConsumables.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as TripConsumable[],
  )
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as Resupply[],
  )

  const carries = deriveCarries(trip, resupplies)
  const carryEnds = carryEndpoints(carries, resupplies)
  const carryOptions: CarryOption[] = carries.map((c, i) => {
    const e = carryEnds[i]
    const where = e.from || e.to ? ` (${e.from ?? 'start'} → ${e.to ?? 'finish'})` : ''
    return { key: carryKey(c), short: `Carry ${c.index}`, full: `Carry ${c.index}${where}` }
  })
  const defaultPerson = people[0]?.id

  const sorted = [...consumables].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-800">Trip consumables</h3>
      <p className="text-sm text-gray-500">
        Soap, fuel, sunscreen — things that deplete and are specific to this trip, so they’re kept
        out of your gear library. <span className="font-medium">Base</span> is the container;{' '}
        <span className="font-medium">consumable</span> is what runs down. The load can differ per
        carry.
      </p>

      {people.length === 0 ? (
        <p className="text-sm text-gray-500">Add people in the Setup view first.</p>
      ) : (
        <>
          {sorted.length > 0 && (
            <ul className="space-y-1.5">
              {sorted.map((c) => (
                <ConsumableRow
                  key={c.id}
                  c={c}
                  people={people}
                  carryOptions={carryOptions}
                  carryKeys={carryOptions.map((o) => o.key)}
                />
              ))}
            </ul>
          )}

          <button
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={!defaultPerson}
            onClick={() => defaultPerson && void createTripConsumable(trip.id, defaultPerson)}
          >
            ➕ Add consumable
          </button>
        </>
      )}
    </section>
  )
}

const numInput = 'w-14 rounded border border-gray-300 px-1 py-0.5'

function ConsumableRow({
  c,
  people,
  carryOptions,
  carryKeys,
}: {
  c: TripConsumable
  people: Person[]
  carryOptions: CarryOption[]
  carryKeys: string[]
}) {
  const multi = people.length > 1
  const perCarry = carryOptions.length > 1
  const varying = c.carryLoads !== undefined
  const active = new Set(c.carryKeys ?? [])
  const everyCarry = active.size === 0
  const maxLoad = consumableMaxLoad(c, carryKeys)

  const upd = (patch: Partial<Omit<TripConsumable, 'id' | 'tripId'>>) =>
    void updateTripConsumable(c.id, patch)

  function toggleCarry(key: string) {
    const next = new Set(active)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    upd({ carryKeys: next.size ? [...next] : undefined })
  }
  function startVary() {
    const seed: Record<string, { baseG: number; consumableG: number }> = {}
    for (const o of carryOptions) {
      const load = consumableLoadOnCarry(c, o.key)
      seed[o.key] = { baseG: load?.baseG ?? 0, consumableG: load?.consumableG ?? 0 }
    }
    upd({ carryLoads: seed })
  }
  function stopVary() {
    const map = c.carryLoads ?? {}
    const kept = carryOptions.filter((o) => (map[o.key]?.baseG ?? 0) + (map[o.key]?.consumableG ?? 0) > 0)
    const maxBase = Math.max(0, ...carryOptions.map((o) => map[o.key]?.baseG ?? 0))
    const maxCons = Math.max(0, ...carryOptions.map((o) => map[o.key]?.consumableG ?? 0))
    const every = kept.length === carryOptions.length
    upd({
      baseG: maxBase,
      consumableG: maxCons,
      carryKeys: every ? undefined : kept.map((o) => o.key),
      carryLoads: undefined,
    })
  }
  function setCarryLoad(key: string, field: 'baseG' | 'consumableG', val: number) {
    const map = { ...(c.carryLoads ?? {}) }
    const entry = { baseG: map[key]?.baseG ?? 0, consumableG: map[key]?.consumableG ?? 0 }
    entry[field] = Math.max(0, val)
    map[key] = entry
    upd({ carryLoads: map })
  }

  return (
    <li className="rounded-md border border-gray-100 bg-gray-50/40 px-2.5 py-2">
      {/* Header: name + heaviest-leg total + remove. */}
      <div className="flex items-baseline gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-0.5 text-sm"
          placeholder="e.g. Soap, Fuel gas, Sunscreen"
          value={c.name}
          onChange={(e) => upd({ name: e.target.value })}
        />
        <span className="shrink-0 text-right text-sm tabular-nums text-gray-700" title="Heaviest leg">
          {fmtGrams(gearTotalG(maxLoad))}
          {perCarry && <span className="ml-1 text-xs font-normal text-gray-400">max</span>}
        </span>
        <button
          className="shrink-0 text-gray-400 hover:text-red-700"
          title="Remove"
          onClick={() => void deleteTripConsumable(c.id)}
        >
          ✕
        </button>
      </div>

      {/* Meta: carrier, category, shared. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        {multi && (
          <label className="flex items-center gap-1">
            <span className="text-gray-400">carried by</span>
            <select
              className="rounded border border-gray-300 px-1 py-0.5"
              value={c.personId}
              onChange={(e) => upd({ personId: e.target.value })}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1">
          <span className="text-gray-400">category</span>
          <input
            className="w-28 rounded border border-gray-300 px-1 py-0.5"
            list="consumable-cats"
            value={c.category}
            onChange={(e) => upd({ category: e.target.value || 'consumables' })}
          />
          <datalist id="consumable-cats">
            <option value="consumables" />
            <option value="cooking" />
            <option value="hygiene" />
          </datalist>
        </label>
        <label className="flex items-center gap-1" title="Shared party gear → split evenly in fair share">
          <input
            type="checkbox"
            checked={!!c.shared}
            onChange={(e) => upd({ shared: e.target.checked || undefined })}
          />
          shared
        </label>
      </div>

      {/* Load: single (base + consumable + carries) or per-carry grid. */}
      {!varying ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
          <label className="flex items-center gap-1" title="Container / packaging weight (base)">
            <span className="text-gray-400">base</span>
            <input
              type="number"
              min={0}
              className={numInput}
              value={c.baseG}
              onChange={(e) => upd({ baseG: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="text-gray-400">g</span>
          </label>
          <label className="flex items-center gap-1" title="Amount that depletes on the trail">
            <span className="text-gray-400">consumable</span>
            <input
              type="number"
              min={0}
              className={numInput}
              value={c.consumableG}
              onChange={(e) => upd({ consumableG: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="text-gray-400">g</span>
          </label>

          {perCarry && (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-gray-400">carries</span>
              <button
                onClick={() => upd({ carryKeys: undefined })}
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
                title="Different container/amount on different carries"
                className="text-gray-400 underline hover:text-gray-600"
              >
                vary by carry
              </button>
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-600">
          <span className="text-gray-400">load per carry</span>
          {carryOptions.map((o) => (
            <span
              key={o.key}
              className="flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5"
              title={o.full}
            >
              <span className="font-medium text-gray-500">{o.short.replace('Carry ', 'C')}</span>
              <span className="text-gray-400">base</span>
              <input
                type="number"
                min={0}
                className={numInput}
                value={c.carryLoads?.[o.key]?.baseG ?? 0}
                onChange={(e) => setCarryLoad(o.key, 'baseG', Number(e.target.value) || 0)}
              />
              <span className="text-gray-400">cons</span>
              <input
                type="number"
                min={0}
                className={numInput}
                value={c.carryLoads?.[o.key]?.consumableG ?? 0}
                onChange={(e) => setCarryLoad(o.key, 'consumableG', Number(e.target.value) || 0)}
              />
            </span>
          ))}
          <button
            onClick={stopVary}
            title="Use one load on every carry"
            className="text-gray-400 underline hover:text-gray-600"
          >
            same for all
          </button>
        </div>
      )}
    </li>
  )
}
