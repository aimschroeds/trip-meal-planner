// Write operations with referential-integrity checks (story 4.6).
// Resolved decision: deleting an in-use item is BLOCKED, with the list of
// dependents reported so the user can untangle them first.

import { db, type MarkRow } from './db'
import { calorieDensity } from '../domain/density'
import { defaultWornQuantity } from '../domain/gear'
import { makeTrip } from '../domain/trip'
import type { ItemFields, ItemImportPlan } from '../domain/csv/items'
import type { GearFields } from '../domain/csv/gear'
import type { MealFields, MealImportPlan } from '../domain/csv/meals'
import type {
  GearCollection,
  GearItem,
  Item,
  Meal,
  MealComponent,
  Person,
  PlanEntry,
  PlanPart,
} from '../domain/types'

export class ItemInUseError extends Error {
  readonly item: Item
  readonly usedBy: Meal[]
  /** Plan slots that use the item directly as a loose part (Epic 13). */
  readonly plannedCount: number

  constructor(item: Item, usedBy: Meal[], plannedCount = 0) {
    const where: string[] = []
    if (usedBy.length > 0) {
      where.push(
        `${usedBy.length} meal${usedBy.length === 1 ? '' : 's'} (${usedBy
          .map((m) => m.name)
          .join(', ')})`,
      )
    }
    if (plannedCount > 0) {
      where.push(`${plannedCount} plan slot${plannedCount === 1 ? '' : 's'} directly`)
    }
    super(`"${item.name}" is used by ${where.join(' and ')}`)
    this.name = 'ItemInUseError'
    this.item = item
    this.usedBy = usedBy
    this.plannedCount = plannedCount
  }
}

export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', db.items, db.meals, db.planEntries, async () => {
    const item = await db.items.get(id)
    if (!item) return
    const usedBy = await db.meals
      .filter((m) => m.components.some((c) => c.itemId === id))
      .toArray()
    const plannedCount = await db.planEntries
      .filter((e) => (e.parts ?? []).some((p) => p.kind === 'item' && p.itemId === id))
      .count()
    if (usedBy.length > 0 || plannedCount > 0) throw new ItemInUseError(item, usedBy, plannedCount)
    await db.items.delete(id)
  })
}

export class MealInUseError extends Error {
  readonly meal: Meal
  readonly entryCount: number

  constructor(meal: Meal, entryCount: number) {
    super(
      `"${meal.name}" is planned in ${entryCount} slot${entryCount === 1 ? '' : 's'} — ` +
        'remove it from plans first',
    )
    this.name = 'MealInUseError'
    this.meal = meal
    this.entryCount = entryCount
  }
}

export async function deleteMeal(id: string): Promise<void> {
  await db.transaction('rw', db.meals, db.planEntries, async () => {
    const meal = await db.meals.get(id)
    if (!meal) return
    const entryCount = await db.planEntries
      .filter((e) => (e.parts ?? []).some((p) => p.kind === 'meal' && p.mealId === id))
      .count()
    if (entryCount > 0) throw new MealInUseError(meal, entryCount)
    await db.meals.delete(id)
  })
}

function planEntryId(tripId: string, personId: string, dayIndex: number, slotKey: string) {
  return `${tripId}|${personId}|${dayIndex}|${slotKey}`
}

/** Upsert the assignment for one slot; pass null fields via clearPlanEntry. */
export async function setPlanEntry(
  fields: Omit<PlanEntry, 'id'>,
): Promise<void> {
  await db.planEntries.put({
    ...fields,
    id: planEntryId(fields.tripId, fields.personId, fields.dayIndex, fields.slotKey),
  })
}

export async function clearPlanEntry(
  tripId: string,
  personId: string,
  dayIndex: number,
  slotKey: string,
): Promise<void> {
  await db.planEntries.delete(planEntryId(tripId, personId, dayIndex, slotKey))
}

/** Upsert a planned slot from its parts (Epic 13), clearing the slot when no
 *  parts remain so an emptied slot doesn't linger as a zero-calorie entry. */
export async function setPlannedSlot(
  loc: { tripId: string; personId: string; dayIndex: number; slotKey: string; locked?: boolean },
  parts: PlanPart[],
): Promise<void> {
  if (parts.length === 0) {
    await clearPlanEntry(loc.tripId, loc.personId, loc.dayIndex, loc.slotKey)
    return
  }
  await setPlanEntry({ ...loc, kind: 'planned', parts })
}

/** Upsert many slot assignments at once (Epic 14 copy-day). */
export async function applyPlanWrites(writes: Omit<PlanEntry, 'id'>[]): Promise<void> {
  if (writes.length === 0) return
  await db.planEntries.bulkPut(
    writes.map((w) => ({
      ...w,
      id: planEntryId(w.tripId, w.personId, w.dayIndex, w.slotKey),
    })),
  )
}

function itemFromFields(fields: ItemFields, existing?: Item): Item {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    // `rename_to` renames a matched item in place (id preserved); falls back to
    // the match name when not renaming.
    name: fields.renameTo ?? fields.name,
    brand: fields.brand,
    caloriesPerGram: calorieDensity({ weightG: fields.weightG, calories: fields.calories }),
    vegetarian: fields.vegetarian,
    // CSV doesn't carry the basis; the raw values round-trip regardless.
    inputBasis: existing?.inputBasis ?? 'per_serving',
    inputWeightG: fields.weightG,
    inputCalories: fields.calories,
    minGrams: fields.minGrams,
    maxGrams: fields.maxGrams,
    unitWeightG: fields.unitWeightG,
    unitName: fields.unitName,
    servingG: fields.servingG,
    packagingG: fields.packagingG,
    genMealTypes: fields.genMealTypes,
  }
}

export async function commitItemImport(plan: ItemImportPlan): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    await db.items.bulkAdd(plan.creates.map((fields) => itemFromFields(fields)))
    await db.items.bulkPut(plan.updates.map(({ item, fields }) => itemFromFields(fields, item)))
  })
}

/** Stub items (story 4.9) are zero-calorie, non-vegetarian placeholders:
 *  meals containing them stay out of vegetarian suggestions until the
 *  user fills them in. */
function stubItem(name: string): Item {
  return {
    id: crypto.randomUUID(),
    name,
    caloriesPerGram: 0,
    vegetarian: false,
    inputBasis: 'per_gram',
    inputWeightG: 1,
    inputCalories: 0,
  }
}

export async function commitMealImport(plan: MealImportPlan): Promise<void> {
  await db.transaction('rw', db.items, db.meals, async () => {
    await db.items.bulkAdd(plan.stubs.map(stubItem))
    const itemsByName = new Map((await db.items.toArray()).map((i) => [i.name.toLowerCase(), i]))
    const resolve = (fields: MealFields): MealComponent[] =>
      fields.components.flatMap((c) => {
        const item = itemsByName.get(c.itemName.toLowerCase())
        return item ? [{ itemId: item.id, grams: c.grams }] : []
      })
    await db.meals.bulkAdd(
      plan.creates.map((fields) => ({
        id: crypto.randomUUID(),
        name: fields.name,
        type: fields.types[0],
        types: fields.types,
        components: resolve(fields),
      })),
    )
    await db.meals.bulkPut(
      plan.updates.map(({ meal, fields }) => ({
        ...meal,
        type: fields.types[0],
        types: fields.types,
        components: resolve(fields),
      })),
    )
  })
}

function markId(tripId: string, scope: MarkRow['scope'], ref: string): string {
  return `${tripId}|${scope}|${ref}`
}

/** Toggle a shopping ('buy'), packing ('pack'), or prep ('prep') tick-off.
 *  Each tick is its own row (added/removed), so two people checking off
 *  different items at the same time never overwrite each other when synced. */
export async function toggleMark(
  tripId: string,
  scope: MarkRow['scope'],
  ref: string,
): Promise<void> {
  const id = markId(tripId, scope, ref)
  await db.transaction('rw', db.marks, async () => {
    if (await db.marks.get(id)) await db.marks.delete(id)
    else await db.marks.put({ id, tripId, scope, ref })
  })
}

function gearAssignmentId(tripId: string, personId: string, gearItemId: string): string {
  return `${tripId}|${personId}|${gearItemId}`
}

/** Toggle whether a person carries a gear item on a trip. Deterministic id so
 *  assigning is idempotent; each (person, item) is its own row so shared and
 *  personal gear are modelled uniformly. */
export async function toggleGearAssignment(
  tripId: string,
  personId: string,
  gearItemId: string,
): Promise<void> {
  const id = gearAssignmentId(tripId, personId, gearItemId)
  await db.transaction('rw', db.gearAssignments, async () => {
    if (await db.gearAssignments.get(id)) await db.gearAssignments.delete(id)
    else await db.gearAssignments.put({ id, tripId, personId, gearItemId })
  })
}

/** Set how many of a gear item a person carries (e.g. 2 pairs of socks). A
 *  quantity ≤ 1 clears the field back to the default. No-op if not assigned. */
export async function setGearQuantity(
  tripId: string,
  personId: string,
  gearItemId: string,
  quantity: number,
): Promise<void> {
  const id = gearAssignmentId(tripId, personId, gearItemId)
  await db.transaction('rw', db.gearAssignments, db.gear, async () => {
    const a = await db.gearAssignments.get(id)
    if (!a) return
    const g = await db.gear.get(gearItemId)
    const q = Math.max(1, Math.round(quantity))
    // Worn can't exceed the new quantity; drop it once it matches the item's
    // default (all-worn for wearables, none otherwise) so the record stays lean.
    const worn = a.wornQuantity !== undefined ? Math.min(a.wornQuantity, q) : undefined
    const def = g ? defaultWornQuantity(g, q) : q
    await db.gearAssignments.put({
      ...a,
      quantity: q > 1 ? q : undefined,
      wornQuantity: worn !== undefined && worn !== def ? worn : undefined,
    })
  })
}

/** Set how many of a person's units of a gear item are worn (the rest packed).
 *  Worn is a per-trip, whole-unit choice for any item. Matching the item's
 *  default (all-worn for wearables, none otherwise) clears it back to undefined. */
export async function setGearWornQuantity(
  tripId: string,
  personId: string,
  gearItemId: string,
  wornQuantity: number,
): Promise<void> {
  const id = gearAssignmentId(tripId, personId, gearItemId)
  await db.transaction('rw', db.gearAssignments, db.gear, async () => {
    const a = await db.gearAssignments.get(id)
    if (!a) return
    const g = await db.gear.get(gearItemId)
    const total = Math.max(1, a.quantity ?? 1)
    const worn = Math.min(Math.max(0, Math.round(wornQuantity)), total)
    const def = g ? defaultWornQuantity(g, total) : total
    await db.gearAssignments.put({ ...a, wornQuantity: worn !== def ? worn : undefined })
  })
}

/** Pin a person's gear assignment to a single carry, or clear it back to riding
 *  every carry (carryKey = undefined). No-op if not assigned. */
export async function setGearCarryScope(
  tripId: string,
  personId: string,
  gearItemId: string,
  carryKey: string | undefined,
): Promise<void> {
  const id = gearAssignmentId(tripId, personId, gearItemId)
  await db.transaction('rw', db.gearAssignments, async () => {
    const a = await db.gearAssignments.get(id)
    if (!a) return
    await db.gearAssignments.put({ ...a, carryKey: carryKey || undefined })
  })
}

/** Remove a gear item from a trip entirely (every carrier). */
export async function removeGearFromTrip(tripId: string, gearItemId: string): Promise<void> {
  await db.gearAssignments
    .where('gearItemId')
    .equals(gearItemId)
    .and((a) => a.tripId === tripId)
    .delete()
}

export class GearInUseError extends Error {
  readonly gear: GearItem
  readonly tripCount: number
  constructor(gear: GearItem, tripCount: number) {
    super(
      `"${gear.name}" is packed on ${tripCount} trip${tripCount === 1 ? '' : 's'} — ` +
        'remove it there first',
    )
    this.name = 'GearInUseError'
    this.gear = gear
    this.tripCount = tripCount
  }
}

/** Delete a gear item, blocked (like items/meals) if it's assigned on any trip.
 *  Also drops it from any gear collections it belonged to. */
export async function deleteGear(id: string): Promise<void> {
  await db.transaction('rw', db.gear, db.gearAssignments, db.gearCollections, async () => {
    const gear = await db.gear.get(id)
    if (!gear) return
    const assignments = await db.gearAssignments.where('gearItemId').equals(id).toArray()
    const tripIds = new Set(assignments.map((a) => a.tripId))
    if (tripIds.size > 0) throw new GearInUseError(gear, tripIds.size)
    await db.gear.delete(id)
    const collections = await db.gearCollections.toArray()
    for (const c of collections) {
      if (c.gearItemIds.includes(id)) {
        await db.gearCollections.put({ ...c, gearItemIds: c.gearItemIds.filter((g) => g !== id) })
      }
    }
  })
}

export async function createGearCollection(name: string): Promise<string> {
  const collection: GearCollection = { id: crypto.randomUUID(), name: name.trim(), gearItemIds: [] }
  await db.gearCollections.add(collection)
  return collection.id
}

export async function renameGearCollection(id: string, name: string): Promise<void> {
  await db.gearCollections.update(id, { name: name.trim() })
}

export async function deleteGearCollection(id: string): Promise<void> {
  await db.gearCollections.delete(id)
}

/** Add or remove a gear item from a collection (membership is a set). */
export async function toggleCollectionItem(collectionId: string, gearItemId: string): Promise<void> {
  await db.transaction('rw', db.gearCollections, async () => {
    const c = await db.gearCollections.get(collectionId)
    if (!c) return
    const has = c.gearItemIds.includes(gearItemId)
    await db.gearCollections.put({
      ...c,
      gearItemIds: has
        ? c.gearItemIds.filter((g) => g !== gearItemId)
        : [...c.gearItemIds, gearItemId],
    })
  })
}

export interface GearImportResult {
  added: number
  skipped: number
}

/** Bulk-add gear from a parsed CSV (e.g. a LighterPack export). Rows whose name
 *  already exists in the library are skipped, so re-importing doesn't duplicate. */
export async function commitGearImport(fields: GearFields[]): Promise<GearImportResult> {
  return db.transaction('rw', db.gear, async () => {
    const existing = new Set((await db.gear.toArray()).map((g) => g.name.trim().toLowerCase()))
    const toAdd: GearItem[] = []
    let skipped = 0
    for (const f of fields) {
      const key = f.name.trim().toLowerCase()
      if (existing.has(key)) {
        skipped++
        continue
      }
      existing.add(key)
      toAdd.push({
        id: crypto.randomUUID(),
        name: f.name,
        brand: f.brand,
        owners: f.owners,
        category: f.category || 'misc',
        weightG: f.weightG,
        wornWeightG: f.wornWeightG,
        consumableWeightG: f.consumableWeightG,
        shared: f.shared,
      })
    }
    await db.gear.bulkAdd(toAdd)
    return { added: toAdd.length, skipped }
  })
}

/** Set (or clear, with undefined) the owner(s) on many gear items at once —
 *  e.g. after a LighterPack import, tag the whole batch with a person. */
export async function setGearOwners(
  ids: string[],
  owners: string[] | undefined,
): Promise<void> {
  await db.transaction('rw', db.gear, async () => {
    const items = await db.gear.bulkGet(ids)
    const updated = items
      .filter((g): g is GearItem => !!g)
      .map((g) => ({ ...g, owners: owners?.length ? owners : undefined }))
    await db.gear.bulkPut(updated)
  })
}

export async function createTrip(name: string, numDays: number): Promise<string> {
  const trip = makeTrip(crypto.randomUUID(), name, numDays)
  await db.trips.add(trip)
  return trip.id
}

/** People belong to exactly one trip (plans are fully individual, story 5.3),
 *  so deleting a trip deletes its people, resupplies, and plan entries. */
export async function deleteTrip(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.trips, db.people, db.resupplies, db.planEntries, db.marks, db.gearAssignments],
    async () => {
      const trip = await db.trips.get(id)
      if (!trip) return
      await db.people.bulkDelete(trip.peopleIds)
      await db.resupplies.where('tripId').equals(id).delete()
      await db.planEntries.where('tripId').equals(id).delete()
      await db.marks.where('tripId').equals(id).delete()
      await db.gearAssignments.where('tripId').equals(id).delete()
      await db.trips.delete(id)
    },
  )
}

export async function addPersonToTrip(
  tripId: string,
  fields: Omit<Person, 'id'>,
): Promise<string> {
  const person: Person = { id: crypto.randomUUID(), ...fields }
  await db.transaction('rw', db.trips, db.people, async () => {
    const trip = await db.trips.get(tripId)
    if (!trip) throw new Error(`Trip ${tripId} not found`)
    await db.people.add(person)
    await db.trips.put({ ...trip, peopleIds: [...trip.peopleIds, person.id] })
  })
  return person.id
}

/** Edit a person's fields (e.g. nudge their baseline calories) without touching
 *  their plan — daily targets are derived from baselineCalories, never stored,
 *  so this just re-derives them. */
export async function updatePerson(
  personId: string,
  patch: Partial<Omit<Person, 'id'>>,
): Promise<void> {
  await db.people.update(personId, patch)
}

export async function removePersonFromTrip(tripId: string, personId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.trips, db.people, db.planEntries, db.gearAssignments],
    async () => {
      const trip = await db.trips.get(tripId)
      if (trip) {
        await db.trips.put({
          ...trip,
          peopleIds: trip.peopleIds.filter((id) => id !== personId),
        })
      }
      await db.planEntries.where('[tripId+personId]').equals([tripId, personId]).delete()
      await db.gearAssignments.where('[tripId+personId]').equals([tripId, personId]).delete()
      await db.people.delete(personId)
    },
  )
}
