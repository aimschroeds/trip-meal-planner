// Full-database export/restore. Restore is wholesale replacement inside a
// single transaction — the UI confirms before calling it, and a failed
// restore rolls back leaving existing data untouched.

import { db } from './db'
import type { BackupData } from '../domain/backup'

const ALL_TABLES = [db.trips, db.people, db.items, db.meals, db.resupplies, db.planEntries]

export async function exportBackup(): Promise<BackupData> {
  return db.transaction('r', ALL_TABLES, async () => ({
    trips: await db.trips.toArray(),
    people: await db.people.toArray(),
    items: await db.items.toArray(),
    meals: await db.meals.toArray(),
    resupplies: await db.resupplies.toArray(),
    planEntries: await db.planEntries.toArray(),
  }))
}

export async function restoreBackup(data: BackupData): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    await Promise.all(ALL_TABLES.map((t) => t.clear()))
    await db.trips.bulkAdd(data.trips)
    await db.people.bulkAdd(data.people)
    await db.items.bulkAdd(data.items)
    await db.meals.bulkAdd(data.meals)
    await db.resupplies.bulkAdd(data.resupplies)
    await db.planEntries.bulkAdd(data.planEntries)
  })
}
