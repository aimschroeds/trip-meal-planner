import { describe, expect, it } from 'vitest'
import {
  buildMealPrompt,
  matchMealDraft,
  parseMealTextAnswer,
  type MealTextAnswer,
} from '../../src/domain/mealText'
import type { Item } from '../../src/domain/types'

function item(id: string, name: string): Item {
  return {
    id,
    name,
    caloriesPerGram: 4,
    vegetarian: true,
    inputBasis: 'per_serving',
    inputWeightG: 50,
    inputCalories: 200,
  }
}

const library = [item('oats', 'Oatmeal'), item('chia', 'Chia seeds'), item('butter', '1/8 Butter Stick')]

describe('buildMealPrompt', () => {
  it('lists the library names for the model to match against', () => {
    const prompt = buildMealPrompt('oatmeal + chia', ['Oatmeal', 'Chia seeds'])
    expect(prompt).toContain('- Oatmeal')
    expect(prompt).toContain('- Chia seeds')
    expect(prompt).toContain('oatmeal + chia')
  })
})

describe('parseMealTextAnswer', () => {
  it('accepts a valid answer', () => {
    const json = JSON.stringify({
      name: 'Oatmeal breakfast',
      type: 'brekkie',
      components: [{ item: 'Oatmeal', grams: 80 }],
    })
    const result = parseMealTextAnswer(json)
    expect(result).toEqual({
      ok: true,
      answer: { name: 'Oatmeal breakfast', type: 'brekkie', components: [{ item: 'Oatmeal', grams: 80 }] },
    })
  })

  it('tolerates a fenced code block', () => {
    const json = '```json\n{"name":"X","type":"snack","components":[{"item":"Bar","grams":40}]}\n```'
    const result = parseMealTextAnswer(json)
    expect(result.ok).toBe(true)
  })

  it('rejects a bad meal type', () => {
    const json = '{"name":"X","type":"brunch","components":[{"item":"Bar","grams":40}]}'
    const result = parseMealTextAnswer(json)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('type must be')
  })

  it('rejects components with non-positive grams', () => {
    const json = '{"name":"X","type":"snack","components":[{"item":"Bar","grams":0}]}'
    const result = parseMealTextAnswer(json)
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects non-JSON', () => {
    expect(parseMealTextAnswer('sorry, I cannot').ok).toBe(false)
  })
})

describe('matchMealDraft', () => {
  const answer = (components: MealTextAnswer['components']): MealTextAnswer => ({
    name: 'Test',
    type: 'brekkie',
    components,
  })

  it('matches by case-insensitive exact name', () => {
    const draft = matchMealDraft(answer([{ item: 'oatmeal', grams: 80 }]), library)
    expect(draft.components).toEqual([{ itemId: 'oats', grams: 80 }])
    expect(draft.unmatched).toEqual([])
  })

  it('matches by substring either direction', () => {
    // "butter" is a substring of "1/8 Butter Stick"
    const draft = matchMealDraft(answer([{ item: 'butter', grams: 14 }]), library)
    expect(draft.components).toEqual([{ itemId: 'butter', grams: 14 }])
  })

  it('reports foods with no library match as unmatched', () => {
    const draft = matchMealDraft(
      answer([
        { item: 'Oatmeal', grams: 80 },
        { item: 'Dragonfruit', grams: 50 },
      ]),
      library,
    )
    expect(draft.components).toEqual([{ itemId: 'oats', grams: 80 }])
    expect(draft.unmatched).toEqual([{ name: 'Dragonfruit', grams: 50 }])
  })

  it('rounds matched grams to one decimal', () => {
    const draft = matchMealDraft(answer([{ item: 'Oatmeal', grams: 80.347 }]), library)
    expect(draft.components[0].grams).toBe(80.3)
  })
})
