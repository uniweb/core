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
import { DEFAULT_ICON_BASE, iconPath, iconUrl } from '../src/icon-corpus.js'

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
