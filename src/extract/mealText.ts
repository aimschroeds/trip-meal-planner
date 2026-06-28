// Networked side of the natural-language meal builder (Epic 17): send the
// user's description + their library item names to the Anthropic API (browser
// → API, user's own key) and get back a meal answer. The answer's shape is
// validated by the pure codec in src/domain/mealText.ts.

import Anthropic from '@anthropic-ai/sdk'
import {
  MEAL_TEXT_SCHEMA,
  buildMealPrompt,
  parseMealTextAnswers,
  type MealTextAnswer,
} from '../domain/mealText'
import type { Item } from '../domain/types'
import { EXTRACT_MODEL } from './config'

export async function buildMealsFromText(
  apiKey: string,
  text: string,
  items: Item[],
): Promise<MealTextAnswer[]> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })

  const response = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: MEAL_TEXT_SCHEMA } },
    messages: [{ role: 'user', content: [{ type: 'text', text: buildMealPrompt(text, items) }] }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this description — try rephrasing it.')
  }
  const out = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const result = parseMealTextAnswers(out)
  if (!result.ok) throw new Error(`Could not build the meal: ${result.error}`)
  return result.meals
}

// Reuse the photo-extract error mapping (same API failure modes).
export { extractErrorMessage as mealTextErrorMessage } from './client'
