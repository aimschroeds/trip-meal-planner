// Meal CSV codec (stories 4.9, 4.10).
// One row per meal–item pair: meal_name, meal_type, item_name, quantity_g.
// Rows sharing a meal_name form one meal. Weight/calories/density/vegetarian
// are computed from items, never imported.

import Papa from 'papaparse'
import { mealSlotTypes } from '../rollups'
import type { Item, Meal, MealType } from '../types'
import type { CsvIssue, DuplicateResolution } from './items'

export const MEAL_CSV_COLUMNS = ['meal_name', 'meal_type', 'item_name', 'quantity_g'] as const

const MEAL_TYPES: MealType[] = ['brekkie', 'snack', 'lunch', 'dinner']

/** Parse a meal_type cell into one or more slot types. A meal usable in
 *  several slots is written pipe-separated ("lunch|dinner"); a single value
 *  stays backward compatible. Returns null if empty or any token is invalid;
 *  the result is deduped and in canonical order. */
function parseMealTypes(cell: string): MealType[] | null {
  const tokens = cell
    .split('|')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== '')
  if (tokens.length === 0 || tokens.some((t) => !MEAL_TYPES.includes(t as MealType))) return null
  return MEAL_TYPES.filter((t) => tokens.includes(t))
}

const sameTypes = (a: MealType[], b: MealType[]) =>
  a.length === b.length && a.every((t, i) => t === b[i])

export interface ParsedMealGroup {
  name: string
  types: MealType[]
  firstLine: number
  components: { itemName: string; grams: number }[]
}

export function parseMealsCsv(text: string): { groups: ParsedMealGroup[]; issues: CsvIssue[] } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  })
  const issues: CsvIssue[] = []
  const groups = new Map<string, ParsedMealGroup>()

  const missing = MEAL_CSV_COLUMNS.filter((c) => !parsed.meta.fields?.includes(c))
  if (missing.length > 0) {
    return { groups: [], issues: [{ line: 1, reason: `missing column(s): ${missing.join(', ')}` }] }
  }

  parsed.data.forEach((raw, i) => {
    const line = i + 2
    const name = (raw.meal_name ?? '').trim()
    const types = parseMealTypes(raw.meal_type ?? '')
    const itemName = (raw.item_name ?? '').trim()
    const grams = Number(raw.quantity_g)

    if (name === '') return issues.push({ line, reason: 'missing meal_name' })
    if (!types) {
      return issues.push({
        line,
        reason: `meal_type must be one or more of ${MEAL_TYPES.join('/')} (pipe-separated), got "${raw.meal_type}"`,
      })
    }
    if (itemName === '') return issues.push({ line, reason: 'missing item_name' })
    if (raw.quantity_g?.trim() === '' || !Number.isFinite(grams) || grams <= 0) {
      return issues.push({
        line,
        reason: `quantity_g must be a positive number, got "${raw.quantity_g}"`,
      })
    }

    const key = name.toLowerCase()
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { name, types, firstLine: line, components: [{ itemName, grams }] })
    } else if (!sameTypes(group.types, types)) {
      issues.push({
        line,
        reason: `meal_type "${types.join('|')}" conflicts with "${group.types.join('|')}" for meal "${group.name}" (line ${group.firstLine})`,
      })
    } else {
      group.components.push({ itemName, grams })
    }
  })

  return { groups: [...groups.values()], issues }
}

export type MissingItemPolicy = 'fail' | 'stub'

export interface MealFields {
  name: string
  types: MealType[]
  /** Resolved by name at commit time (stubs may not exist yet). */
  components: { itemName: string; grams: number }[]
}

export interface MealImportPlan {
  creates: MealFields[]
  updates: { meal: Meal; fields: MealFields }[]
  skipped: string[]
  /** Meals dropped because items are missing under the 'fail' policy. */
  failed: { name: string; missingItems: string[] }[]
  /** Item names to auto-create as stubs under the 'stub' policy. */
  stubs: string[]
}

export function planMealImport(
  groups: ParsedMealGroup[],
  items: Item[],
  existingMeals: Meal[],
  opts: { duplicates: DuplicateResolution; missingItems: MissingItemPolicy },
): MealImportPlan {
  const plan: MealImportPlan = { creates: [], updates: [], skipped: [], failed: [], stubs: [] }
  const itemNames = new Set(items.map((i) => i.name.toLowerCase()))
  const mealsByName = new Map(existingMeals.map((m) => [m.name.toLowerCase(), m]))
  const stubSet = new Set<string>()

  const copyName = (base: string): string => {
    const taken = new Set([
      ...mealsByName.keys(),
      ...plan.creates.map((c) => c.name.toLowerCase()),
    ])
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`
      if (!taken.has(candidate.toLowerCase())) return candidate
    }
  }

  for (const group of groups) {
    const missingItems = [
      ...new Set(
        group.components
          .map((c) => c.itemName)
          .filter((n) => !itemNames.has(n.toLowerCase()) && !stubSet.has(n.toLowerCase())),
      ),
    ]
    if (missingItems.length > 0 && opts.missingItems === 'fail') {
      plan.failed.push({ name: group.name, missingItems })
      continue
    }
    for (const n of missingItems) {
      stubSet.add(n.toLowerCase())
      plan.stubs.push(n)
    }

    const fields: MealFields = {
      name: group.name,
      types: group.types,
      components: group.components,
    }
    const existing = mealsByName.get(group.name.toLowerCase())
    const inFile = plan.creates.some((c) => c.name.toLowerCase() === group.name.toLowerCase())
    if (!existing && !inFile) {
      plan.creates.push(fields)
    } else {
      switch (opts.duplicates) {
        case 'skip':
          plan.skipped.push(group.name)
          break
        case 'update':
          if (existing) plan.updates.push({ meal: existing, fields })
          break
        case 'copy':
          plan.creates.push({ ...fields, name: copyName(group.name) })
          break
      }
    }
  }

  return plan
}

/** Same columns as import for a lossless round-trip (story 4.10). */
export function mealsToCsv(meals: Meal[], itemsById: ReadonlyMap<string, Item>): string {
  const rows = meals.flatMap((meal) =>
    meal.components.map((c) => ({
      meal_name: meal.name,
      meal_type: mealSlotTypes(meal).join('|'),
      item_name: itemsById.get(c.itemId)?.name ?? c.itemId,
      quantity_g: c.grams,
    })),
  )
  return Papa.unparse(rows, { columns: [...MEAL_CSV_COLUMNS] })
}
