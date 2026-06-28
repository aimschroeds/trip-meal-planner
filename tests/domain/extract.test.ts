import { describe, expect, it } from 'vitest'
import { parseExtractedItem } from '../../src/domain/extract'

const valid = JSON.stringify({
  name: "Firepot Mac'n'Greens",
  weight_grams: 200,
  calories_per_package: 850,
  vegetarian: true,
})

describe('parseExtractedItem', () => {
  it('accepts a complete answer', () => {
    expect(parseExtractedItem(valid)).toEqual({
      ok: true,
      item: { name: "Firepot Mac'n'Greens", brand: null, weightG: 200, calories: 850, vegetarian: true },
    })
  })

  it('extracts the brand separately from the name', () => {
    const result = parseExtractedItem(
      '{"name": "Dal & rice with spinach", "brand": "Firepot", "weight_grams": 200, "calories_per_package": 760, "vegetarian": true}',
    )
    expect(result).toEqual({
      ok: true,
      item: {
        name: 'Dal & rice with spinach',
        brand: 'Firepot',
        weightG: 200,
        calories: 760,
        vegetarian: true,
      },
    })
  })

  it('accepts nulls for unreadable values', () => {
    const result = parseExtractedItem(
      '{"name": "Mystery bar", "brand": null, "weight_grams": null, "calories_per_package": null, "vegetarian": null}',
    )
    expect(result).toEqual({
      ok: true,
      item: { name: 'Mystery bar', brand: null, weightG: null, calories: null, vegetarian: null },
    })
  })

  it('tolerates a fenced code block around the JSON', () => {
    const result = parseExtractedItem('```json\n' + valid + '\n```')
    expect(result.ok).toBe(true)
  })

  it('rejects non-JSON', () => {
    expect(parseExtractedItem('I could not read the label')).toEqual({
      ok: false,
      error: 'the model did not return valid JSON',
    })
  })

  it('rejects a missing or blank name', () => {
    const result = parseExtractedItem(
      '{"name": " ", "weight_grams": 200, "calories_per_package": 850, "vegetarian": true}',
    )
    expect(result).toEqual({ ok: false, error: 'missing product name' })
  })

  it('rejects non-positive weight', () => {
    const result = parseExtractedItem(
      '{"name": "X", "weight_grams": 0, "calories_per_package": 850, "vegetarian": true}',
    )
    expect(result.ok).toBe(false)
  })

  it('rejects wrong types with the offending field named', () => {
    const result = parseExtractedItem(
      '{"name": "X", "weight_grams": "200g", "calories_per_package": 850, "vegetarian": true}',
    )
    expect(result).toEqual({
      ok: false,
      error: 'weight_grams must be a number or null, got "200g"',
    })
  })
})
