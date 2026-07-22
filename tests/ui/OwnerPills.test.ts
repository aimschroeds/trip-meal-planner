import { describe, expect, it } from 'vitest'
import { ownerColorClass } from '../../src/ui/ownerColor'

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
