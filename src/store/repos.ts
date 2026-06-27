// Write operations with referential-integrity checks (story 4.6).
// Resolved decision: deleting an in-use item is BLOCKED, with the list of
// dependents reported so the user can untangle them first.

import { db } from './db'
import { calorieDensity } from '../domain/density'
import { makeTrip } from '../domain/trip'
import type { ItemFields, ItemImportPlan } from '../domain/csv/items'
import type { MealFields, MealImportPlan } from '../domain/csv/meals'
import type { Item, Meal, MealComponent, Person, PlanEntry, PlanPart } from '../domain/types'

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
    name: fields.name,
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
        type: fields.type,
        components: resolve(fields),
      })),
    )
    await db.meals.bulkPut(
      plan.updates.map(({ meal, fields }) => ({
        ...meal,
        type: fields.type,
        components: resolve(fields),
      })),
    )
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
  await db.transaction('rw', db.trips, db.people, db.resupplies, db.planEntries, async () => {
    const trip = await db.trips.get(id)
    if (!trip) return
    await db.people.bulkDelete(trip.peopleIds)
    await db.resupplies.where('tripId').equals(id).delete()
    await db.planEntries.where('tripId').equals(id).delete()
    await db.trips.delete(id)
  })
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

export async function removePersonFromTrip(tripId: string, personId: string): Promise<void> {
  await db.transaction('rw', db.trips, db.people, db.planEntries, async () => {
    const trip = await db.trips.get(tripId)
    if (trip) {
      await db.trips.put({
        ...trip,
        peopleIds: trip.peopleIds.filter((id) => id !== personId),
      })
    }
    await db.planEntries.where('[tripId+personId]').equals([tripId, personId]).delete()
    await db.people.delete(personId)
  })
}
