// Photo-extraction codec (PLAN.md §9.5). A vision model reads 1–2 photos of
// a packaged food product and returns whole-package facts as JSON; this
// module owns the prompt, the response schema, and the validation of the
// model's answer. Pure — the API call itself lives in src/extract/.

export interface ExtractedItem {
  name: string
  /** Brand / manufacturer, separate from the name; null when unclear. */
  brand: string | null
  /** Net weight of the whole package in grams; null when not legible. */
  weightG: number | null
  /** Calories for the whole package; null when not legible. */
  calories: number | null
  /** null when the packaging gives no clear signal either way. */
  vegetarian: boolean | null
}

export const EXTRACT_PROMPT = `These photos show a packaged food product (front of pack and/or its nutrition label).

Extract, for the WHOLE PACKAGE:
- name: the product name as a shopper would say it, WITHOUT the brand and without slogans (e.g. "Dal & rice with spinach", not "Firepot Dal & rice")
- brand: the brand / manufacturer on its own (e.g. "Firepot"); null if not shown
- weight_grams: net weight of the whole package in grams; convert from oz if needed (1 oz = 28.35 g)
- calories_per_package: total calories in the whole package; if the label only gives per-serving values, multiply by the servings per package
- vegetarian: true if marked vegetarian/vegan or clearly plant-based, false if it contains meat or fish, null if unclear

Use null for any value that is not legible or not present in the photos. Do not guess numbers.`

/** Prompt for extracting an item from a product web page (Epic 20). The URL is
 *  included verbatim because the web-fetch tool only fetches URLs already
 *  present in the conversation. Same answer shape as the photo extract, parsed
 *  by parseExtractedItem. */
export function buildUrlExtractPrompt(url: string): string {
  return `Fetch this product page and read its food facts:
${url}

Extract, for the WHOLE PACKAGE/PRODUCT:
- name: the product name as a shopper would say it, WITHOUT the brand and without slogans (e.g. "Dal & rice with spinach", not "Firepot Dal & rice")
- brand: the brand / manufacturer on its own (e.g. "Firepot"); null if not shown
- weight_grams: net weight of the whole package in grams; convert from oz if needed (1 oz = 28.35 g)
- calories_per_package: total calories in the whole package; if the page only gives per-serving values, multiply by the servings per package
- vegetarian: true if marked vegetarian/vegan or clearly plant-based, false if it contains meat or fish, null if unclear

Return only a JSON object with those keys. Use null for any value the page doesn't clearly state — do not guess numbers.`
}

/** Structured-output schema matching parseExtractedItem. */
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Product name without the brand' },
    brand: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    weight_grams: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    calories_per_package: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    vegetarian: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
  },
  required: ['name', 'brand', 'weight_grams', 'calories_per_package', 'vegetarian'],
  additionalProperties: false,
} as const

export type ParseExtractedResult =
  | { ok: true; item: ExtractedItem }
  | { ok: false; error: string }

function numberOrNull(v: unknown, field: string, min: number): string | ExtractedItem['weightG'] {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
    return `${field} must be a number or null, got ${JSON.stringify(v)}`
  }
  return v
}

/** Validates the model's JSON answer. Tolerates a fenced code block around
 *  the JSON so a non-structured-output response still parses. */
export function parseExtractedItem(text: string): ParseExtractedResult {
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
    return { ok: false, error: 'missing product name' }
  }
  if (obj.brand !== null && obj.brand !== undefined && typeof obj.brand !== 'string') {
    return { ok: false, error: `brand must be a string or null, got ${JSON.stringify(obj.brand)}` }
  }
  const brand = typeof obj.brand === 'string' && obj.brand.trim() !== '' ? obj.brand.trim() : null
  const weightG = numberOrNull(obj.weight_grams, 'weight_grams', 0.1)
  if (typeof weightG === 'string') return { ok: false, error: weightG }
  const calories = numberOrNull(obj.calories_per_package, 'calories_per_package', 0)
  if (typeof calories === 'string') return { ok: false, error: calories }
  if (obj.vegetarian !== null && typeof obj.vegetarian !== 'boolean') {
    return { ok: false, error: `vegetarian must be a boolean or null, got ${JSON.stringify(obj.vegetarian)}` }
  }

  return {
    ok: true,
    item: {
      name: obj.name.trim(),
      brand,
      weightG,
      calories,
      vegetarian: obj.vegetarian as boolean | null,
    },
  }
}
