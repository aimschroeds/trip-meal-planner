import { describe, expect, it } from 'vitest'
import { ownerButtonClass, ownerColorClass } from '../../src/ui/ownerColor'

describe('ownerColorClass', () => {
  it('is stable for a given name', () => {
    expect(ownerColorClass('Aimee')).toBe(ownerColorClass('Aimee'))
  })

  it('ignores case and surrounding whitespace', () => {
    expect(ownerColorClass('  aimee ')).toBe(ownerColorClass('Aimee'))
  })

  it('usually gives different names different colours', () => {
    expect(ownerColorClass('Aimee')).not.toBe(ownerColorClass('Madre'))
  })

  it('always returns a bg + text class pair', () => {
    expect(ownerColorClass('anyone')).toMatch(/^bg-\w+-100 text-\w+-800$/)
  })
})

describe('ownerButtonClass', () => {
  it('is stable and case-insensitive', () => {
    expect(ownerButtonClass('  aimee ')).toBe(ownerButtonClass('Aimee'))
  })

  it('gives two people distinct filled colours (the reported bug)', () => {
    // Aimee and Madre must not both be green when both are "carried by".
    expect(ownerButtonClass('Aimee')).not.toBe(ownerButtonClass('Madre'))
  })

  it('returns a solid border + bg + white-text triple', () => {
    expect(ownerButtonClass('anyone')).toMatch(/^border-\w+-600 bg-\w+-600 text-white$/)
  })

  it('shares the same hue as the pill for a given name', () => {
    // Same palette index → the pill and the selected chip read as one colour.
    const hue = (c: string) => c.match(/-(\w+)-\d00/)?.[1]
    for (const name of ['Aimee', 'Madre', 'Bob', 'zoë']) {
      expect(hue(ownerButtonClass(name))).toBe(hue(ownerColorClass(name)))
    }
  })
})
