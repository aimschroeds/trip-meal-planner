import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { deleteGear, GearInUseError, setGearOwners } from '../store/repos'
import {
  GEAR_CATEGORIES,
  categoryLabel,
  gearWeightSplit,
  isBigThree,
  parseOwners,
} from '../domain/gear'
import type { GearItem } from '../domain/types'
import { fmtGrams } from './format'
import { GearImportExport } from './GearImportExport'

interface GearDraft {
  name: string
  brand: string
  owner: string
  category: string
  weightG: string
  wornWeightG: string
  consumableWeightG: string
  shared: boolean
}

const emptyDraft: GearDraft = {
  name: '',
  brand: '',
  owner: '',
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
    owner: (g.owners ?? []).join(', '),
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
  const [query, setQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOwner, setBulkOwner] = useState('')

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function applyBulkOwner(owners: string[] | undefined) {
    await setGearOwners([...selected], owners)
    setSelected(new Set())
    setBulkOwner('')
  }

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
      owners: parseOwners(draft.owner).length ? parseOwners(draft.owner) : undefined,
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

  // Distinct owners in the library, for the filter dropdown + the form datalist.
  const owners = [...new Set(gear.flatMap((g) => g.owners ?? []))].sort((a, b) => a.localeCompare(b))

  const q = query.trim().toLowerCase()
  const filtered = gear
    .filter((g) =>
      ownerFilter === 'all'
        ? true
        : ownerFilter === '__shared'
          ? !g.owners?.length
          : (g.owners ?? []).includes(ownerFilter),
    )
    .filter(
      (g) =>
        q === '' ||
        g.name.toLowerCase().includes(q) ||
        (g.brand ?? '').toLowerCase().includes(q) ||
        (g.owners ?? []).join(' ').toLowerCase().includes(q) ||
        categoryLabel(g.category).toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q),
    )

  // Group by category — Big 3 first, then alphabetical; items by name.
  const byCategory = new Map<string, GearItem[]>()
  for (const g of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = byCategory.get(g.category) ?? []
    list.push(g)
    byCategory.set(g.category, list)
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) =>
      Number(isBigThree(b)) - Number(isBigThree(a)) ||
      categoryLabel(a).localeCompare(categoryLabel(b)),
  )
  const totalG = filtered.reduce((n, g) => n + g.weightG, 0)
  const totalBaseG = filtered.reduce((n, g) => n + gearWeightSplit(g).baseG, 0)

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
            <span
              className="block text-sm text-gray-600"
              title="Whose personal gear this is; leave blank for shared group gear. Name several (comma-separated) for an identical item multiple people each bring. On a trip it auto-assigns to each matching person."
            >
              Owner(s)
            </span>
            <input
              className={`${inputClass} w-32`}
              list="gear-owners"
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              placeholder="e.g. Alice, Bob"
            />
            <datalist id="gear-owners">
              {owners.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
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

      <GearImportExport />

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
            <input
              type="search"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="search gear…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {owners.length > 0 && (
              <select
                className="rounded border border-gray-300 px-1 py-1 text-sm"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="all">all owners</option>
                <option value="__shared">shared (no owner)</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            <span className="text-sm text-gray-600 tabular-nums">
              {q ? `${filtered.length} of ${gear.length}` : `${gear.length} items`} ·{' '}
              {fmtGrams(totalG)} total · base {fmtGrams(totalBaseG)}
            </span>
            {filtered.length > 0 && (
              <button
                className="text-xs text-emerald-700 underline"
                onClick={() => setSelected(new Set(filtered.map((g) => g.id)))}
              >
                select all {filtered.length}
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-violet-300 bg-violet-50 p-2 text-sm">
              <span className="font-medium text-violet-900">{selected.size} selected</span>
              <span className="text-violet-900">· set owner(s):</span>
              <input
                className="rounded border border-gray-300 px-2 py-1"
                list="gear-owners"
                placeholder="e.g. Alice, Bob"
                value={bulkOwner}
                onChange={(e) => setBulkOwner(e.target.value)}
              />
              <button
                className="rounded bg-emerald-700 px-2 py-1 font-medium text-white disabled:opacity-50"
                disabled={parseOwners(bulkOwner).length === 0}
                onClick={() => void applyBulkOwner(parseOwners(bulkOwner))}
              >
                Apply
              </button>
              <button className="text-gray-600 underline" onClick={() => void applyBulkOwner(undefined)}>
                clear owner
              </button>
              <button className="ml-auto text-gray-500 underline" onClick={() => setSelected(new Set())}>
                deselect
              </button>
            </div>
          )}

          {filtered.length === 0 && (
            <p className="text-sm text-gray-500">No gear matches your search.</p>
          )}

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
                            <input
                              type="checkbox"
                              className="mr-2 align-middle"
                              aria-label={`Select ${g.name}`}
                              checked={selected.has(g.id)}
                              onChange={() => toggleSelected(g.id)}
                            />
                            {g.brand && <span className="text-gray-400">{g.brand} · </span>}
                            {g.name}
                            {g.owners?.length ? (
                              <span className="ml-1 rounded bg-violet-100 px-1 text-xs text-violet-800">
                                {g.owners.join(', ')}
                              </span>
                            ) : null}
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
