import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { commitMealImport, deleteMeal, MealInUseError } from '../store/repos'
import { mealSlotTypes, rollUpMeal } from '../domain/rollups'
import { defaultServingG, gramsForUnits, unitsForGrams } from '../domain/units'
import { itemsToCsv, type CsvIssue, type DuplicateResolution } from '../domain/csv/items'
import {
  mealsToCsv,
  parseMealsCsv,
  planMealImport,
  type MissingItemPolicy,
  type ParsedMealGroup,
} from '../domain/csv/meals'
import type { Item, Meal, MealType } from '../domain/types'
import type { MealDraftMatch } from '../domain/mealText'
import { downloadCsv } from './download'
import { fmtCalories, fmtDensity, fmtGrams } from './format'
import { ItemCombobox } from './ItemCombobox'
import { MealTextBuilder } from './MealTextBuilder'
import { fileInputClass } from './styles'
import { VegBadge } from './VegBadge'

const MEAL_TYPES: MealType[] = ['brekkie', 'snack', 'lunch', 'dinner']

interface ComponentDraft {
  itemId: string
  grams: string
}

interface Draft {
  name: string
  /** Slot types this meal may be used in — at least one (Epic 18). */
  types: MealType[]
  components: ComponentDraft[]
}

const emptyDraft: Draft = { name: '', types: ['brekkie'], components: [] }

function draftToMeal(draft: Draft, id: string): Meal | null {
  if (draft.name.trim() === '') return null
  // Keep canonical order and dedupe; a meal needs at least one slot type.
  const types = MEAL_TYPES.filter((t) => draft.types.includes(t))
  if (types.length === 0) return null
  const components = []
  for (const c of draft.components) {
    if (c.itemId === '') continue // skip blank rows (e.g. the trailing rapid-entry row)
    const grams = Number(c.grams)
    if (!Number.isFinite(grams) || grams <= 0) return null
    components.push({ itemId: c.itemId, grams })
  }
  if (components.length === 0) return null
  return { id, name: draft.name.trim(), type: types[0], types, components }
}

type SortKey = 'name' | 'density'

export function MealsPage() {
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const meals = useLiveQuery(() => db.meals.toArray(), [], [] as Meal[])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<MealType | 'all'>('all')
  const [vegOnly, setVegOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  async function remove(id: string) {
    try {
      await deleteMeal(id)
      setError(null)
    } catch (e) {
      setError(e instanceof MealInUseError ? `Cannot delete: ${e.message}` : String(e))
    }
  }

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const previewMeal = draftToMeal(draft, 'preview')
  const preview = previewMeal ? rollUpMeal(previewMeal, itemsById) : null

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setDraft({
      ...draft,
      components: draft.components.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    })
  }

  function servingFor(itemId: string): string {
    const picked = itemsById.get(itemId)
    const serving = picked ? defaultServingG(picked) : undefined
    return serving !== undefined ? String(Math.round(serving * 10) / 10) : ''
  }

  // Rapid entry: picking an item prefills its serving (without clobbering a
  // typed value), and selecting in the last row appends a fresh row that
  // auto-focuses — so it's pick → grams → pick → … without reaching for the
  // "+ add item" button each time.
  function pickItem(index: number, itemId: string) {
    setDraft((d) => {
      const components = d.components.map((c, i) =>
        i === index ? { ...c, itemId, grams: c.grams.trim() === '' ? servingFor(itemId) : c.grams } : c,
      )
      if (itemId !== '' && index === components.length - 1) {
        components.push({ itemId: '', grams: '' })
      }
      return { ...d, components }
    })
  }

  /** Add one component per item id (multi-select), each at its default serving. */
  function addItems(itemIds: string[]) {
    if (itemIds.length === 0) return
    setDraft((d) => ({
      ...d,
      components: [
        ...d.components.filter((c) => c.itemId !== ''),
        ...itemIds.map((itemId) => ({ itemId, grams: servingFor(itemId) })),
        { itemId: '', grams: '' },
      ],
    }))
  }

  async function save() {
    const meal = draftToMeal(draft, editingId ?? crypto.randomUUID())
    if (!meal) return
    await db.meals.put(meal)
    setDraft(emptyDraft)
    setEditingId(null)
  }

  function startEdit(meal: Meal) {
    setEditingId(meal.id)
    setDraft({
      name: meal.name,
      types: mealSlotTypes(meal),
      components: meal.components.map((c) => ({ itemId: c.itemId, grams: String(c.grams) })),
    })
    // Bring the composer into view — the edit button can be far down the list.
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Save a batch of natural-language-built meals to the library (each already
   *  reviewed in the builder's preview). Unmatched foods are dropped; the user
   *  adds them by hand via the row → edit. */
  async function saveBuiltMeals(drafts: MealDraftMatch[]) {
    const newMeals: Meal[] = drafts
      .filter((d) => d.components.length > 0)
      .map((d) => ({
        id: crypto.randomUUID(),
        name: d.name,
        type: d.type,
        types: [d.type],
        components: d.components,
      }))
    if (newMeals.length > 0) await db.meals.bulkPut(newMeals)
  }

  /** Open a copy of a meal in the composer as a new (unsaved) meal. */
  function duplicate(meal: Meal) {
    setEditingId(null)
    setDraft({
      name: `${meal.name} (copy)`,
      types: mealSlotTypes(meal),
      components: meal.components.map((c) => ({ itemId: c.itemId, grams: String(c.grams) })),
    })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const rows = meals
    .map((meal) => ({ meal, rollup: rollUpMeal(meal, itemsById) }))
    .filter(({ meal }) => typeFilter === 'all' || mealSlotTypes(meal).includes(typeFilter))
    .filter(({ rollup }) => !vegOnly || rollup.vegetarian)
    .sort((a, b) =>
      sortKey === 'name'
        ? a.meal.name.localeCompare(b.meal.name)
        : b.rollup.density - a.rollup.density,
    )

  return (
    <div className="space-y-6">
      <form
        ref={formRef}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2 className="font-semibold text-gray-800">
          {editingId ? 'Edit meal' : 'Compose meal'}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block grow">
            <span className="block text-sm text-gray-600">Name</span>
            <input
              className="mt-1 w-full min-w-72 rounded border border-gray-300 px-2 py-1"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Standard oatmeal brekkie"
            />
          </label>
          <div className="block">
            <span className="block text-sm text-gray-600">Used for</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {MEAL_TYPES.map((t) => {
                const on = draft.types.includes(t)
                return (
                  <label
                    key={t}
                    className={`cursor-pointer rounded border px-2 py-1 text-sm ${
                      on
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-gray-300 bg-white text-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() =>
                        setDraft((d) => ({
                          ...d,
                          types: d.types.includes(t)
                            ? d.types.filter((x) => x !== t)
                            : [...d.types, t],
                        }))
                      }
                    />
                    {t}
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {draft.components.map((c, index) => (
            <div key={index} className="flex items-center gap-2">
              <ItemCombobox
                items={items}
                value={c.itemId}
                autoFocus={index === draft.components.length - 1 && c.itemId === ''}
                onSelect={(itemId) => pickItem(index, itemId)}
              />
              <input
                className="w-20 rounded border border-gray-300 px-2 py-1"
                inputMode="decimal"
                placeholder="g"
                value={c.grams}
                onChange={(e) => updateComponent(index, { grams: e.target.value })}
              />
              <span className="text-sm text-gray-500">g</span>
              <UnitHint item={itemsById.get(c.itemId)} grams={c.grams} onGrams={(g) => updateComponent(index, { grams: g })} />

              <button
                type="button"
                className="text-sm text-red-700 underline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    components: draft.components.filter((_, i) => i !== index),
                  })
                }
              >
                remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="text-sm text-emerald-700 underline disabled:text-gray-400"
              disabled={items.length === 0}
              onClick={() =>
                setDraft({ ...draft, components: [...draft.components, { itemId: '', grams: '' }] })
              }
            >
              + add item
            </button>
            <MultiAddItems items={items} onAdd={addItems} />
            {items.length === 0 && (
              <span className="text-sm text-gray-500">(add items in the Items tab first)</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {preview
              ? `${fmtGrams(preview.weightG)} · ${fmtCalories(preview.calories)} · ${fmtDensity(preview.density)}`
              : '—'}
          </span>
          {preview && <VegBadge vegetarian={preview.vegetarian} />}
          <button
            type="submit"
            disabled={!preview}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {editingId ? 'Save' : 'Add to library'}
          </button>
          {editingId && (
            <button
              type="button"
              className="text-sm text-gray-500 underline"
              onClick={() => {
                setEditingId(null)
                setDraft(emptyDraft)
              }}
            >
              cancel
            </button>
          )}
        </div>
      </form>

      <MealTextBuilder items={items} onSave={(drafts) => void saveBuiltMeals(drafts)} />

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <MealsImportExport items={items} meals={meals} />

      {/* Sort/filter sit directly above the list they control. */}
      {meals.length > 0 && (
        <div className="flex items-center gap-4 border-b border-gray-200 pb-2 text-sm">
          <span className="font-medium text-gray-700">{meals.length} meals</span>
          <label className="flex items-center gap-1">
            type
            <select
              className="rounded border border-gray-300 px-1 py-0.5"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as MealType | 'all')}
            >
              <option value="all">all</option>
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            sort by
            <select
              className="rounded border border-gray-300 px-1 py-0.5"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="name">name</option>
              <option value="density">density</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={vegOnly}
              onChange={(e) => setVegOnly(e.target.checked)}
            />
            vegetarian only
          </label>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          {meals.length === 0
            ? 'No meals yet. Combine items into a reusable meal above (e.g. a standard breakfast) — or skip this entirely and drop loose items straight into a day on a trip’s Plan view.'
            : 'No meals match.'}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Items</th>
              <th className="py-1 pr-2 text-right">Weight</th>
              <th className="py-1 pr-2 text-right">Calories</th>
              <th className="py-1 pr-2 text-right">Density</th>
              <th className="py-1 pr-2">Diet</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ meal, rollup }) => (
              <tr
                key={meal.id}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                onClick={() => startEdit(meal)}
                title="Edit this meal"
              >
                <td className="py-1.5 pr-2 font-medium text-emerald-800">{meal.name}</td>
                <td className="py-1.5 pr-2">{mealSlotTypes(meal).join(', ')}</td>
                <td className="py-1.5 pr-2 text-gray-500">
                  {meal.components
                    .map((c) => `${itemsById.get(c.itemId)?.name ?? '?'} ${Math.round(c.grams)}g`)
                    .join(', ')}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(rollup.weightG)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtCalories(rollup.calories)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtDensity(rollup.density)}
                </td>
                <td className="py-1.5 pr-2">
                  <VegBadge vegetarian={rollup.vegetarian} />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    className="mr-3 text-emerald-700 underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      duplicate(meal)
                    }}
                  >
                    duplicate
                  </button>
                  <button
                    className="text-red-700 underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(meal.id)
                    }}
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Pick several library items at once; each is added at its default serving. */
function MultiAddItems({ items, onAdd }: { items: Item[]; onAdd: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (items.length === 0) return null

  const q = query.trim().toLowerCase()
  const filtered = [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((i) => q === '' || i.name.toLowerCase().includes(q))

  function reset() {
    setOpen(false)
    setQuery('')
    setSelected(new Set())
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm text-emerald-700 underline"
        onClick={() => setOpen(true)}
      >
        + add several…
      </button>
    )
  }

  return (
    <div className="w-full rounded border border-gray-200 bg-gray-50 p-2">
      <input
        className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
        placeholder="filter items…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-48 overflow-auto">
        {filtered.length === 0 ? (
          <p className="px-1 py-1 text-sm text-gray-400">no match</p>
        ) : (
          filtered.map((i) => (
            <label key={i.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={selected.has(i.id)}
                onChange={() =>
                  setSelected((s) => {
                    const n = new Set(s)
                    if (n.has(i.id)) n.delete(i.id)
                    else n.add(i.id)
                    return n
                  })
                }
              />
              {i.name}
            </label>
          ))
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-emerald-700 px-2 py-0.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={selected.size === 0}
          onClick={() => {
            onAdd([...selected])
            reset()
          }}
        >
          add {selected.size || ''} selected
        </button>
        <button type="button" className="text-sm text-gray-500 underline" onClick={reset}>
          cancel
        </button>
      </div>
    </div>
  )
}

function MealsImportExport({ items, meals }: { items: Item[]; meals: Meal[] }) {
  const [parsed, setParsed] = useState<{ groups: ParsedMealGroup[]; issues: CsvIssue[] } | null>(
    null,
  )
  const [duplicates, setDuplicates] = useState<DuplicateResolution>('skip')
  const [missingItems, setMissingItems] = useState<MissingItemPolicy>('fail')
  const [includeItems, setIncludeItems] = useState(true)
  const plan = parsed ? planMealImport(parsed.groups, items, meals, { duplicates, missingItems }) : null

  function exportMeals() {
    const itemsById = new Map(items.map((i) => [i.id, i]))
    downloadCsv('meals.csv', mealsToCsv(meals, itemsById))
    if (includeItems) {
      const usedIds = new Set(meals.flatMap((m) => m.components.map((c) => c.itemId)))
      downloadCsv('items.csv', itemsToCsv(items.filter((i) => usedIds.has(i.id))))
    }
  }

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">
        Import / export CSV
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            className={fileInputClass}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void file.text().then((text) => setParsed(parseMealsCsv(text)))
              e.target.value = ''
            }}
          />
          <button
            className="text-emerald-700 underline disabled:text-gray-400"
            disabled={meals.length === 0}
            onClick={exportMeals}
          >
            export {meals.length} meals
          </button>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={includeItems}
              onChange={(e) => setIncludeItems(e.target.checked)}
            />
            include referenced items
          </label>
        </div>
        <p className="text-xs text-gray-500">
          One row per meal–item pair: meal_name, meal_type, item_name, quantity_g. Weight,
          calories, and vegetarian are computed from items, never imported.
        </p>
        {parsed && plan && (
          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
            <p>
              <span className="font-medium">{plan.creates.length}</span> meals to create,{' '}
              <span className="font-medium">{plan.updates.length}</span> to update,{' '}
              <span className="font-medium">{plan.skipped.length}</span> skipped,{' '}
              <span className="font-medium">{plan.stubs.length}</span> stub items,{' '}
              <span className="font-medium">{plan.failed.length}</span> failed,{' '}
              <span className="font-medium">{parsed.issues.length}</span> bad rows
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                duplicates:
                <select
                  className="rounded border border-gray-300 px-1 py-0.5"
                  value={duplicates}
                  onChange={(e) => setDuplicates(e.target.value as DuplicateResolution)}
                >
                  <option value="skip">skip</option>
                  <option value="update">update existing</option>
                  <option value="copy">import as copy</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                missing items:
                <select
                  className="rounded border border-gray-300 px-1 py-0.5"
                  value={missingItems}
                  onChange={(e) => setMissingItems(e.target.value as MissingItemPolicy)}
                >
                  <option value="fail">fail those meals</option>
                  <option value="stub">create stub items</option>
                </select>
              </label>
            </div>
            {plan.failed.length > 0 && (
              <ul className="list-inside list-disc text-xs text-red-700">
                {plan.failed.map((f) => (
                  <li key={f.name}>
                    {f.name}: missing {f.missingItems.join(', ')}
                  </li>
                ))}
              </ul>
            )}
            {parsed.issues.length > 0 && (
              <ul className="list-inside list-disc text-xs text-red-700">
                {parsed.issues.map((issue) => (
                  <li key={issue.line}>
                    line {issue.line}: {issue.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-3">
              <button
                className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-40"
                disabled={plan.creates.length === 0 && plan.updates.length === 0}
                onClick={() => {
                  void commitMealImport(plan).then(() => setParsed(null))
                }}
              >
                Import
              </button>
              <button className="text-gray-500 underline" onClick={() => setParsed(null)}>
                cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  )
}

/** Piece-aware quantity entry (PLAN.md §9.6): when the item has a unit
 *  weight, show a second input in pieces that writes back grams — grams
 *  stay the canonical stored value. */
function UnitHint({
  item,
  grams,
  onGrams,
}: {
  item: Item | undefined
  grams: string
  onGrams: (grams: string) => void
}) {
  if (!item || item.unitWeightG === undefined) return null
  const g = Number(grams)
  const units = grams !== '' && Number.isFinite(g) ? unitsForGrams(item, g) : null
  const label = item.unitName || 'piece'
  return (
    <label className="flex items-center gap-1 text-sm text-gray-500">
      =
      <input
        className="w-16 rounded border border-gray-300 px-2 py-1"
        inputMode="decimal"
        placeholder="—"
        value={units !== null ? String(Math.round(units * 100) / 100) : ''}
        onChange={(e) => {
          const u = Number(e.target.value)
          const converted = e.target.value === '' ? null : gramsForUnits(item, u)
          if (converted !== null) onGrams(String(Math.round(converted * 10) / 10))
        }}
      />
      {label}
      {units !== null && units !== 1 ? 's' : ''}
    </label>
  )
}
