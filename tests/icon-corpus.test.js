/**
 * The icon corpus convention — one definition, four call sites.
 *
 * `@uniweb/icons`' `scripts/build-cdn.js` WRITES `{family}/{family}-{name}.svg`;
 * `@uniweb/runtime` (browser + SSR isolate) and this package's sibling resolver
 * READ it back. Those halves drifting is the defect this module exists to
 * prevent, so the rule gets pinned here rather than restated at each site.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { DEFAULT_ICON_BASE, corpusIconName, iconPath, iconUrl } from '../src/icon-corpus.js'

describe('iconPath', () => {
  it('groups by family and prefixes the filename with it', () => {
    expect(iconPath('lu', 'house')).toBe('lu/lu-house.svg')
  })

  it('keeps the family prefix distinct from the directory for suffixed families', () => {
    // `hi` and `hi2` are different corpora; the prefix is what stops
    // `academic-cap` being ambiguous between them.
    expect(iconPath('hi2', 'academic-cap')).toBe('hi2/hi2-academic-cap.svg')
    expect(iconPath('hi', 'academic-cap')).toBe('hi/hi-academic-cap.svg')
  })

  it('passes multi-segment ids through unchanged', () => {
    expect(iconPath('lu', 'a-arrow-down')).toBe('lu/lu-a-arrow-down.svg')
  })
})

describe('corpusIconName — a family\u2019s own spelling answers too', () => {
  it("reads Lucide's names as Lucide's site spells them (measured 404 until 2026-10-24)", () => {
    expect(iconPath('lu', 'building-2')).toBe('lu/lu-building2.svg')
    expect(iconPath('lu', 'grid-2x2')).toBe('lu/lu-grid2-x2.svg')
    expect(corpusIconName('lu', 'arrow-down-0-1')).toBe('arrow-down01')
    expect(corpusIconName('lu', 'file-axis-3d')).toBe('file-axis3-d')
    expect(corpusIconName('lu', 'heading-1')).toBe('heading1')
  })

  it('does the same for Heroicons and Feather', () => {
    expect(corpusIconName('hi2', 'bars-3-bottom-left')).toBe('bars3-bottom-left')
    expect(corpusIconName('fi', 'bar-chart-2')).toBe('bar-chart2')
  })

  it('leaves a name the corpus already spells as it is', () => {
    for (const name of ['building2', 'grid2-x2', 'arrow-down01', 'house', 'a-arrow-down']) {
      expect(corpusIconName('lu', name)).toBe(name)
    }
  })

  it("never touches a family the rule would move: Material's 3d-rotation stays", () => {
    expect(corpusIconName('md', '3d-rotation')).toBe('3d-rotation')
    expect(corpusIconName('tb', 'cube3d-sphere')).toBe('cube3d-sphere')
  })
})

describe('iconUrl', () => {
  it('defaults to the framework corpus — the address of OUR artifact', () => {
    expect(iconUrl('lu', 'house')).toBe(`${DEFAULT_ICON_BASE}/lu/lu-house.svg`)
  })

  it('joins a host origin without doubling the separator', () => {
    expect(iconUrl('lu', 'house', 'https://cdn.test')).toBe('https://cdn.test/lu/lu-house.svg')
    expect(iconUrl('lu', 'house', 'https://cdn.test/')).toBe('https://cdn.test/lu/lu-house.svg')
    expect(iconUrl('lu', 'house', 'https://cdn.test///')).toBe('https://cdn.test/lu/lu-house.svg')
  })

  it('honours a subpath on the origin', () => {
    expect(iconUrl('lu', 'house', 'https://cdn.test/icons')).toBe(
      'https://cdn.test/icons/lu/lu-house.svg'
    )
  })
})

/**
 * `ssr-renderer.js` is bundled into the SSR isolate that runs in a Cloudflare
 * Worker, and it imports this module. A Worker has no `node:*` and no DOM, and
 * the bare `@uniweb/core` root pulls semantic-parser + theming — which is why
 * this is a subpath at all. The constraint is invisible until a deploy fails,
 * so assert it here.
 *
 * Same guard shape as @uniweb/projections' environment test, narrowed to one
 * file because this module must stay a leaf.
 */
describe('worker safety', () => {
  it('imports nothing at all', async () => {
    const src = await readFile(new URL('../src/icon-corpus.js', import.meta.url), 'utf8')
    const imports = [...src.matchAll(/^\s*import\s.+?from\s+['"](.+?)['"]/gm)].map((m) => m[1])
    const requires = [...src.matchAll(/\brequire\(\s*['"](.+?)['"]\s*\)/g)].map((m) => m[1])

    expect([...imports, ...requires]).toEqual([])
  })
})
