// Networked side of the AI day descriptions (Epic 19): send the itinerary to
// the Anthropic API (browser → API, user's own key) and get a 1–2 sentence
// eating note per day. The shape is validated by the pure codec in
// src/domain/dayDescription.ts.

import Anthropic from '@anthropic-ai/sdk'
import {
  DAY_DESCRIPTIONS_SCHEMA,
  buildDayDescriptionsPrompt,
  parseDayDescriptions,
} from '../domain/dayDescription'
import type { Day } from '../domain/types'
import { EXTRACT_MODEL } from './config'

/** Returns a day-index → description map for the days that have itinerary
 *  detail. Days without a route/name are skipped (not sent). */
export async function describeDays(apiKey: string, days: Day[]): Promise<Map<number, string>> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })

  const response = await client.messages.create({
    model: EXTRACT_MODEL,
    // 2–3 sentences per day, across a whole itinerary — give it room.
    max_tokens: 4096,
    output_config: { format: { type: 'json_schema', schema: DAY_DESCRIPTIONS_SCHEMA } },
    messages: [
      { role: 'user', content: [{ type: 'text', text: buildDayDescriptionsPrompt(days) }] },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this itinerary — try rephrasing the leg names.')
  }
  const out = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const result = parseDayDescriptions(out)
  if (!result.ok) throw new Error(`Could not describe the days: ${result.error}`)
  return result.byDay
}

// Reuse the photo-extract error mapping (same API failure modes).
export { extractErrorMessage as dayDescriptionErrorMessage } from './client'
