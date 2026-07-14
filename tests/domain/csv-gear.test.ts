import { describe, expect, it } from 'vitest'
import { gearToCsv, parseGearCsv } from '../../src/domain/csv/gear'
import type { GearItem } from '../../src/domain/types'

describe('parseGearCsv — LighterPack format', () => {
  it('reads Item Name / Category / qty / weight / unit / worn / consumable', () => {
    const csv = [
      'Item Name,Category,qty,weight,unit,worn,consumable',
      'Duplex,Shelter,1,19,oz,,',
      'Sun hoodie,Clothing,1,140,g,x,',
      'Fuel,Cooking,1,220,g,,x',
      'Trekking poles,Pack,2,200,g,,',
    ].join('\n')
    const { rows, issues } = parseGearCsv(csv)
    expect(issues).toEqual([])
    const byName = new Map(rows.map((r) => [r.fields.name, r.fields]))
    expect(byName.get('Duplex')?.weightG).toBe(539) // 19 oz → 538.6 → 539
    expect(byName.get('Sun hoodie')).toMatchObject({ weightG: 140, wornWeightG: 140 }) // worn=x
    expect(byName.get('Fuel')).toMatchObject({ weightG: 220, consumableWeightG: 220 })
    expect(byName.get('Trekking poles')?.weightG).toBe(400) // 200 g × qty 2
  })

  it('reports a bad weight without dropping good rows', () => {
    const csv = 'name,weight,unit\nGood,100,g\nBad,,g'
    const { rows, issues } = parseGearCsv(csv)
    expect(rows.map((r) => r.fields.name)).toEqual(['Good'])
    expect(issues[0].reason).toMatch(/weight/)
  })
})

describe('parseGearCsv — own format round-trip', () => {
  it('reads back what gearToCsv writes', () => {
    const gear: GearItem[] = [
      { id: 'a', name: 'Quilt', brand: 'EE', category: 'sleep', weightG: 560 },
      { id: 'b', name: 'Fuel', category: 'cooking', weightG: 220, consumableWeightG: 100 },
    ]
    const { rows, issues } = parseGearCsv(gearToCsv(gear))
    expect(issues).toEqual([])
    expect(rows.map((r) => r.fields)).toEqual([
      { name: 'Quilt', brand: 'EE', category: 'sleep', weightG: 560, wornWeightG: undefined, consumableWeightG: undefined, shared: undefined },
      { name: 'Fuel', brand: undefined, category: 'cooking', weightG: 220, wornWeightG: undefined, consumableWeightG: 100, shared: undefined },
    ])
  })

  it('round-trips one or several owners', () => {
    const gear: GearItem[] = [
      { id: 'h', name: 'Sun hoodie', category: 'clothing', weightG: 140, owners: ['Alice'] },
      { id: 'p', name: 'Puffy', category: 'clothing', weightG: 300, owners: ['Alice', 'Bob'] },
    ]
    const { rows, issues } = parseGearCsv(gearToCsv(gear))
    expect(issues).toEqual([])
    expect(rows[0].fields.owners).toEqual(['Alice'])
    expect(rows[1].fields.owners).toEqual(['Alice', 'Bob'])
  })
})
