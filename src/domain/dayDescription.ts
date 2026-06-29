// AI day-description codec (Epic 19). Given each day's itinerary (start → end,
// distance, ascent), a model writes a 1–2 sentence note on the day's eating
// strategy: whether there's a good lunch stop (named), or it's better to eat on
// the go, plus likely snack spots. Pure — the API call lives in src/extract/.
// The whole itinerary is sent in one request so the model sees the route in
// sequence; descriptions come back keyed by day index.

import type { Day } from './types'

/** A human label for a day's leg: "start → end" when known, else the leg
 *  name, else "Day N". */
export function dayLegLabel(day: Day): string {
  if (day.start && day.end) return `${day.start} → ${day.end}`
  if (day.start) return `from ${day.start}`
  if (day.end) return `to ${day.end}`
  return day.name ?? `Day ${day.index}`
}

/** True when a day has enough itinerary detail to describe (a route or at
 *  least a leg name). Days without any of it are skipped, not guessed at. */
export function hasItinerary(day: Day): boolean {
  return Boolean(day.start || day.end || day.name)
}

/** Prompt: lay out the itinerary in order and ask for a per-day eating note. */
export function buildDayDescriptionsPrompt(days: Day[]): string {
  const lines = days.map((d) => {
    const bits: string[] = [dayLegLabel(d)]
    if (d.distanceKm != null) bits.push(`${d.distanceKm} km`)
    if (d.ascentM != null) bits.push(`${d.ascentM} m ascent`)
    bits.push(d.type)
    return `Day ${d.index}: ${bits.join(', ')}`
  })
  return `You are advising a hiker on where to eat along each day of a multi-day hike. Assume a normal morning start and a roughly even pace through the day, so you can estimate roughly when (morning / midday / afternoon / late) they reach a given point along the leg.

Itinerary (in order):
${lines.join('\n')}

For each day write TWO to THREE sentences on the day's eating strategy:
- Call out the day's major scenic highlights — named lakes, summits, viewpoints, named mountain passes or saddles crossed — and roughly what time of day the hiker is likely to reach each. Only name a place when you are reasonably confident it is actually on or near this leg.
- Use that timing to advise: if a beautiful spot (a lake, a pass with a view, a meadow) falls near a mealtime or snack time, suggest stopping to enjoy a proper meal/snack there; if the scenic stretch is a long climb or exposed ridge with nowhere good to linger, suggest eating on the go and saving the proper stop for the next good spot.
- Note a natural lunch stop roughly midway, or say it's better to eat on the go (e.g. a long climb, exposed ridge, or a short day).
Keep it practical and specific to the terrain, distance, and timing. If you are not confident about exact place names, describe the spot by its terrain ("a shaded creek crossing about midway", "the ridge before the final descent") rather than inventing a name. Do not just repeat the distance/ascent numbers back.

Return JSON: { "days": [ { "day": <day number>, "description": "<2–3 sentences>" } ] } with one entry per day above.`
}

const DAY_DESC_ITEM = {
  type: 'object',
  properties: {
    day: { type: 'integer' },
    description: { type: 'string' },
  },
  required: ['day', 'description'],
  additionalProperties: false,
} as const

/** Structured-output schema: a description per day, keyed by day number. */
export const DAY_DESCRIPTIONS_SCHEMA = {
  type: 'object',
  properties: { days: { type: 'array', items: DAY_DESC_ITEM } },
  required: ['days'],
  additionalProperties: false,
} as const

export type ParseDayDescriptionsResult =
  | { ok: true; byDay: Map<number, string> }
  | { ok: false; error: string }

/** Validate the model's JSON (tolerant of a fenced block or a bare array) and
 *  return a day-index → description map. */
export function parseDayDescriptions(text: string): ParseDayDescriptionsResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return { ok: false, error: 'the model did not return valid JSON' }
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).days)
      ? ((raw as Record<string, unknown>).days as unknown[])
      : null
  if (!list) return { ok: false, error: 'expected { days: [...] }' }

  const byDay = new Map<number, string>()
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const obj = entry as Record<string, unknown>
    const day = obj.day
    const description = obj.description
    if (typeof day !== 'number' || !Number.isInteger(day)) continue
    if (typeof description !== 'string' || description.trim() === '') continue
    byDay.set(day, description.trim())
  }
  if (byDay.size === 0) return { ok: false, error: 'no day descriptions returned' }
  return { ok: true, byDay }
}
