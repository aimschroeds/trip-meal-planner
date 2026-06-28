// Natural-language meal builder codec (Epic 17). The user describes a meal in
// plain text ("oatmeal 80g, 15g chia, 1/8 butter stick, 40g dried
// blueberries"); a model turns it into {name, type, components}, and this
// module owns the prompt, the response schema, validation of the model's
// answer, and matching the named foods back to the library. Pure — the API
// call lives in src/extract/.

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
export function buildMealPrompt(text: string, libraryNames: string[]): string {
  const list = libraryNames.length > 0 ? libraryNames.map((n) => `- ${n}`).join('\n') : '(none yet)'
  return `You are composing a hiking meal from a free-text description.

Available library items — use these names VERBATIM whenever the description refers to one of them:
${list}

Description:
"""
${text}
"""

Return JSON: a short meal "name" (e.g. "Oatmeal + chia breakfast"), a "type" (one of brekkie/lunch/dinner/snack), and "components" — each a food "item" and its "grams". For every food in the description, output the matching library item name verbatim when one fits; otherwise use the food's name as written. Convert quantities to grams (e.g. a per-piece or per-package weight if known, otherwise your best estimate). Infer the meal type from the foods if the description doesn't state one.`
}

/** Structured-output schema matching parseMealTextAnswer. */
export const MEAL_TEXT_SCHEMA = {
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

export type ParseMealTextResult =
  | { ok: true; answer: MealTextAnswer }
  | { ok: false; error: string }

/** Validates the model's JSON answer (tolerant of a fenced code block). */
export function parseMealTextAnswer(text: string): ParseMealTextResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return { ok: false, error: 'the model did not return valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'expected a JSON object' }
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    return { ok: false, error: 'missing meal name' }
  }
  if (typeof obj.type !== 'string' || !MEAL_TYPES.includes(obj.type as MealType)) {
    return { ok: false, error: `type must be one of ${MEAL_TYPES.join('/')}` }
  }
  if (!Array.isArray(obj.components) || obj.components.length === 0) {
    return { ok: false, error: 'no components returned' }
  }
  const components: MealTextAnswer['components'] = []
  for (const c of obj.components) {
    if (typeof c !== 'object' || c === null) return { ok: false, error: 'a component is not an object' }
    const comp = c as Record<string, unknown>
    if (typeof comp.item !== 'string' || comp.item.trim() === '') {
      return { ok: false, error: 'a component is missing an item name' }
    }
    if (typeof comp.grams !== 'number' || !Number.isFinite(comp.grams) || comp.grams <= 0) {
      return { ok: false, error: `"${comp.item}" has invalid grams` }
    }
    components.push({ item: comp.item.trim(), grams: comp.grams })
  }
  return { ok: true, answer: { name: obj.name.trim(), type: obj.type as MealType, components } }
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
