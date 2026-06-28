// Natural-language meal builder codec (Epic 17). The user describes a meal in
// plain text ("oatmeal 80g, 15g chia, 1/8 butter stick, 40g dried
// blueberries"); a model turns it into {name, type, components}, and this
// module owns the prompt, the response schema, validation of the model's
// answer, and matching the named foods back to the library. Pure — the API
// call lives in src/extract/.

import { defaultServingG } from './units'
import type { Item, MealType } from './types'

const MEAL_TYPES: MealType[] = ['brekkie', 'snack', 'lunch', 'dinner']

/** The model's answer: a meal with components named in free text (not yet
 *  matched to library item ids). */
export interface MealTextAnswer {
  name: string
  type: MealType
  components: { item: string; grams: number }[]
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

/** Prompt for the model — the library names are listed so it reuses them
 *  verbatim, which makes matching reliable. */
export function buildMealPrompt(text: string, items: Item[]): string {
  // Give the model each item's real serving size so its grams are grounded,
  // not guessed — the main cause of "wildly unrealistic" quantities.
  const list =
    items.length > 0
      ? items
          .map((i) => {
            const serving = defaultServingG(i) ?? i.inputWeightG
            return `- ${i.name} (≈ ${Math.round(serving)} g per serving)`
          })
          .join('\n')
      : '(none yet)'
  return `You are composing one or more hiking meals from a free-text description.

Available library items, with each item's serving size — use these names VERBATIM whenever the description refers to one of them, and ground your grams in the serving sizes:
${list}

Description:
"""
${text}
"""

Return JSON: { "meals": [ ... ] } where each meal has a short "name" (e.g. "Oatmeal + chia breakfast"), a "type" (one of brekkie/lunch/dinner/snack), and "components" — each a food "item" and its "grams". If the description clearly covers several distinct meals, return one object per meal; for a single meal, return an array with one object.

Rules for grams:
- If the description gives an explicit amount for a food (e.g. "80 g", "2 sachets", "1/8 stick"), use it.
- Otherwise use the matching library item's serving size shown above — do NOT invent a number.
- "N x" or "N sachets/bars/pieces" of an item = N times its serving size.
For every food, output the matching library item name verbatim when one fits; otherwise use the food's name as written and your best gram estimate. Infer each meal's type from its foods if not stated.`
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
          item: { type: 'string' },
          grams: { type: 'number' },
        },
        required: ['item', 'grams'],
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
    if (typeof comp.item !== 'string' || comp.item.trim() === '') {
      return 'a component is missing an item name'
    }
    if (typeof comp.grams !== 'number' || !Number.isFinite(comp.grams) || comp.grams <= 0) {
      return `"${comp.item}" has invalid grams`
    }
    components.push({ item: comp.item.trim(), grams: comp.grams })
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

/** Match the model's named foods to library items: case-insensitive exact
 *  name first, then a substring match either direction. Unmatched foods are
 *  returned separately so the UI can flag them for manual entry. */
export function matchMealDraft(answer: MealTextAnswer, items: Item[]): MealDraftMatch {
  const byLower = new Map(items.map((i) => [i.name.toLowerCase(), i]))
  const matched: MealDraftMatch['components'] = []
  const unmatched: MealDraftMatch['unmatched'] = []

  for (const c of answer.components) {
    const key = c.item.toLowerCase()
    const item =
      byLower.get(key) ??
      items.find((i) => {
        const n = i.name.toLowerCase()
        return n.includes(key) || key.includes(n)
      })
    if (item) matched.push({ itemId: item.id, grams: Math.round(c.grams * 10) / 10 })
    else unmatched.push({ name: c.item, grams: c.grams })
  }
  return { name: answer.name, type: answer.type, components: matched, unmatched }
}
