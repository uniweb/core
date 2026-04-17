import { describe, it, expect } from '@jest/globals'
import Uniweb from '../src/uniweb.js'

// Minimal foundation mock — components as direct properties, meta under default.
function mockFoundation(components, meta = {}) {
  return { ...components, default: { meta } }
}

function build({ foundation = null, extensions = [] } = {}) {
  return new Uniweb({ content: { pages: [] }, foundation, extensions })
}

describe('Uniweb', () => {
  describe('extensions', () => {
    it('initializes with empty extensions when none passed', () => {
      const uniweb = build()
      expect(uniweb.extensions).toEqual([])
    })

    it('registers extensions passed to the constructor', () => {
      const ext = mockFoundation({ Foo: () => 'foo' })
      const uniweb = build({ extensions: [ext] })
      expect(uniweb.extensions).toHaveLength(1)
    })
  })

  describe('getComponent', () => {
    it('returns component from primary foundation', () => {
      const Hero = () => 'hero'
      const uniweb = build({ foundation: mockFoundation({ Hero }) })
      expect(uniweb.getComponent('Hero')).toBe(Hero)
    })

    it('falls through to extension when not in primary', () => {
      const Particle = () => 'particle'
      const uniweb = build({
        foundation: mockFoundation({ Hero: () => 'hero' }),
        extensions: [mockFoundation({ Particle })],
      })
      expect(uniweb.getComponent('Particle')).toBe(Particle)
    })

    it('primary wins on name collision', () => {
      const PrimaryHero = () => 'primary'
      const ExtHero = () => 'extension'
      const uniweb = build({
        foundation: mockFoundation({ Hero: PrimaryHero }),
        extensions: [mockFoundation({ Hero: ExtHero })],
      })
      expect(uniweb.getComponent('Hero')).toBe(PrimaryHero)
    })

    it('checks extensions in declared order', () => {
      const Chart1 = () => 'chart1'
      const Chart2 = () => 'chart2'
      const uniweb = build({
        foundation: mockFoundation({}),
        extensions: [mockFoundation({ Chart: Chart1 }), mockFoundation({ Chart: Chart2 })],
      })
      expect(uniweb.getComponent('Chart')).toBe(Chart1)
    })

    it('returns undefined for unknown component', () => {
      const uniweb = build({
        foundation: mockFoundation({}),
        extensions: [mockFoundation({ Foo: () => 'foo' })],
      })
      expect(uniweb.getComponent('Unknown')).toBeUndefined()
    })
  })

  describe('getComponentMeta', () => {
    it('returns meta from primary foundation', () => {
      const meta = { defaults: { color: 'blue' } }
      const uniweb = build({ foundation: mockFoundation({}, { Hero: meta }) })
      expect(uniweb.getComponentMeta('Hero')).toBe(meta)
    })

    it('falls through to extension meta', () => {
      const meta = { defaults: { speed: 2 } }
      const uniweb = build({
        foundation: mockFoundation({}, {}),
        extensions: [mockFoundation({}, { Particle: meta })],
      })
      expect(uniweb.getComponentMeta('Particle')).toBe(meta)
    })

    it('primary meta wins on collision', () => {
      const primaryMeta = { defaults: { color: 'blue' } }
      const extMeta = { defaults: { color: 'red' } }
      const uniweb = build({
        foundation: mockFoundation({}, { Hero: primaryMeta }),
        extensions: [mockFoundation({}, { Hero: extMeta })],
      })
      expect(uniweb.getComponentMeta('Hero')).toBe(primaryMeta)
    })

    it('returns null for unknown component', () => {
      const uniweb = build({ foundation: mockFoundation({}, {}) })
      expect(uniweb.getComponentMeta('Unknown')).toBeNull()
    })
  })

  describe('getComponentDefaults', () => {
    it('returns defaults from primary', () => {
      const uniweb = build({ foundation: mockFoundation({}, { Hero: { defaults: { color: 'blue' } } }) })
      expect(uniweb.getComponentDefaults('Hero')).toEqual({ color: 'blue' })
    })

    it('falls through to extension defaults', () => {
      const uniweb = build({
        foundation: mockFoundation({}, {}),
        extensions: [mockFoundation({}, { Particle: { defaults: { speed: 2 } } })],
      })
      expect(uniweb.getComponentDefaults('Particle')).toEqual({ speed: 2 })
    })

    it('returns empty object for unknown component', () => {
      const uniweb = build({ foundation: mockFoundation({}, {}) })
      expect(uniweb.getComponentDefaults('Unknown')).toEqual({})
    })
  })

  describe('listComponents', () => {
    it('lists primary components', () => {
      const uniweb = build({ foundation: mockFoundation({ Hero: () => {}, Footer: () => {} }) })
      expect(uniweb.listComponents()).toEqual(['Hero', 'Footer'])
    })

    it('includes extension components', () => {
      const uniweb = build({
        foundation: mockFoundation({ Hero: () => {} }),
        extensions: [mockFoundation({ Particle: () => {} })],
      })
      const names = uniweb.listComponents()
      expect(names).toContain('Hero')
      expect(names).toContain('Particle')
    })

    it('deduplicates names across primary and extensions', () => {
      const uniweb = build({
        foundation: mockFoundation({ Hero: () => {} }),
        extensions: [mockFoundation({ Hero: () => {}, Chart: () => {} })],
      })
      const names = uniweb.listComponents()
      expect(names.filter((n) => n === 'Hero')).toHaveLength(1)
      expect(names).toContain('Chart')
    })

    it('returns empty array with no foundation', () => {
      const uniweb = build()
      expect(uniweb.listComponents()).toEqual([])
    })
  })
})
