// The app's only networked feature: send 1–2 product photos to the Anthropic
// API (directly from the browser, under the user's own key) and get back a
// draft item. Everything model-answer-shaped is validated by the pure codec
// in src/domain/extract.ts.

import Anthropic from '@anthropic-ai/sdk'
import { EXTRACT_PROMPT, EXTRACT_SCHEMA, parseExtractedItem, type ExtractedItem } from '../domain/extract'
import { EXTRACT_MODEL } from './config'

export async function extractItemFromPhotos(
  apiKey: string,
  /** base64-encoded JPEGs (see image.ts). */
  photos: string[],
): Promise<ExtractedItem> {
  // The user's own key, typed into a local-first app — the legitimate case
  // for browser-side calls; nothing here belongs to us to protect.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })

  const response = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...photos.map((data) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data },
          })),
          { type: 'text' as const, text: EXTRACT_PROMPT },
        ],
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to read these photos — try clearer shots of the label')
  }
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const result = parseExtractedItem(text)
  if (!result.ok) throw new Error(`Could not read the label: ${result.error}`)
  return result.item
}

/** Human-readable message for extraction failures. */
export function extractErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) {
    return 'The API key was rejected — check it and try again.'
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API — check your connection.'
  }
  if (e instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the API — wait a moment and try again.'
  }
  return e instanceof Error ? e.message : String(e)
}
