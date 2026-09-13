import { describe, it, expect } from 'vitest'
import { layoutNameKey, findLayoutEntry } from '../src/layout-name.js'

describe('layoutNameKey — the one comparison for layout names', () => {
  it('ignores case and a trailing Layout, with or without a separator', () => {
    for (const name of ['docs', 'Docs', 'DOCS', 'DocsLayout', 'docslayout', 'docs-layout', 'Docs_Layout']) {
      expect(layoutNameKey(name)).toBe('docs')
    }
  })

  it('keeps a name that is only the suffix, and says null for nothing', () => {
    expect(layoutNameKey('Layout')).toBe('layout')
    expect(layoutNameKey('')).toBeNull()
    expect(layoutNameKey(null)).toBeNull()
  })
})

describe('findLayoutEntry', () => {
  it('exact, then case, then suffix', () => {
    const map = { docs: 1, Docs: 2, DocsLayout: 3, marketing: 4 }
    expect(findLayoutEntry(map, 'Docs')).toBe(2)
    expect(findLayoutEntry(map, 'DOCS')).toBe(1)
    expect(findLayoutEntry(map, 'DocsLayout')).toBe(3)
    expect(findLayoutEntry(map, 'MarketingLayout')).toBe(4)
    expect(findLayoutEntry(map, 'blog')).toBeUndefined()
  })
})
