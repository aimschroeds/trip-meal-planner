import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { commitItemImport, deleteItem, ItemInUseError } from '../store/repos'
import { calorieDensity } from '../domain/density'
import {
  itemsToCsv,
  parseItemsCsv,
  planItemImport,
  type CsvIssue,
  type DuplicateResolution,
  type ParsedItemRow,
} from '../domain/csv/items'
import type { ExtractedItem } from '../domain/extract'
import type { InputBasis, Item, MealType } from '../domain/types'
import { downloadCsv } from './download'
import { fmtDensity } from './format'
import { PhotoExtract } from './PhotoExtract'
import { fileInputClass } from './styles'
import { VegBadge } from './VegBadge'

const BASES: { value: InputBasis; label: string }[] = [
  { value: 'per_gram', label: 'per gram' },
  { value: 'per_100g', label: 'per 100 g' },
  { value: 'per_serving', label: 'per serving' },
  { value: 'per_package', label: 'per package' },
]

interface Draft {
  name: string
  brand: string
  basis: InputBasis
  weightG: string
  calories: string
  vegetarian: boolean
  /** Optional generation bounds; blank = unbounded. */
  minGrams: string
  maxGrams: string
  /** Optional piece weight + label; blank = item has no natural unit. */
  unitWeightG: string
  unitName: string
  /** Optional default serving the composer prefills; blank = derive it. */
  servingG: string
  /** Slot types generation may auto-place this item into; empty = never. */
  genMealTypes: MealType[]
}

const GEN_MEAL_TYPES: MealType[] = ['brekkie', 'lunch', 'dinner', 'snack']

const emptyDraft: Draft = {
  name: '',
  brand: '',
  basis: 'per_100g',
  weightG: '100',
  calories: '',
  vegetarian: true,
  minGrams: '',
  maxGrams: '',
  unitWeightG: '',
  unitName: '',
  servingG: '',
  genMealTypes: [],
}

/** Blank → undefined; otherwise a non-negative number or null when invalid. */
function draftBound(raw: string): number | undefined | null {
  if (raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function draftBounds(draft: Draft): { minGrams?: number; maxGrams?: number } | null {
  const minGrams = draftBound(draft.minGrams)
  const maxGrams = draftBound(draft.maxGrams)
  if (minGrams === null || maxGrams === null) return null
  if (minGrams !== undefined && maxGrams !== undefined && minGrams > maxGrams) return null
  return { minGrams, maxGrams }
}

/** Blank → no unit; otherwise the weight must be a positive number. */
function draftUnit(draft: Draft): { unitWeightG?: number; unitName?: string } | null {
  if (draft.unitWeightG.trim() === '') return {}
  const n = Number(draft.unitWeightG)
  if (!Number.isFinite(n) || n <= 0) return null
  return { unitWeightG: n, unitName: draft.unitName.trim() || undefined }
}

/** Blank → no explicit serving (composer derives one); otherwise positive. */
function draftServing(draft: Draft): { servingG?: number } | null {
  if (draft.servingG.trim() === '') return {}
  const n = Number(draft.servingG)
  if (!Number.isFinite(n) || n <= 0) return null
  return { servingG: n }
}

function fmtBounds(item: Item): string {
  if (item.minGrams !== undefined && item.maxGrams !== undefined)
    return `${item.minGrams}–${item.maxGrams} g`
  if (item.maxGrams !== undefined) return `≤ ${item.maxGrams} g`
  if (item.minGrams !== undefined) return `≥ ${item.minGrams} g`
  return '—'
}

function draftDensity(draft: Draft): number | null {
  const weightG = Number(draft.weightG)
  const calories = Number(draft.calories)
  if (draft.weightG === '' || draft.calories === '') return null
  try {
    return calorieDensity({ weightG, calories })
  } catch {
    return null
  }
}

type SortKey = 'name' | 'density'

export function ItemsPage() {
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [vegOnly, setVegOnly] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const density = draftDensity(draft)
  const bounds = draftBounds(draft)
  const unit = draftUnit(draft)
  const serving = draftServing(draft)
  const canSave =
    draft.name.trim() !== '' &&
    density !== null &&
    bounds !== null &&
    unit !== null &&
    serving !== null

  async function save() {
    if (density === null || bounds === null || unit === null || serving === null) return
    const item: Item = {
      id: editingId ?? crypto.randomUUID(),
      name: draft.name.trim(),
      brand: draft.brand.trim() || undefined,
      caloriesPerGram: density,
      vegetarian: draft.vegetarian,
      inputBasis: draft.basis,
      inputWeightG: Number(draft.weightG),
      inputCalories: Number(draft.calories),
      minGrams: bounds.minGrams,
      maxGrams: bounds.maxGrams,
      unitWeightG: unit.unitWeightG,
      unitName: unit.unitName,
      servingG: serving.servingG,
      genMealTypes: draft.genMealTypes.length > 0 ? draft.genMealTypes : undefined,
    }
    await db.items.put(item)
    setDraft(emptyDraft)
    setEditingId(null)
    setError(null)
  }

  function startEdit(item: Item) {
    setEditingId(item.id)
    setDraft({
      name: item.name,
      brand: item.brand ?? '',
      basis: item.inputBasis,
      weightG: String(item.inputWeightG),
      calories: String(item.inputCalories),
      vegetarian: item.vegetarian,
      minGrams: item.minGrams !== undefined ? String(item.minGrams) : '',
      maxGrams: item.maxGrams !== undefined ? String(item.maxGrams) : '',
      unitWeightG: item.unitWeightG !== undefined ? String(item.unitWeightG) : '',
      unitName: item.unitName ?? '',
      servingG: item.servingG !== undefined ? String(item.servingG) : '',
      genMealTypes: item.genMealTypes ?? [],
    })
    setError(null)
    // The form sits at the top of the page; bring it into view since the
    // edit button can be far down a long list.
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Photo extraction drafts into the add form for review — never saves. */
  function prefillFromPhotos(extracted: ExtractedItem) {
    setEditingId(null)
    setDraft({
      name: extracted.name,
      brand: extracted.brand ?? '',
      basis: 'per_package',
      weightG: extracted.weightG !== null ? String(extracted.weightG) : '',
      calories: extracted.calories !== null ? String(extracted.calories) : '',
      // Unknown diet defaults to non-vegetarian, like CSV stubs (story 4.9).
      vegetarian: extracted.vegetarian ?? false,
      minGrams: '',
      maxGrams: '',
      unitWeightG: '',
      unitName: '',
      servingG: '',
      genMealTypes: [],
    })
    setError(null)
  }

  async function remove(id: string) {
    try {
      await deleteItem(id)
      setError(null)
    } catch (e) {
      setError(e instanceof ItemInUseError ? `Cannot delete: ${e.message}` : String(e))
    }
  }

  const visible = items
    .filter((i) => !vegOnly || i.vegetarian)
    .sort((a, b) =>
      sortKey === 'name'
        ? a.name.localeCompare(b.name)
        : b.caloriesPerGram - a.caloriesPerGram,
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
          {editingId ? 'Edit item' : 'Add item'}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block grow">
            <span className="block text-sm text-gray-600">Name</span>
            <input
              className="mt-1 w-full min-w-72 rounded border border-gray-300 px-2 py-1"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Dal & rice with spinach"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Brand</span>
            <input
              className="mt-1 w-44 rounded border border-gray-300 px-2 py-1"
              value={draft.brand}
              onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
              placeholder="Firepot"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Entered</span>
            <select
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              value={draft.basis}
              onChange={(e) => setDraft({ ...draft, basis: e.target.value as InputBasis })}
            >
              {BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Weight (g)</span>
            <input
              className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              value={draft.weightG}
              onChange={(e) => setDraft({ ...draft, weightG: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Calories</span>
            <input
              className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              value={draft.calories}
              onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 pb-1.5">
            <input
              type="checkbox"
              checked={draft.vegetarian}
              onChange={(e) => setDraft({ ...draft, vegetarian: e.target.checked })}
            />
            <span className="text-sm text-gray-600">vegetarian</span>
          </label>
          <label className="block" title="Generation never scales this item below this many grams per meal">
            <span className="block text-sm text-gray-600">Gen min (g)</span>
            <input
              className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              placeholder="—"
              value={draft.minGrams}
              onChange={(e) => setDraft({ ...draft, minGrams: e.target.value })}
            />
          </label>
          <label className="block" title="Generation never scales this item above this many grams per meal (e.g. cap butter at 30)">
            <span className="block text-sm text-gray-600">Gen max (g)</span>
            <input
              className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              placeholder="—"
              value={draft.maxGrams}
              onChange={(e) => setDraft({ ...draft, maxGrams: e.target.value })}
            />
          </label>
          <label className="block" title="Default single serving the meal composer prefills when you pick this item; blank derives one from how the item was entered">
            <span className="block text-sm text-gray-600">Serving (g)</span>
            <input
              className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              placeholder="—"
              value={draft.servingG}
              onChange={(e) => setDraft({ ...draft, servingG: e.target.value })}
            />
          </label>
          <label className="block" title="Weight of one piece, so meals can be composed in pieces (e.g. one tortilla = 64 g)">
            <span className="block text-sm text-gray-600">Piece (g)</span>
            <input
              className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              placeholder="—"
              value={draft.unitWeightG}
              onChange={(e) => setDraft({ ...draft, unitWeightG: e.target.value })}
            />
          </label>
          <label className="block" title='What one piece is called, e.g. "tortilla" or "bar"'>
            <span className="block text-sm text-gray-600">Piece name</span>
            <input
              className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
              placeholder="tortilla"
              value={draft.unitName}
              onChange={(e) => setDraft({ ...draft, unitName: e.target.value })}
            />
          </label>
          <div
            className="block"
            title="Slots that plan generation may auto-fill with this item on its own (e.g. a freeze-dried dinner → dinner, a bar → snack). Leave all off to keep it manual-only."
          >
            <span className="block text-sm text-gray-600">Generate in</span>
            <div className="mt-1 flex flex-wrap gap-2 pt-1">
              {GEN_MEAL_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={draft.genMealTypes.includes(t)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        genMealTypes: e.target.checked
                          ? [...draft.genMealTypes, t]
                          : draft.genMealTypes.filter((x) => x !== t),
                      })
                    }
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <span className="pb-1.5 text-sm text-gray-500">
            {density !== null ? `= ${fmtDensity(density)}` : '—'}
          </span>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {editingId ? 'Save' : 'Add'}
          </button>
          {editingId && (
            <button
              type="button"
              className="pb-1.5 text-sm text-gray-500 underline"
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

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <PhotoExtract onExtract={prefillFromPhotos} />

      <ItemsImportExport items={items} />

      {/* Sort/filter sit directly above the list they control. */}
      {items.length > 0 && (
        <div className="flex items-center gap-4 border-b border-gray-200 pb-2 text-sm">
          <span className="font-medium text-gray-700">{items.length} items</span>
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

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">
          No items yet. This is your food library — add one above, import a CSV, or snap a photo of
          a label. Everything else (meals, plans) builds on items, so start here.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Entered as</th>
              <th className="py-1 pr-2 text-right">Density</th>
              <th className="py-1 pr-2 text-right">Gen bounds</th>
              <th className="py-1 pr-2">Diet</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                onClick={() => startEdit(item)}
                title="Edit this item"
              >
                <td className="py-1.5 pr-2">
                  <div className="font-medium text-emerald-800">{item.name}</div>
                  {item.brand && <div className="text-xs text-gray-400">{item.brand}</div>}
                </td>
                <td className="py-1.5 pr-2 text-gray-500">
                  {Math.round(item.inputCalories)} cal / {Math.round(item.inputWeightG)} g
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtDensity(item.caloriesPerGram)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-500">
                  {fmtBounds(item)}
                </td>
                <td className="py-1.5 pr-2">
                  <VegBadge vegetarian={item.vegetarian} />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    className="text-red-700 underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(item.id)
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

function ItemsImportExport({ items }: { items: Item[] }) {
  const [parsed, setParsed] = useState<{ rows: ParsedItemRow[]; issues: CsvIssue[] } | null>(null)
  const [resolution, setResolution] = useState<DuplicateResolution>('skip')
  const plan = parsed ? planItemImport(parsed.rows, items, resolution) : null

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
              if (file) void file.text().then((text) => setParsed(parseItemsCsv(text)))
              e.target.value = ''
            }}
          />
          <button
            className="text-emerald-700 underline disabled:text-gray-400"
            disabled={items.length === 0}
            onClick={() => downloadCsv('items.csv', itemsToCsv(items))}
          >
            export {items.length} items
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Columns: name, weight_g, calories, vegetarian — weight/calories on any consistent
          basis. Optional: brand, min_grams, max_grams (generation bounds), serving_g (default
          serving).
        </p>
        {parsed && plan && (
          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
            <p>
              <span className="font-medium">{plan.creates.length}</span> to create,{' '}
              <span className="font-medium">{plan.updates.length}</span> to update,{' '}
              <span className="font-medium">{plan.skipped.length}</span> skipped,{' '}
              <span className="font-medium">{parsed.issues.length}</span> bad rows
            </p>
            <label className="flex items-center gap-2">
              duplicates:
              <select
                className="rounded border border-gray-300 px-1 py-0.5"
                value={resolution}
                onChange={(e) => setResolution(e.target.value as DuplicateResolution)}
              >
                <option value="skip">skip</option>
                <option value="update">update existing</option>
                <option value="copy">import as copy</option>
              </select>
            </label>
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
                  void commitItemImport(plan).then(() => setParsed(null))
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
