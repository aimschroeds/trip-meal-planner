// Item CSV codec (stories 4.8, 4.10).
// Columns: name, weight_g, calories, vegetarian — weight/calories on any
// consistent basis, normalized to density on import. Export emits the raw
// entry values so a round-trip is lossless.

import Papa from 'papaparse'
import type { Item, MealType } from '../types'

export const ITEM_CSV_COLUMNS = ['name', 'weight_g', 'calories', 'vegetarian'] as const

/** Generation-bound and unit columns are optional on import (older exports
 *  lack them) but always emitted on export so round-trips stay lossless. */
export const ITEM_CSV_OPTIONAL_COLUMNS = [
  'brand',
  'min_grams',
  'max_grams',
  'unit_weight_g',
  'unit_name',
  'serving_g',
  'packaging_g',
  'gen_meal_types',
] as const

const MEAL_TYPES: MealType[] = ['brekkie', 'snack', 'lunch', 'dinner']

export interface CsvIssue {
  line: number
  reason: string
}

export interface ItemFields {
  name: string
  /** Optional new name (the `rename_to` column): rows match an existing item
   *  by `name`, then the item is renamed to this. Lets a CSV clean up names
   *  (e.g. pull the brand out) in place — same item id, meal links intact —
   *  instead of importing a renamed copy as a duplicate. */
  renameTo?: string
  brand?: string
  weightG: number
  calories: number
  vegetarian: boolean
  minGrams?: number
  maxGrams?: number
  unitWeightG?: number
  unitName?: string
  servingG?: number
  packagingG?: number
  genMealTypes?: MealType[]
}

export interface ParsedItemRow {
  line: number
  fields: ItemFields
}

export function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(v)) return true
  if (['false', 'no', 'n', '0'].includes(v)) return false
  return null
}

/** Bad rows are reported with line number and reason without blocking
 *  valid rows (story 4.8). Line numbers are 1-based including the header. */
export function parseItemsCsv(text: string): { rows: ParsedItemRow[]; issues: CsvIssue[] } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  })
  const rows: ParsedItemRow[] = []
  const issues: CsvIssue[] = []

  const missing = ITEM_CSV_COLUMNS.filter((c) => !parsed.meta.fields?.includes(c))
  if (missing.length > 0) {
    return { rows, issues: [{ line: 1, reason: `missing column(s): ${missing.join(', ')}` }] }
  }

  parsed.data.forEach((raw, i) => {
    const line = i + 2
    const name = (raw.name ?? '').trim()
    const renameTo = raw.rename_to?.trim() || undefined
    const brand = raw.brand?.trim() || undefined
    const weightG = Number(raw.weight_g)
    const calories = Number(raw.calories)
    const vegetarian = parseBool(raw.vegetarian ?? '')

    if (name === '') return issues.push({ line, reason: 'missing name' })
    if (raw.weight_g?.trim() === '' || !Number.isFinite(weightG) || weightG <= 0) {
      return issues.push({ line, reason: `weight_g must be a positive number, got "${raw.weight_g}"` })
    }
    if (raw.calories?.trim() === '' || !Number.isFinite(calories) || calories < 0) {
      return issues.push({ line, reason: `calories must be a non-negative number, got "${raw.calories}"` })
    }
    if (vegetarian === null) {
      return issues.push({ line, reason: `vegetarian must be true/false, got "${raw.vegetarian}"` })
    }

    const bound = (column: 'min_grams' | 'max_grams'): number | null | undefined => {
      const cell = raw[column]?.trim()
      if (cell === undefined || cell === '') return undefined
      const n = Number(cell)
      return Number.isFinite(n) && n >= 0 ? n : null // null = bad value
    }
    const minGrams = bound('min_grams')
    const maxGrams = bound('max_grams')
    if (minGrams === null) {
      return issues.push({ line, reason: `min_grams must be a non-negative number, got "${raw.min_grams}"` })
    }
    if (maxGrams === null) {
      return issues.push({ line, reason: `max_grams must be a non-negative number, got "${raw.max_grams}"` })
    }
    if (minGrams !== undefined && maxGrams !== undefined && minGrams > maxGrams) {
      return issues.push({ line, reason: `min_grams (${minGrams}) exceeds max_grams (${maxGrams})` })
    }

    const unitCell = raw.unit_weight_g?.trim()
    let unitWeightG: number | undefined
    if (unitCell !== undefined && unitCell !== '') {
      const n = Number(unitCell)
      if (!Number.isFinite(n) || n <= 0) {
        return issues.push({ line, reason: `unit_weight_g must be a positive number, got "${raw.unit_weight_g}"` })
      }
      unitWeightG = n
    }
    const unitName = raw.unit_name?.trim() || undefined

    const servingCell = raw.serving_g?.trim()
    let servingG: number | undefined
    if (servingCell !== undefined && servingCell !== '') {
      const n = Number(servingCell)
      if (!Number.isFinite(n) || n <= 0) {
        return issues.push({ line, reason: `serving_g must be a positive number, got "${raw.serving_g}"` })
      }
      servingG = n
    }

    const packagingCell = raw.packaging_g?.trim()
    let packagingG: number | undefined
    if (packagingCell !== undefined && packagingCell !== '') {
      const n = Number(packagingCell)
      if (!Number.isFinite(n) || n < 0) {
        return issues.push({ line, reason: `packaging_g must be a non-negative number, got "${raw.packaging_g}"` })
      }
      packagingG = n || undefined
    }

    const genCell = raw.gen_meal_types?.trim()
    let genMealTypes: MealType[] | undefined
    if (genCell !== undefined && genCell !== '') {
      const tokens = genCell.split(/[\s,|]+/).filter(Boolean)
      const bad = tokens.find((t) => !MEAL_TYPES.includes(t as MealType))
      if (bad !== undefined) {
        return issues.push({
          line,
          reason: `gen_meal_types must be ${MEAL_TYPES.join('/')}, got "${bad}"`,
        })
      }
      genMealTypes = [...new Set(tokens as MealType[])]
    }

    rows.push({
      line,
      fields: {
        name,
        renameTo,
        brand,
        weightG,
        calories,
        vegetarian,
        minGrams,
        maxGrams,
        unitWeightG,
        unitName,
        servingG,
        packagingG,
        genMealTypes,
      },
    })
  })

  return { rows, issues }
}

export type DuplicateResolution = 'skip' | 'update' | 'copy'

export interface ItemImportPlan {
  creates: ItemFields[]
  updates: { item: Item; fields: ItemFields }[]
  skipped: { line: number; name: string }[]
}

/** Apply the duplicate policy (story 4.8): duplicates vs the library or
 *  within the file are skipped, update the existing item, or imported as
 *  a renamed copy. Name matching is case-insensitive. */
export function planItemImport(
  rows: ParsedItemRow[],
  existing: Item[],
  resolution: DuplicateResolution,
): ItemImportPlan {
  const plan: ItemImportPlan = { creates: [], updates: [], skipped: [] }
  const existingByName = new Map(existing.map((i) => [i.name.toLowerCase(), i]))
  const takenNames = new Set(existing.map((i) => i.name.toLowerCase()))
  const plannedCreateByName = new Map<string, ItemFields>()
  const plannedUpdateById = new Map<string, { item: Item; fields: ItemFields }>()

  const copyName = (base: string): string => {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`
      if (!takenNames.has(candidate.toLowerCase())) return candidate
    }
  }

  for (const { line, fields } of rows) {
    const key = fields.name.toLowerCase()
    const inLibrary = existingByName.get(key)
    const inFile = plannedCreateByName.get(key)

    if (!inLibrary && !inFile) {
      plannedCreateByName.set(key, fields)
      takenNames.add(key)
      continue
    }
    switch (resolution) {
      case 'skip':
        plan.skipped.push({ line, name: fields.name })
        break
      case 'update':
        if (inLibrary) plannedUpdateById.set(inLibrary.id, { item: inLibrary, fields })
        else plannedCreateByName.set(key, fields) // later in-file row wins
        break
      case 'copy': {
        const renamed = { ...fields, name: copyName(fields.name) }
        plannedCreateByName.set(renamed.name.toLowerCase(), renamed)
        takenNames.add(renamed.name.toLowerCase())
        break
      }
    }
  }

  plan.creates = [...plannedCreateByName.values()]
  plan.updates = [...plannedUpdateById.values()]
  return plan
}

/** Same columns as import — an export re-imports without modification. */
export function itemsToCsv(items: Item[]): string {
  return Papa.unparse(
    items.map((i) => ({
      name: i.name,
      brand: i.brand ?? '',
      weight_g: i.inputWeightG,
      calories: i.inputCalories,
      vegetarian: i.vegetarian,
      min_grams: i.minGrams ?? '',
      max_grams: i.maxGrams ?? '',
      unit_weight_g: i.unitWeightG ?? '',
      unit_name: i.unitName ?? '',
      serving_g: i.servingG ?? '',
      packaging_g: i.packagingG ?? '',
      gen_meal_types: (i.genMealTypes ?? []).join(' '),
    })),
    { columns: [...ITEM_CSV_COLUMNS, ...ITEM_CSV_OPTIONAL_COLUMNS] },
  )
}
