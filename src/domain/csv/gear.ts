// Gear CSV codec. Import is tolerant of LighterPack's export format (Item
// Name / Category / qty / weight / unit / worn / consumable) as well as this
// app's own columns (name / category / weight_g / worn_weight_g /
// consumable_weight_g / shared / brand). Export uses this app's own format.

import Papa from 'papaparse'
import type { GearItem } from '../types'
import type { CsvIssue } from './items'

export interface GearFields {
  name: string
  category: string
  weightG: number
  wornWeightG?: number
  consumableWeightG?: number
  shared?: boolean
  brand?: string
  owner?: string
}

export interface ParsedGearRow {
  line: number
  fields: GearFields
}

const UNIT_TO_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  kg: 1000,
}

function truthy(v: string | undefined): boolean {
  const t = (v ?? '').trim().toLowerCase()
  return t === '1' || t === 'true' || t === 'yes' || t === 'y' || t === 'x'
}

/** First non-empty value among the given header aliases. */
function pick(raw: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = raw[k]
    if (v !== undefined && v.trim() !== '') return v.trim()
  }
  return undefined
}

/** Parse a gear CSV. Line numbers are 1-based including the header. Bad rows
 *  are reported without blocking the good ones. */
export function parseGearCsv(text: string): { rows: ParsedGearRow[]; issues: CsvIssue[] } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  })
  const rows: ParsedGearRow[] = []
  const issues: CsvIssue[] = []

  const fields = parsed.meta.fields ?? []
  const hasName = ['name', 'item name', 'item', 'itemname'].some((c) => fields.includes(c))
  if (!hasName) {
    return { rows, issues: [{ line: 1, reason: 'missing a name column (name / Item Name)' }] }
  }

  parsed.data.forEach((raw, i) => {
    const line = i + 2
    const name = pick(raw, 'name', 'item name', 'item', 'itemname')
    if (!name) return issues.push({ line, reason: 'missing name' })

    const category = pick(raw, 'category') ?? 'misc'
    const brand = pick(raw, 'brand')
    const owner = pick(raw, 'owner')

    // Weight: prefer an explicit grams column; else LighterPack weight+unit×qty.
    let weightG: number
    const gramsCell = pick(raw, 'weight_g', 'grams')
    if (gramsCell !== undefined) {
      const n = Number(gramsCell)
      if (!Number.isFinite(n) || n <= 0) {
        return issues.push({ line, reason: `weight_g must be a positive number, got "${gramsCell}"` })
      }
      weightG = n
    } else {
      const weightCell = pick(raw, 'weight')
      const w = Number(weightCell)
      if (weightCell === undefined || !Number.isFinite(w) || w <= 0) {
        return issues.push({ line, reason: `weight must be a positive number, got "${weightCell ?? ''}"` })
      }
      const unit = (pick(raw, 'unit') ?? 'g').toLowerCase()
      const factor = UNIT_TO_G[unit]
      if (factor === undefined) {
        return issues.push({ line, reason: `unknown unit "${unit}" (use g/oz/lb/kg)` })
      }
      const qtyCell = pick(raw, 'qty', 'quantity')
      const qty = qtyCell !== undefined ? Number(qtyCell) : 1
      if (!Number.isFinite(qty) || qty <= 0) {
        return issues.push({ line, reason: `qty must be a positive number, got "${qtyCell}"` })
      }
      weightG = Math.round(w * factor * qty)
    }

    // Worn/consumable: explicit grams columns, else LighterPack booleans
    // (the whole item is worn / consumable).
    const wornCell = pick(raw, 'worn_weight_g')
    let wornWeightG = wornCell !== undefined ? Number(wornCell) : truthy(raw.worn) ? weightG : undefined
    if (wornWeightG !== undefined && (!Number.isFinite(wornWeightG) || wornWeightG < 0)) {
      return issues.push({ line, reason: `worn weight must be non-negative, got "${wornCell}"` })
    }
    if (wornWeightG === 0) wornWeightG = undefined

    const consCell = pick(raw, 'consumable_weight_g')
    let consumableWeightG =
      consCell !== undefined ? Number(consCell) : truthy(raw.consumable) ? weightG : undefined
    if (consumableWeightG !== undefined && (!Number.isFinite(consumableWeightG) || consumableWeightG < 0)) {
      return issues.push({ line, reason: `consumable weight must be non-negative, got "${consCell}"` })
    }
    if (consumableWeightG === 0) consumableWeightG = undefined

    rows.push({
      line,
      fields: {
        name,
        category,
        weightG,
        wornWeightG,
        consumableWeightG,
        shared: truthy(raw.shared) || undefined,
        brand,
        owner,
      },
    })
  })

  return { rows, issues }
}

export const GEAR_CSV_COLUMNS = [
  'name',
  'brand',
  'owner',
  'category',
  'weight_g',
  'worn_weight_g',
  'consumable_weight_g',
  'shared',
] as const

export function gearToCsv(gear: GearItem[]): string {
  return Papa.unparse(
    gear.map((g) => ({
      name: g.name,
      brand: g.brand ?? '',
      owner: g.owner ?? '',
      category: g.category,
      weight_g: g.weightG,
      worn_weight_g: g.wornWeightG ?? '',
      consumable_weight_g: g.consumableWeightG ?? '',
      shared: g.shared ? 'true' : '',
    })),
    { columns: [...GEAR_CSV_COLUMNS] },
  )
}
