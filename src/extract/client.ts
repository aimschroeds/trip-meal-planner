// The app's only networked feature: send 1–2 product photos to the Anthropic
// API (directly from the browser, under the user's own key) and get back a
// draft item. Everything model-answer-shaped is validated by the pure codec
// in src/domain/extract.ts.

import Anthropic from '@anthropic-ai/sdk'
import {
  EXTRACT_PROMPT,
  EXTRACT_SCHEMA,
  buildUrlExtractPrompt,
  parseExtractedItem,
  type ExtractedItem,
} from '../domain/extract'
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

/** Extract an item from a product web page (Epic 20). The Anthropic web-fetch
 *  tool fetches and reads the page server-side, sidestepping browser CORS; the
 *  model returns the same answer shape as the photo path. The page text/images
 *  are read by the model, not by us. */
/** Hard ceiling on the whole fetch→answer loop. The SDK's own request timeout
 *  defaults to 10 minutes, and a slow page behind the web-fetch tool plus a
 *  pause_turn resume or two can stack well past what anyone will wait at a
 *  form — so we cap the wall-clock and fail fast with a clear message. */
const URL_EXTRACT_DEADLINE_MS = 90_000

export async function extractItemFromUrl(apiKey: string, url: string): Promise<ExtractedItem> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: EXTRACT_MODEL,
    max_tokens: 1024,
    // Constrain the final answer to the item schema even though a tool runs
    // first: after web-fetch the model otherwise tends to wrap the JSON in
    // prose, which read poorly as "did not return valid JSON".
    output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    // web_fetch only retrieves URLs already present in the conversation (the
    // prompt includes it); max_uses caps follow-on fetches (e.g. a redirect).
    tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }],
    messages: [{ role: 'user', content: [{ type: 'text', text: buildUrlExtractPrompt(url) }] }],
  }

  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), URL_EXTRACT_DEADLINE_MS)
  try {
    // The server runs a fetch→answer loop; it can return pause_turn before it's
    // done. Re-send the accumulated turns to resume, bounded so we never spin;
    // the abort deadline is the real backstop against a slow page.
    const messages = [...params.messages]
    let response = await client.messages.create(params, { signal: controller.signal })
    for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
      messages.push({ role: 'assistant', content: response.content })
      response = await client.messages.create({ ...params, messages }, { signal: controller.signal })
    }

    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined this page — try a different link or add the item by hand.')
    }
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
    const result = parseExtractedItem(text)
    if (!result.ok) throw new Error(`Could not read the page: ${result.error}`)
    return result.item
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(
        'Reading the page took too long — it may be slow or blocking automated fetches. ' +
          'Try again, paste a nutrition photo instead, or add the item by hand.',
        { cause: e },
      )
    }
    throw e
  } finally {
    clearTimeout(deadline)
  }
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
