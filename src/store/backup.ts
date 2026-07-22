// Full-database export/restore. Restore is wholesale replacement inside a
// single transaction — the UI confirms before calling it, and a failed
// restore rolls back leaving existing data untouched.

import { db } from './db'
import { normalizePlanEntry, type BackupData } from '../domain/backup'

const ALL_TABLES = [
  db.trips,
  db.people,
  db.items,
  db.meals,
  db.resupplies,
  db.planEntries,
  db.gear,
  db.gearCollections,
  db.tripConsumables,
]

export async function exportBackup(): Promise<BackupData> {
  return db.transaction('r', ALL_TABLES, async () => ({
    trips: await db.trips.toArray(),
    people: await db.people.toArray(),
    items: await db.items.toArray(),
    meals: await db.meals.toArray(),
    resupplies: await db.resupplies.toArray(),
    planEntries: await db.planEntries.toArray(),
    gear: await db.gear.toArray(),
    gearCollections: await db.gearCollections.toArray(),
    tripConsumables: await db.tripConsumables.toArray(),
  }))
}

/** Merge a backup INTO the current data (union by primary key) rather than
 *  replacing it: rows with a new id are added, rows with an existing id
 *  overwrite that record. Enables collaboration without a server — two people
 *  who share a trip and library can each edit their own per-person plan and
 *  combine files, since plan entries are keyed by person and never collide.
 *  Genuine conflicts (the same item/meal edited by both) are last-writer-wins. */
export async function mergeBackup(data: BackupData): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    await db.trips.bulkPut(data.trips)
    await db.people.bulkPut(data.people)
    await db.items.bulkPut(data.items)
    await db.meals.bulkPut(data.meals)
    await db.resupplies.bulkPut(data.resupplies)
    await db.planEntries.bulkPut(data.planEntries.map(normalizePlanEntry))
    await db.gear.bulkPut(data.gear ?? [])
    await db.gearCollections.bulkPut(data.gearCollections ?? [])
    await db.tripConsumables.bulkPut(data.tripConsumables ?? [])
  })
}

export async function restoreBackup(data: BackupData): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    await Promise.all(ALL_TABLES.map((t) => t.clear()))
    await db.trips.bulkAdd(data.trips)
    await db.people.bulkAdd(data.people)
    await db.items.bulkAdd(data.items)
    await db.meals.bulkAdd(data.meals)
    await db.resupplies.bulkAdd(data.resupplies)
    // Legacy backups (pre-Epic-13) carry one-meal-per-slot entries; fold them
    // into the parts model on the way in so old exports restore cleanly.
    await db.planEntries.bulkAdd(data.planEntries.map(normalizePlanEntry))
    await db.gear.bulkAdd(data.gear ?? [])
    await db.gearCollections.bulkAdd(data.gearCollections ?? [])
    await db.tripConsumables.bulkAdd(data.tripConsumables ?? [])
  })
}
