import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_SECTION_TYPE, defaultSectionType } from '../src/section-type.js'
import Website from '../src/website.js'

describe('defaultSectionType — what renders a section that names none', () => {
  it("is the foundation's defaultSection when it declares one", () => {
    expect(defaultSectionType({ defaultSection: 'Prose' })).toBe('Prose')
  })

  it('is Section otherwise — no foundation, no declaration, or one that names nothing', () => {
    expect(DEFAULT_SECTION_TYPE).toBe('Section')
    for (const foundation of [undefined, null, {}, { defaultSection: '' }, { defaultSection: 42 }]) {
      expect(defaultSectionType(foundation)).toBe('Section')
    }
  })
})

describe('Website.getDefaultBlockType asks the same rule', () => {
  const saved = globalThis.uniweb
  afterEach(() => {
    globalThis.uniweb = saved
  })

  it("answers with the loaded foundation's declaration, else Section", () => {
    const website = Object.create(Website.prototype)
    globalThis.uniweb = { foundationConfig: { defaultSection: 'Prose' } }
    expect(website.getDefaultBlockType()).toBe('Prose')
    globalThis.uniweb = { foundationConfig: {} }
    expect(website.getDefaultBlockType()).toBe('Section')
  })
})
