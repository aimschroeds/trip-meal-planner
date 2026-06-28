// Natural-language meal builder codec (Epic 17). The user describes what they
// want in plain language ("a few dinners built around different bean items,
// each with a tortilla and a serving of olive oil"); the model is shown the
// user's whole library and SELECTS items from it by number — so semantic
// requests ("items containing beans") are the model's job, not a fragile
// string match. This module owns the prompt, the response schema, validation,
// and resolving the chosen references back to library items. Pure — the API
// call lives in src/extract/.

import { defaultServingG } from './units'
import type { Item, MealType } from './types'

const MEAL_TYPES: MealType[] = ['brekkie', 'snack', 'lunch', 'dinner']

/** One component of the model's answer: a reference into the library list it
 *  was shown (1-based `ref`), or a free-text `name` for a food genuinely not in
 *  the library. Exactly one is expected to be set. */
export interface AnswerComponent {
  ref: number | null
  name: string | null
  grams: number
}

/** The model's answer: a meal whose components reference library items by
 *  number (not yet resolved to item ids). */
export interface MealTextAnswer {
  name: string
  type: MealType
  components: AnswerComponent[]
}

/** A composer-ready draft after matching named foods to the library. */
export interface MealDraftMatch {
  name: string
  type: MealType
  /** Components matched to a library item. */
  components: { itemId: string; grams: number }[]
  /** Named foods that didn't match any library item (add by hand). */
  unmatched: { name: string; grams: number }[]
}

/** One line per library item, numbered, with the attributes the model needs to
 *  choose well: serving size (grams grounding), calorie density, and a veg flag.
 *  The [number] is the handle the model returns in `ref`. */
function libraryListing(items: Item[]): string {
  if (items.length === 0) return '(none yet)'
  return items
    .map((i, idx) => {
      const bits: string[] = []
      if (i.unitWeightG !== undefined && i.unitWeightG > 0) {
        const unit = i.unitName || 'piece'
        bits.push(`${Math.round(i.unitWeightG)} g per ${unit} (use whole ${unit}s)`)
      } else {
        bits.push(`${Math.round(defaultServingG(i) ?? i.inputWeightG)} g/serving`)
      }
      bits.push(`${i.caloriesPerGram.toFixed(1)} cal/g`)
      if (i.vegetarian) bits.push('vegetarian')
      return `[${idx + 1}] ${i.name} — ${bits.join(', ')}`
    })
    .join('\n')
}

/** Prompt for the model — it picks library items by their [number], so it does
 *  the semantic selection ("items containing beans") and we never have to
 *  re-match free text to the library. */
export function buildMealPrompt(text: string, items: Item[]): string {
  return `You are composing hiking meals for someone, choosing from THEIR food library.

Their library (choose items by the [number]):
${libraryListing(items)}

Request:
"""
${text}
"""

Compose meals that satisfy the request. YOU decide which library items fit — use the names and attributes above to judge. For example: "items containing beans" → choose every library item whose food contains beans; "pair each with a tortilla" → add the tortilla item to each meal; "a serving of olive oil" → add the olive oil item at one serving. When the request implies several meals ("a bunch", "different items"), return one meal per qualifying item.

Return JSON: { "meals": [ ... ] }. Each meal has:
- "name": a short descriptive name (e.g. "Black bean & tortilla dinner")
- "type": one of brekkie/lunch/dinner/snack (infer from the foods if unstated)
- "components": an array, each { "ref": <library number>, "name": null, "grams": <number> }

Rules for components:
- Prefer library items: set "ref" to the item's [number] and "name" to null. Only for a food that is genuinely NOT in the library, set "ref" to null and "name" to the food's name.
- grams: use any explicit amount in the request (e.g. "80 g", "1/8 stick"); otherwise use the item's serving size shown above. For piece-based items, use whole-piece multiples — never a fraction of a piece.`
}

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: ['brekkie', 'snack', 'lunch', 'dinner'] },
    components: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: ['integer', 'null'] },
          name: { type: ['string', 'null'] },
          grams: { type: 'number' },
        },
        required: ['ref', 'name', 'grams'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'type', 'components'],
  additionalProperties: false,
} as const

/** Structured-output schema: a list of meals. */
export const MEAL_TEXT_SCHEMA = {
  type: 'object',
  properties: { meals: { type: 'array', items: MEAL_SCHEMA } },
  required: ['meals'],
  additionalProperties: false,
} as const

export type ParseMealTextResult =
  | { ok: true; meals: MealTextAnswer[] }
  | { ok: false; error: string }

function parseOneMeal(raw: unknown): MealTextAnswer | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'a meal is not an object'
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string' || obj.name.trim() === '') return 'a meal is missing a name'
  if (typeof obj.type !== 'string' || !MEAL_TYPES.includes(obj.type as MealType)) {
    return `"${String(obj.name)}" has an invalid type (must be ${MEAL_TYPES.join('/')})`
  }
  if (!Array.isArray(obj.components) || obj.components.length === 0) {
    return `"${String(obj.name)}" has no components`
  }
  const components: MealTextAnswer['components'] = []
  for (const c of obj.components) {
    if (typeof c !== 'object' || c === null) return 'a component is not an object'
    const comp = c as Record<string, unknown>
    const hasRef = typeof comp.ref === 'number' && Number.isInteger(comp.ref)
    const name = typeof comp.name === 'string' ? comp.name.trim() : ''
    if (!hasRef && name === '') {
      return `"${String(obj.name)}" has a component with neither a library ref nor a name`
    }
    if (typeof comp.grams !== 'number' || !Number.isFinite(comp.grams) || comp.grams <= 0) {
      return `"${String(obj.name)}" has a component with invalid grams`
    }
    components.push({
      ref: hasRef ? (comp.ref as number) : null,
      name: name === '' ? null : name,
      grams: comp.grams,
    })
  }
  return { name: obj.name.trim(), type: obj.type as MealType, components }
}

/** Validates the model's JSON answer (tolerant of a fenced code block, a bare
 *  array, or a single meal object) and returns the list of meals. */
export function parseMealTextAnswers(text: string): ParseMealTextResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return { ok: false, error: 'the model did not return valid JSON' }
  }
  // Accept { meals: [...] }, a bare [...], or a single meal object.
  let list: unknown[]
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).meals)) {
    list = (raw as Record<string, unknown>).meals as unknown[]
  } else list = [raw]

  if (list.length === 0) return { ok: false, error: 'no meals returned' }
  const meals: MealTextAnswer[] = []
  for (const m of list) {
    const parsed = parseOneMeal(m)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    meals.push(parsed)
  }
  return { ok: true, meals }
}

/** Snap a matched component's grams to something sensible: items measured in
 *  discrete pieces (tortillas, bars, sachets — they carry a unit weight) land
 *  on whole units, since "1.11 tortillas" is meaningless on the trail.
 *  Everything else just rounds to one decimal. */
function snapGrams(item: Item, grams: number): number {
  if (item.unitWeightG !== undefined && item.unitWeightG > 0) {
    const units = Math.max(1, Math.round(grams / item.unitWeightG))
    return Math.round(units * item.unitWeightG * 10) / 10
  }
  return Math.round(grams * 10) / 10
}

/** Normalize a food name for matching: lowercase, "&" → "and", drop
 *  punctuation, collapse whitespace. Lets the model's paraphrases line up with
 *  library names despite cosmetic differences ("Bean & Cheese" vs
 *  "bean and cheese") — the main reason components were dropped as unmatched. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Resolve a free-text food name to a library item (fallback for when the
 *  model emits a name instead of a ref): normalized exact match, then a
 *  normalized substring match either direction. */
function matchByName(name: string, items: Item[]): Item | undefined {
  const key = normalizeName(name)
  if (key === '') return undefined
  return (
    items.find((i) => normalizeName(i.name) === key) ??
    items.find((i) => {
      const n = normalizeName(i.name)
      return n.includes(key) || key.includes(n)
    })
  )
}

/** Resolve the model's chosen references to library items. A valid `ref`
 *  (1-based index into the same list the model was shown) is the primary path;
 *  a free-text `name` falls back to name matching. Anything else is reported as
 *  unmatched so the UI can flag it for manual entry. */
export function matchMealDraft(answer: MealTextAnswer, items: Item[]): MealDraftMatch {
  const matched: MealDraftMatch['components'] = []
  const unmatched: MealDraftMatch['unmatched'] = []

  for (const c of answer.components) {
    const item =
      c.ref !== null && c.ref >= 1 && c.ref <= items.length
        ? items[c.ref - 1]
        : c.name !== null
          ? matchByName(c.name, items)
          : undefined
    if (item) matched.push({ itemId: item.id, grams: snapGrams(item, c.grams) })
    else unmatched.push({ name: c.name ?? `item #${c.ref}`, grams: c.grams })
  }
  return { name: answer.name, type: answer.type, components: matched, unmatched }
}
