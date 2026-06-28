// Core entities. See PLAN.md §3 for the data model rationale.
// Everything derivable (meal roll-ups, carries, totals) is computed by
// functions in this package, never stored.

export type DayType = 'small' | 'average' | 'big' | 'huge'

export type MealType = 'brekkie' | 'snack' | 'lunch' | 'dinner'

/** Coarse position of a slot within the day; drives carry-splitting of
 *  snacks around mid-day resupplies (PLAN.md §6.1). */
export type SlotTiming = 'morning' | 'midday' | 'afternoon' | 'evening'

/** Every boundary between consecutive slot groups in a day — brekkie,
 *  morning snacks, lunch, afternoon snacks, dinner, evening snacks.
 *  ("After evening snacks" is the next day's before_breakfast.) */
export type ResupplyTiming =
  | 'before_breakfast'
  | 'after_breakfast'
  | 'before_lunch'
  | 'after_lunch'
  | 'late_afternoon'
  | 'after_dinner'

/** Basis the user typed weight/calories in. Display metadata only —
 *  caloriesPerGram is the canonical value (story 4.1). */
export type InputBasis = 'per_gram' | 'per_100g' | 'per_serving' | 'per_package'

export interface Person {
  id: string
  name: string
  /** Baseline daily calorie target, scaled per day by DayType factor. */
  baselineCalories: number
  vegetarian: boolean
}

export interface Slot {
  type: MealType
  timing: SlotTiming
}

export interface Day {
  /** 1-based day number within the trip. */
  index: number
  type: DayType
  /** Slots that apply on this day; partial first/last days list a subset
   *  (story 2.3). */
  activeSlots: Slot[]
  /** Optional itinerary detail (Epic 15): a leg name and the day's planned
   *  distance / ascent. When distance & ascent are set, `type` is derived
   *  from them (effort → day type); all optional and entry-only. */
  name?: string
  distanceKm?: number
  ascentM?: number
  /** Start / end locations of the day's leg (Epic 19). Used to derive the
   *  AI day description; fall back to `name` when absent. */
  start?: string
  end?: string
  /** AI-generated 1–2 sentence summary of the day's eating strategy (lunch
   *  stops, snack spots, or eat-on-the-go). Generated from the itinerary,
   *  stored so it persists; editable/re-generatable. */
  description?: string
}

export interface Trip {
  id: string
  name: string
  days: Day[]
  peopleIds: string[]
  dayTypeFactors: Record<DayType, number>
}

export interface Resupply {
  id: string
  tripId: string
  dayIndex: number
  timing: ResupplyTiming
  /** Where the resupply happens — hikers refer to resupplies by place
   *  ("Vizzavona"), so carries are labelled with these. Optional. */
  location?: string
}

export interface Item {
  id: string
  name: string
  /** Canonical calorie density (story 4.1). */
  caloriesPerGram: number
  vegetarian: boolean
  inputBasis: InputBasis
  /** Raw entry as typed, kept for display/editing. */
  inputWeightG: number
  inputCalories: number
  /** Optional bounds on this item's grams per meal portion when generation
   *  scales quantities (PLAN.md §6.3, §9.2) — caps things like butter.
   *  Authored meal quantities are never clamped; only scaling is. */
  minGrams?: number
  maxGrams?: number
  /** Optional piece weight (PLAN.md §9.6): lets meals be composed in units
   *  ("2 tortillas") and shopping lists show piece counts. Quantities stay
   *  canonical in grams; units are entry/display convenience only. */
  unitWeightG?: number
  /** Singular label for the unit, e.g. "tortilla", "bar". Cosmetic. */
  unitName?: string
  /** Optional default single serving in grams (PLAN.md §9.7): the meal
   *  composer prefills it when this item is picked. When unset, the composer
   *  derives a serving from the entry basis / piece weight — see
   *  defaultServingG() in domain/units.ts. Entry convenience only. */
  servingG?: number
  /** Slot types this item may be auto-placed into by generation (Epic 16):
   *  a freeze-dried dinner tagged ['dinner'], a bar tagged ['snack']. Empty
   *  or undefined = never auto-generated as a loose item (still usable by
   *  hand). One serving (defaultServingG) is the generated quantity. */
  genMealTypes?: MealType[]
}

export interface MealComponent {
  itemId: string
  grams: number
}

export interface Meal {
  id: string
  name: string
  /** Primary slot type — used for grouping, sorting, and as the CSV/default
   *  value. For eligibility (which slots a meal may go in) read `types` via
   *  mealSlotTypes(), not this field directly. */
  type: MealType
  /** All slot types this meal fits — a meal like rice & beans can be both
   *  lunch and dinner. Optional/legacy meals fall back to `[type]`. Always
   *  includes `type` when set. */
  types?: MealType[]
  components: MealComponent[]
}

/** One part of a planned slot (Epic 13): a slot holds an ordered list of
 *  these, so a single slot can mix library meals and loose items — e.g.
 *  "dinner = Beef Stroganoff + 2 squares of chocolate", or a snack that's
 *  just a bar. Grams stay canonical; meals carry an optional quantity scale
 *  for generation fine-tuning. */
export type PlanPart =
  | { kind: 'meal'; mealId: string; quantityScale?: number }
  | { kind: 'item'; itemId: string; grams: number }

/** One person's assignment for one meal slot on one day (stories 5.1-5.3,
 *  6.1-6.2; Epic 13). Plans are fully individual per person. */
export interface PlanEntry {
  /** Deterministic: `${tripId}|${personId}|${dayIndex}|${slotKey}` so a
   *  slot has at most one entry and put() is a natural upsert. */
  id: string
  tripId: string
  personId: string
  dayIndex: number
  /** Stable key from keyedSlots() identifying the slot within the day. */
  slotKey: string
  /** A planned slot holds a list of parts; off-trail is a whole-slot state
   *  with no parts (zero weight, optional calorie estimate). */
  kind: 'planned' | 'offTrail'
  /** The slot's food, in order. Set when kind === 'planned'. */
  parts?: PlanPart[]
  /** Off-trail calorie estimate; omitted = "partially estimated" day,
   *  never counted as under target (resolved decision, story 6.2). */
  offTrailCalories?: number
  /** Locked manual picks survive plan generation (story 8.2). */
  locked?: boolean
}

/** Defaults per story 2.2; user-tunable per trip. */
export const DEFAULT_DAY_TYPE_FACTORS: Record<DayType, number> = {
  small: 0.75,
  average: 1.0,
  big: 1.25,
  huge: 1.5,
}
