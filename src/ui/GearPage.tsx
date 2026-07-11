import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { deleteGear, GearInUseError } from '../store/repos'
import { GEAR_CATEGORIES, categoryLabel, gearWeightSplit, isBigThree } from '../domain/gear'
import type { GearItem } from '../domain/types'
import { fmtGrams } from './format'

interface GearDraft {
  name: string
  brand: string
  category: string
  weightG: string
  wornWeightG: string
  consumableWeightG: string
  shared: boolean
}

const emptyDraft: GearDraft = {
  name: '',
  brand: '',
  category: '',
  weightG: '',
  wornWeightG: '',
  consumableWeightG: '',
  shared: false,
}

function toDraft(g: GearItem): GearDraft {
  return {
    name: g.name,
    brand: g.brand ?? '',
    category: g.category,
    weightG: String(g.weightG),
    wornWeightG: g.wornWeightG != null ? String(g.wornWeightG) : '',
    consumableWeightG: g.consumableWeightG != null ? String(g.consumableWeightG) : '',
    shared: g.shared ?? false,
  }
}

/** Parse an optional non-negative grams field; '' → undefined, invalid → undefined. */
function num(s: string): number | undefined {
  const t = s.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const inputClass = 'mt-1 rounded border border-gray-300 px-2 py-1'

export function GearPage() {
  const gear = useLiveQuery(() => db.gear.toArray(), [], [] as GearItem[])
  const [draft, setDraft] = useState<GearDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const weightG = num(draft.weightG)
  const split =
    weightG != null && weightG > 0
      ? gearWeightSplit({
          weightG,
          wornWeightG: num(draft.wornWeightG),
          consumableWeightG: num(draft.consumableWeightG),
        })
      : null

  function reset() {
    setDraft(emptyDraft)
    setEditingId(null)
    setError(null)
  }

  function edit(g: GearItem) {
    setDraft(toDraft(g))
    setEditingId(g.id)
    setError(null)
  }

  async function remove(id: string) {
    try {
      await deleteGear(id)
      if (id === editingId) reset()
    } catch (e) {
      setError(e instanceof GearInUseError ? e.message : String(e))
    }
  }

  async function save() {
    const name = draft.name.trim()
    if (!name) return setError('Name is required.')
    if (weightG == null || weightG <= 0) return setError('Enter a total weight in grams.')
    const worn = num(draft.wornWeightG) ?? 0
    const consumable = num(draft.consumableWeightG) ?? 0
    if (worn + consumable > weightG) {
      return setError('Worn + consumable can’t exceed the total weight.')
    }
    const item: GearItem = {
      id: editingId ?? crypto.randomUUID(),
      name,
      brand: draft.brand.trim() || undefined,
      category: draft.category.trim() || 'misc',
      weightG,
      wornWeightG: worn || undefined,
      consumableWeightG: consumable || undefined,
      shared: draft.shared || undefined,
    }
    await db.gear.put(item)
    reset()
  }

  /** Start a fresh entry pre-set to a category (adds under that heading). */
  function addInCategory(category: string) {
    setDraft({ ...emptyDraft, category })
    setEditingId(null)
    setError(null)
  }

  // Group by category — Big 3 first, then alphabetical; items by name.
  const byCategory = new Map<string, GearItem[]>()
  for (const g of [...gear].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = byCategory.get(g.category) ?? []
    list.push(g)
    byCategory.set(g.category, list)
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) =>
      Number(isBigThree(b)) - Number(isBigThree(a)) ||
      categoryLabel(a).localeCompare(categoryLabel(b)),
  )
  const totalG = gear.reduce((n, g) => n + g.weightG, 0)
  const totalBaseG = gear.reduce((n, g) => n + gearWeightSplit(g).baseG, 0)

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-800">{editingId ? 'Edit gear' : 'Add gear'}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-sm text-gray-600">Name</span>
            <input
              className={`${inputClass} w-48`}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Zpacks Duplex"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Brand</span>
            <input
              className={`${inputClass} w-32`}
              value={draft.brand}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
              placeholder="optional"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Category</span>
            <input
              className={`${inputClass} w-36`}
              list="gear-categories"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="shelter"
            />
            <datalist id="gear-categories">
              {GEAR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Total g</span>
            <input
              className={`${inputClass} w-20`}
              inputMode="numeric"
              value={draft.weightG}
              onChange={(e) => setDraft({ ...draft, weightG: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600" title="Worn on the body, not in the pack">
              Worn g
            </span>
            <input
              className={`${inputClass} w-20`}
              inputMode="numeric"
              value={draft.wornWeightG}
              onChange={(e) => setDraft({ ...draft, wornWeightG: e.target.value })}
              placeholder="0"
            />
          </label>
          <label className="block">
            <span
              className="block text-sm text-gray-600"
              title="Depletes on trail — e.g. fuel gas in a canister"
            >
              Consumable g
            </span>
            <input
              className={`${inputClass} w-24`}
              inputMode="numeric"
              value={draft.consumableWeightG}
              onChange={(e) => setDraft({ ...draft, consumableWeightG: e.target.value })}
              placeholder="0"
            />
          </label>
          <label className="mb-1 flex items-center gap-1.5 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={draft.shared}
              onChange={(e) => setDraft({ ...draft, shared: e.target.checked })}
            />
            <span title="Group gear one person carries for everyone (tent, pot)">shared</span>
          </label>
        </div>
        {split && (
          <p className="text-xs text-gray-500">
            Base {fmtGrams(split.baseG)} · worn {fmtGrams(split.wornG)} · consumable{' '}
            {fmtGrams(split.consumableG)}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => void save()}
          >
            {editingId ? 'Save changes' : 'Add to gear'}
          </button>
          {editingId && (
            <button className="text-sm text-gray-500 underline" onClick={reset}>
              cancel
            </button>
          )}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      </section>

      {gear.length === 0 ? (
        <p className="text-sm text-gray-500">
          No gear yet. Add your kit above — a category (shelter, sleep, pack = the “big 3”), the
          total weight, and how much of it is worn or consumable (fuel gas, soap). You’ll then be
          able to pick gear per trip and see full base/worn/consumable weight alongside food.
        </p>
      ) : (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold text-gray-800">Your gear</h2>
            <span className="text-sm text-gray-600 tabular-nums">
              {gear.length} items · {fmtGrams(totalG)} total · base {fmtGrams(totalBaseG)}
            </span>
          </div>

          {categories.map((category) => {
            const list = byCategory.get(category)!
            const catTotal = list.reduce((n, g) => n + g.weightG, 0)
            return (
              <div key={category}>
                <div className="mb-1 flex items-baseline gap-2 border-b border-gray-200 pb-0.5">
                  <h3 className="font-medium text-gray-800">
                    {categoryLabel(category)}
                    {isBigThree(category) && (
                      <span className="ml-1 rounded bg-emerald-50 px-1 text-xs text-emerald-800">
                        big 3
                      </span>
                    )}
                  </h3>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {list.length} · {fmtGrams(catTotal)}
                  </span>
                  <button
                    className="ml-auto text-xs text-emerald-700 underline"
                    onClick={() => addInCategory(category)}
                  >
                    + add here
                  </button>
                </div>
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {list.map((g) => {
                      const s = gearWeightSplit(g)
                      return (
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
                          <td
                            className="py-1.5 pr-2 text-right tabular-nums"
                            title="total weight"
                          >
                            {fmtGrams(g.weightG)}
                          </td>
                          <td
                            className="py-1.5 pr-2 text-right tabular-nums text-gray-500"
                            title="worn / consumable"
                          >
                            {[s.wornG && `${fmtGrams(s.wornG)} worn`, s.consumableG && `${fmtGrams(s.consumableG)} consum.`]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                            <button className="text-emerald-700 underline" onClick={() => edit(g)}>
                              edit
                            </button>
                            <button
                              className="ml-3 text-red-700 underline"
                              onClick={() => void remove(g.id)}
                            >
                              delete
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
