import { describe, expect, it } from 'vitest'
import {
  buildMealPrompt,
  matchMealDraft,
  parseMealTextAnswers,
  type AnswerComponent,
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

/** A library component reference by 1-based number, like the model returns. */
const ref = (n: number, grams: number): AnswerComponent => ({ ref: n, name: null, grams })
/** A free-text food the model couldn't find in the library. */
const named = (name: string, grams: number): AnswerComponent => ({ ref: null, name, grams })

describe('buildMealPrompt', () => {
  it('numbers the library items with their attributes', () => {
    const prompt = buildMealPrompt('beans and a tortilla', library)
    expect(prompt).toContain('[1] Oatmeal')
    expect(prompt).toContain('[2] Chia seeds')
    expect(prompt).toContain('cal/g')
    expect(prompt).toContain('beans and a tortilla')
  })

  it('asks for a list of meals referenced by number', () => {
    const prompt = buildMealPrompt('breakfast and dinner', library)
    expect(prompt).toContain('"meals"')
    expect(prompt).toContain('"ref"')
  })
})

describe('parseMealTextAnswers', () => {
  it('accepts a { meals: [...] } answer with ref components', () => {
    const json = JSON.stringify({
      meals: [
        { name: 'Oatmeal breakfast', type: 'brekkie', components: [{ ref: 1, name: null, grams: 80 }] },
      ],
    })
    const result = parseMealTextAnswers(json)
    expect(result).toEqual({
      ok: true,
      meals: [
        { name: 'Oatmeal breakfast', type: 'brekkie', components: [{ ref: 1, name: null, grams: 80 }] },
      ],
    })
  })

  it('accepts several meals in one answer', () => {
    const json = JSON.stringify({
      meals: [
        { name: 'Brekkie', type: 'brekkie', components: [{ ref: 1, name: null, grams: 80 }] },
        { name: 'Dinner', type: 'dinner', components: [{ ref: 2, name: null, grams: 20 }] },
      ],
    })
    const result = parseMealTextAnswers(json)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meals).toHaveLength(2)
      expect(result.meals[1].name).toBe('Dinner')
    }
  })

  it('accepts a free-text name for a food not in the library', () => {
    const json = '{"meals":[{"name":"X","type":"snack","components":[{"ref":null,"name":"Bar","grams":40}]}]}'
    const result = parseMealTextAnswers(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meals[0].components[0]).toEqual({ ref: null, name: 'Bar', grams: 40 })
  })

  it('tolerates a bare array and a single meal object', () => {
    const arr = '[{"name":"X","type":"snack","components":[{"ref":1,"name":null,"grams":40}]}]'
    const one = '{"name":"X","type":"snack","components":[{"ref":1,"name":null,"grams":40}]}'
    expect(parseMealTextAnswers(arr).ok).toBe(true)
    expect(parseMealTextAnswers(one).ok).toBe(true)
  })

  it('tolerates a fenced code block', () => {
    const json =
      '```json\n{"meals":[{"name":"X","type":"snack","components":[{"ref":1,"name":null,"grams":40}]}]}\n```'
    expect(parseMealTextAnswers(json).ok).toBe(true)
  })

  it('rejects a bad meal type', () => {
    const json = '{"meals":[{"name":"X","type":"brunch","components":[{"ref":1,"name":null,"grams":40}]}]}'
    const result = parseMealTextAnswers(json)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('invalid type')
  })

  it('rejects a component with neither ref nor name', () => {
    const json = '{"meals":[{"name":"X","type":"snack","components":[{"ref":null,"name":null,"grams":40}]}]}'
    expect(parseMealTextAnswers(json).ok).toBe(false)
  })

  it('rejects components with non-positive grams', () => {
    const json = '{"meals":[{"name":"X","type":"snack","components":[{"ref":1,"name":null,"grams":0}]}]}'
    expect(parseMealTextAnswers(json).ok).toBe(false)
  })

  it('rejects non-JSON', () => {
    expect(parseMealTextAnswers('sorry, I cannot').ok).toBe(false)
  })
})

describe('matchMealDraft', () => {
  const answer = (components: AnswerComponent[]): MealTextAnswer => ({
    name: 'Test',
    type: 'brekkie',
    components,
  })

  it('resolves a library reference by its 1-based number', () => {
    const draft = matchMealDraft(answer([ref(1, 80)]), library)
    expect(draft.components).toEqual([{ itemId: 'oats', grams: 80 }])
    expect(draft.unmatched).toEqual([])
  })

  it('resolves each ref to the right item', () => {
    const draft = matchMealDraft(answer([ref(3, 14)]), library)
    expect(draft.components).toEqual([{ itemId: 'butter', grams: 14 }])
  })

  it('reports a free-text food (no ref) as unmatched', () => {
    const draft = matchMealDraft(answer([ref(1, 80), named('Dragonfruit', 50)]), library)
    expect(draft.components).toEqual([{ itemId: 'oats', grams: 80 }])
    expect(draft.unmatched).toEqual([{ name: 'Dragonfruit', grams: 50 }])
  })

  it('treats an out-of-range ref as unmatched', () => {
    const draft = matchMealDraft(answer([ref(99, 50)]), library)
    expect(draft.components).toEqual([])
    expect(draft.unmatched).toEqual([{ name: 'item #99', grams: 50 }])
  })

  it('falls back to name matching when the model sends a name instead of a ref', () => {
    // Tolerant of "&" vs "and" and dropped words.
    const burrito = item('burr', 'Trailside Bean & Cheese Burrito')
    const draft = matchMealDraft(answer([named('Bean and Cheese Burrito', 170)]), [burrito])
    expect(draft.components).toEqual([{ itemId: 'burr', grams: 170 }])
    expect(draft.unmatched).toEqual([])
  })

  it('rounds matched grams to one decimal', () => {
    const draft = matchMealDraft(answer([ref(1, 80.347)]), library)
    expect(draft.components[0].grams).toBe(80.3)
  })

  it('snaps piece-based items to whole units (no 1.11 tortillas)', () => {
    const tortillas: Item = { ...item('tort', 'Flour Tortillas'), unitWeightG: 54, unitName: 'tortilla' }
    // 60 g ≈ 1.11 tortillas → snap to 1 tortilla (54 g).
    expect(matchMealDraft(answer([ref(1, 60)]), [tortillas]).components).toEqual([
      { itemId: 'tort', grams: 54 },
    ])
    // 90 g ≈ 1.67 → snap up to 2 tortillas (108 g).
    expect(matchMealDraft(answer([ref(1, 90)]), [tortillas]).components).toEqual([
      { itemId: 'tort', grams: 108 },
    ])
    // Always at least one piece, even for a tiny amount.
    expect(matchMealDraft(answer([ref(1, 5)]), [tortillas]).components).toEqual([
      { itemId: 'tort', grams: 54 },
    ])
  })
})
