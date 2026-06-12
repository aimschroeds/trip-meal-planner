// Full-database JSON backup codec (PLAN.md §8: IndexedDB is the only copy
// of user data). Export emits a versioned envelope; parse validates the
// envelope and entity shapes all-or-nothing — a backup either restores in
// full or is rejected with the first problem found.

import type { Item, Meal, Person, PlanEntry, Resupply, Trip } from './types'

export const BACKUP_FORMAT = 'hiking-meal-planner-backup'
export const BACKUP_VERSION = 1

/** Snapshot of every Dexie table. */
export interface BackupData {
  trips: Trip[]
  people: Person[]
  items: Item[]
  meals: Meal[]
  resupplies: Resupply[]
  planEntries: PlanEntry[]
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  data: BackupData
}

export const BACKUP_TABLES = [
  'trips',
  'people',
  'items',
  'meals',
  'resupplies',
  'planEntries',
] as const

export function serializeBackup(data: BackupData, exportedAt: Date): string {
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    data,
  }
  return JSON.stringify(file, null, 2)
}

export type ParseBackupResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; error: string }

type Raw = Record<string, unknown>

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** First shape problem in an entity, or null if it passes. Checks types of
 *  required fields; unknown extra fields are ignored (forward-compatible
 *  within a version). */
type EntityCheck = (e: Raw) => string | null

const str = (e: Raw, k: string) => (typeof e[k] === 'string' ? null : `${k} must be a string`)
const num = (e: Raw, k: string) =>
  typeof e[k] === 'number' && Number.isFinite(e[k] as number) ? null : `${k} must be a number`
const bool = (e: Raw, k: string) => (typeof e[k] === 'boolean' ? null : `${k} must be a boolean`)
const arr = (e: Raw, k: string) => (Array.isArray(e[k]) ? null : `${k} must be an array`)

function firstError(...checks: (string | null)[]): string | null {
  return checks.find((c) => c !== null) ?? null
}

const checkTrip: EntityCheck = (e) =>
  firstError(
    str(e, 'id'),
    str(e, 'name'),
    arr(e, 'days'),
    arr(e, 'peopleIds'),
    isRecord(e.dayTypeFactors) ? null : 'dayTypeFactors must be an object',
  )

const checkPerson: EntityCheck = (e) =>
  firstError(str(e, 'id'), str(e, 'name'), num(e, 'baselineCalories'), bool(e, 'vegetarian'))

const checkItem: EntityCheck = (e) =>
  firstError(
    str(e, 'id'),
    str(e, 'name'),
    num(e, 'caloriesPerGram'),
    bool(e, 'vegetarian'),
    str(e, 'inputBasis'),
    num(e, 'inputWeightG'),
    num(e, 'inputCalories'),
  )

const checkMeal: EntityCheck = (e) =>
  firstError(str(e, 'id'), str(e, 'name'), str(e, 'type'), arr(e, 'components'))

const checkResupply: EntityCheck = (e) =>
  firstError(str(e, 'id'), str(e, 'tripId'), num(e, 'dayIndex'), str(e, 'timing'))

const checkPlanEntry: EntityCheck = (e) =>
  firstError(
    str(e, 'id'),
    str(e, 'tripId'),
    str(e, 'personId'),
    num(e, 'dayIndex'),
    str(e, 'slotKey'),
    str(e, 'kind'),
  )

const ENTITY_CHECKS: Record<(typeof BACKUP_TABLES)[number], EntityCheck> = {
  trips: checkTrip,
  people: checkPerson,
  items: checkItem,
  meals: checkMeal,
  resupplies: checkResupply,
  planEntries: checkPlanEntry,
}

export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'not a backup file (expected a JSON object)' }
  if (raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: `not a backup file (missing format marker "${BACKUP_FORMAT}")` }
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `backup version ${String(raw.version)} is newer than this app supports (${BACKUP_VERSION}) — update the app first`,
    }
  }
  if (typeof raw.exportedAt !== 'string') {
    return { ok: false, error: 'missing exportedAt timestamp' }
  }
  if (!isRecord(raw.data)) return { ok: false, error: 'missing data section' }

  for (const table of BACKUP_TABLES) {
    const rows = raw.data[table]
    if (!Array.isArray(rows)) return { ok: false, error: `data.${table} must be an array` }
    const check = ENTITY_CHECKS[table]
    for (let i = 0; i < rows.length; i++) {
      const row: unknown = rows[i]
      if (!isRecord(row)) return { ok: false, error: `data.${table}[${i}] must be an object` }
      const problem = check(row)
      if (problem) return { ok: false, error: `data.${table}[${i}]: ${problem}` }
    }
  }

  return { ok: true, backup: raw as unknown as BackupFile }
}
