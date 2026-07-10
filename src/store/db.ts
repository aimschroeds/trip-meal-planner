import Dexie, { type EntityTable } from 'dexie'
import type {
  GearAssignment,
  GearItem,
  Item,
  Meal,
  Person,
  PlanEntry,
  Resupply,
  Trip,
} from '../domain/types'
import type { SyncKind } from '../domain/sync'

/** Per-row sync bookkeeping (M7). One entry per synced domain object, keyed
 *  `${kind}:${id}`. `snapshot` is the locally-serialized payload as last
 *  reconciled; the sync engine compares it against the live row to detect local
 *  edits without touching domain types or every write site (PLAN.md §10). */
export interface SyncMetaRow {
  key: string
  kind: SyncKind
  id: string
  updatedAt: number
  deleted: boolean
  snapshot: string
}

/** A shopping/packing tick-off (M7.1). One row per ticked item means two
 *  people checking off different items at once never clobber each other. The
 *  row's existence is the tick; un-ticking deletes it. */
export interface MarkRow {
  /** `${tripId}|${scope}|${ref}` — stable and unique. */
  id: string
  tripId: string
  scope: 'buy' | 'pack' | 'prep'
  /** What was ticked: an item id (buy), `${carryIndex}:${itemId}` (pack,
   *  flat) or `${carryIndex}:${dayIndex}:${slotKey}:${personId}:${itemId}`
   *  (pack, nested), or `${carryIndex}:${prepGroupKey}` (prep). */
  ref: string
}

/** Singleton sync state: which cloud workspace this device is connected to
 *  (null = purely local), plus the share link token to display. */
export interface SyncStateRow {
  id: 'state'
  workspaceId: string | null
  /** Edit-link token for the connected workspace, when known (for sharing). */
  linkToken: string | null
  lastSyncedAt: number | null
}

// Dexie versioned schema — bump version() and add an upgrade() when the
// shape changes. Only indexed fields are listed in stores().
export const db = new Dexie('hiking-meal-planner') as Dexie & {
  trips: EntityTable<Trip, 'id'>
  people: EntityTable<Person, 'id'>
  items: EntityTable<Item, 'id'>
  meals: EntityTable<Meal, 'id'>
  resupplies: EntityTable<Resupply, 'id'>
  planEntries: EntityTable<PlanEntry, 'id'>
  gear: EntityTable<GearItem, 'id'>
  gearAssignments: EntityTable<GearAssignment, 'id'>
  marks: EntityTable<MarkRow, 'id'>
  syncMeta: EntityTable<SyncMetaRow, 'key'>
  syncState: EntityTable<SyncStateRow, 'id'>
}

db.version(1).stores({
  trips: 'id, name',
  people: 'id, name',
  items: 'id, name',
  meals: 'id, name, type',
})

db.version(2).stores({
  resupplies: 'id, tripId',
})

db.version(3).stores({
  planEntries: 'id, tripId, [tripId+personId], mealId',
})

// Epic 13: a slot holds a list of parts (meals and/or loose items) instead
// of a single meal. Drop the now-meaningless mealId index and fold each
// legacy entry's single meal into a one-element parts list. Off-trail
// entries are untouched.
db.version(4)
  .stores({
    planEntries: 'id, tripId, [tripId+personId]',
  })
  .upgrade((tx) =>
    tx
      .table('planEntries')
      .toCollection()
      .modify((e: Record<string, unknown>) => {
        if (e.kind === 'meal') {
          e.kind = 'planned'
          const part: Record<string, unknown> = { kind: 'meal', mealId: e.mealId }
          if (e.quantityScale != null) part.quantityScale = e.quantityScale
          e.parts = e.mealId ? [part] : []
        }
        delete e.mealId
        delete e.quantityScale
      }),
  )

// M7: cloud sync. Two new local-only tables for sync bookkeeping; existing
// data is untouched, so on first connect every current row reads as a local
// change and uploads to the workspace.
db.version(5).stores({
  syncMeta: 'key, kind',
  syncState: 'id',
})

// M7.1: shopping/packing tick-offs, synced like any other table so a checklist
// is shared live between collaborators.
db.version(6).stores({
  marks: 'id, tripId',
})

// Gear epic: a library of gear the hiker owns, alongside the food items table.
db.version(7).stores({
  gear: 'id, name, category',
})

// Gear epic G2: which gear is taken on a trip and who carries it.
db.version(8).stores({
  gearAssignments: 'id, tripId, [tripId+personId], gearItemId',
})
