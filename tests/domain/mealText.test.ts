import { describe, expect, it } from 'vitest'
import {
  buildMealPrompt,
  matchMealDraft,
  parseMealTextAnswers,
  type MealTextAnswer,
} from '../../src/domain/mealText'
import type { Item } from '../../src/domain/types'

function item(id: string, name: string, inputWeightG = 50): Item {
  return {
    id,
    name,
    caloriesPerGram: 4,
    vegetarian: true,
    inputBasis: 'per_serving',
    inputWeightG,
    inputCalories: 200,
  }
}

const library = [item('oats', 'Oatmeal'), item('chia', 'Chia seeds'), item('butter', '1/8 Butter Stick')]

describe('buildMealPrompt', () => {
  it('lists the library names and serving sizes for the model to match against', () => {
    const prompt = buildMealPrompt('oatmeal + chia', library)
    expect(prompt).toContain('- Oatmeal')
    expect(prompt).toContain('- Chia seeds')
    expect(prompt).toContain('g per serving')
    expect(prompt).toContain('oatmeal + chia')
  })

  it('asks for a list of meals', () => {
    const prompt = buildMealPrompt('breakfast and dinner', library)
    expect(prompt).toContain('"meals"')
  })
})

describe('parseMealTextAnswers', () => {
  it('accepts a { meals: [...] } answer', () => {
    const json = JSON.stringify({
      meals: [
        { name: 'Oatmeal breakfast', type: 'brekkie', components: [{ item: 'Oatmeal', grams: 80 }] },
      ],
    })
    const result = parseMealTextAnswers(json)
    expect(result).toEqual({
      ok: true,
      meals: [
        { name: 'Oatmeal breakfast', type: 'brekkie', components: [{ item: 'Oatmeal', grams: 80 }] },
      ],
    })
  })

  it('accepts several meals in one answer', () => {
    const json = JSON.stringify({
      meals: [
        { name: 'Brekkie', type: 'brekkie', components: [{ item: 'Oatmeal', grams: 80 }] },
        { name: 'Dinner', type: 'dinner', components: [{ item: 'Chia seeds', grams: 20 }] },
      ],
    })
    const result = parseMealTextAnswers(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meals).toHaveLength(2)
      expect(result.meals[1].name).toBe('Dinner')
    }
  })

  it('tolerates a bare array', () => {
    const json = '[{"name":"X","type":"snack","components":[{"item":"Bar","grams":40}]}]'
    const result = parseMealTextAnswers(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meals).toHaveLength(1)
  })

  it('tolerates a single meal object', () => {
    const json = '{"name":"X","type":"snack","components":[{"item":"Bar","grams":40}]}'
    const result = parseMealTextAnswers(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meals).toHaveLength(1)
  })

  it('tolerates a fenced code block', () => {
    const json =
      '```json\n{"meals":[{"name":"X","type":"snack","components":[{"item":"Bar","grams":40}]}]}\n```'
    const result = parseMealTextAnswers(json)
    expect(result.ok).toBe(true)
  })

  it('rejects a bad meal type', () => {
    const json = '{"meals":[{"name":"X","type":"brunch","components":[{"item":"Bar","grams":40}]}]}'
    const result = parseMealTextAnswers(json)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('invalid type')
  })

  it('rejects components with non-positive grams', () => {
    const json = '{"meals":[{"name":"X","type":"snack","components":[{"item":"Bar","grams":0}]}]}'
    const result = parseMealTextAnswers(json)
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects non-JSON', () => {
    expect(parseMealTextAnswers('sorry, I cannot').ok).toBe(false)
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

  it('matches across "&" vs "and" and punctuation/paraphrase differences', () => {
    const burrito = item('burr', 'Trailside Bean & Cheese Burrito')
    // Model paraphrases the name (& → and, drops "Trailside"): still matches,
    // instead of being dropped as unmatched.
    const draft = matchMealDraft(
      answer([{ item: 'Bean and Cheese Burrito', grams: 170 }]),
      [burrito],
    )
    expect(draft.components).toEqual([{ itemId: 'burr', grams: 170 }])
    expect(draft.unmatched).toEqual([])
  })

  it('snaps piece-based items to whole units (no 1.11 tortillas)', () => {
    const tortillas: Item = { ...item('tort', 'Flour Tortillas'), unitWeightG: 54, unitName: 'tortilla' }
    // 60 g ≈ 1.11 tortillas → snap to 1 tortilla (54 g).
    const one = matchMealDraft(answer([{ item: 'Flour Tortillas', grams: 60 }]), [tortillas])
    expect(one.components).toEqual([{ itemId: 'tort', grams: 54 }])
    // 90 g ≈ 1.67 → snap up to 2 tortillas (108 g).
    const two = matchMealDraft(answer([{ item: 'Flour Tortillas', grams: 90 }]), [tortillas])
    expect(two.components).toEqual([{ itemId: 'tort', grams: 108 }])
    // Always at least one piece, even for a tiny amount.
    const min = matchMealDraft(answer([{ item: 'Flour Tortillas', grams: 5 }]), [tortillas])
    expect(min.components).toEqual([{ itemId: 'tort', grams: 54 }])
  })
})
