import { describe, it, expect, beforeEach } from '@jest/globals'
import Uniweb from '../src/uniweb.js'

// Minimal foundation mock — components as direct properties, meta under default
function mockFoundation(components, meta = {}) {
  return { ...components, default: { meta } }
}

describe('Uniweb', () => {
  let uniweb

  beforeEach(() => {
    uniweb = new Uniweb({ pages: [] })
  })

  describe('extensions', () => {
    it('initializes with empty extensions array', () => {
      expect(uniweb.extensions).toEqual([])
    })

    it('registers an extension', () => {
      const ext = mockFoundation({ Foo: () => 'foo' })
      uniweb.registerExtension(ext)
      expect(uniweb.extensions).toHaveLength(1)
    })
  })

  describe('getComponent', () => {
    it('returns component from primary foundation', () => {
      const Hero = () => 'hero'
      uniweb.setFoundation(mockFoundation({ Hero }))
      expect(uniweb.getComponent('Hero')).toBe(Hero)
    })

    it('falls through to extension when not in primary', () => {
      const Particle = () => 'particle'
      uniweb.setFoundation(mockFoundation({ Hero: () => 'hero' }))
      uniweb.registerExtension(mockFoundation({ Particle }))
      expect(uniweb.getComponent('Particle')).toBe(Particle)
    })

    it('primary wins on name collision', () => {
      const PrimaryHero = () => 'primary'
      const ExtHero = () => 'extension'
      uniweb.setFoundation(mockFoundation({ Hero: PrimaryHero }))
      uniweb.registerExtension(mockFoundation({ Hero: ExtHero }))
      expect(uniweb.getComponent('Hero')).toBe(PrimaryHero)
    })

    it('checks extensions in declared order', () => {
      const Chart1 = () => 'chart1'
      const Chart2 = () => 'chart2'
      uniweb.setFoundation(mockFoundation({}))
      uniweb.registerExtension(mockFoundation({ Chart: Chart1 }))
      uniweb.registerExtension(mockFoundation({ Chart: Chart2 }))
      expect(uniweb.getComponent('Chart')).toBe(Chart1)
    })

    it('returns undefined for unknown component', () => {
      uniweb.setFoundation(mockFoundation({}))
      uniweb.registerExtension(mockFoundation({ Foo: () => 'foo' }))
      expect(uniweb.getComponent('Unknown')).toBeUndefined()
    })
  })

  describe('getComponentMeta', () => {
    it('returns meta from primary foundation', () => {
      const meta = { defaults: { color: 'blue' } }
      uniweb.setFoundation(mockFoundation({}, { Hero: meta }))
      expect(uniweb.getComponentMeta('Hero')).toBe(meta)
    })

    it('falls through to extension meta', () => {
      const meta = { defaults: { speed: 2 } }
      uniweb.setFoundation(mockFoundation({}, {}))
      uniweb.registerExtension(mockFoundation({}, { Particle: meta }))
      expect(uniweb.getComponentMeta('Particle')).toBe(meta)
    })

    it('primary meta wins on collision', () => {
      const primaryMeta = { defaults: { color: 'blue' } }
      const extMeta = { defaults: { color: 'red' } }
      uniweb.setFoundation(mockFoundation({}, { Hero: primaryMeta }))
      uniweb.registerExtension(mockFoundation({}, { Hero: extMeta }))
      expect(uniweb.getComponentMeta('Hero')).toBe(primaryMeta)
    })

    it('returns null for unknown component', () => {
      uniweb.setFoundation(mockFoundation({}, {}))
      expect(uniweb.getComponentMeta('Unknown')).toBeNull()
    })
  })

  describe('getComponentDefaults', () => {
    it('returns defaults from primary', () => {
      uniweb.setFoundation(mockFoundation({}, { Hero: { defaults: { color: 'blue' } } }))
      expect(uniweb.getComponentDefaults('Hero')).toEqual({ color: 'blue' })
    })

    it('falls through to extension defaults', () => {
      uniweb.setFoundation(mockFoundation({}, {}))
      uniweb.registerExtension(mockFoundation({}, { Particle: { defaults: { speed: 2 } } }))
      expect(uniweb.getComponentDefaults('Particle')).toEqual({ speed: 2 })
    })

    it('returns empty object for unknown component', () => {
      uniweb.setFoundation(mockFoundation({}, {}))
      expect(uniweb.getComponentDefaults('Unknown')).toEqual({})
    })
  })

  describe('listComponents', () => {
    it('lists primary components', () => {
      uniweb.setFoundation(mockFoundation({ Hero: () => {}, Footer: () => {} }))
      expect(uniweb.listComponents()).toEqual(['Hero', 'Footer'])
    })

    it('includes extension components', () => {
      uniweb.setFoundation(mockFoundation({ Hero: () => {} }))
      uniweb.registerExtension(mockFoundation({ Particle: () => {} }))
      const names = uniweb.listComponents()
      expect(names).toContain('Hero')
      expect(names).toContain('Particle')
    })

    it('deduplicates names across primary and extensions', () => {
      uniweb.setFoundation(mockFoundation({ Hero: () => {} }))
      uniweb.registerExtension(mockFoundation({ Hero: () => {}, Chart: () => {} }))
      const names = uniweb.listComponents()
      expect(names.filter(n => n === 'Hero')).toHaveLength(1)
      expect(names).toContain('Chart')
    })

    it('returns empty array with no foundation', () => {
      expect(uniweb.listComponents()).toEqual([])
    })
  })
})
