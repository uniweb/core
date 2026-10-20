/**
 * A section’s own settings — `theme`, `background`, `grid`, `vars`, `sticky`, the names framework
 * reserves in its params (`@uniweb/schemas/section`). Framework applies each, so the Block
 * lifts each onto itself, normalized, and a component never receives one as a param
 * [Diego, 2026-09-28].
 */

import { describe, it, expect } from 'vitest'
import Block from '../src/block.js'
import Page from '../src/page.js'

function mockPage() {
  return {
    website: { getDefaultBlockType: () => 'DefaultSection' },
    getBlockIndex: () => 0,
    getBlockInfo: () => null,
  }
}

const build = (params) => new Block({ type: 'Hero', content: { type: 'doc', content: [] }, params }, 's0', mockPage())

describe('the params a component receives', () => {
  it('hold only its own — none of the section’s settings', () => {
    const block = build({ theme: 'dark', background: '#123456', grid: 3, vars: { gap: '2rem' }, layout: 'center' })
    expect(block.properties).toEqual({ layout: 'center' })
  })

  it('hold an older editor envelope as an ordinary param — it is no longer read (2026-09-28)', () => {
    const standardOptions = { background: { mode: 'color', color: 'red' } }
    const block = build({ standardOptions, layout: 'center' })
    expect(block.properties).toEqual({ standardOptions, layout: 'center' })
    expect(block.background).toBeNull()
    expect(block).not.toHaveProperty('standardOptions')
  })

  it('come from the params themselves, never from a nested `properties`', () => {
    const block = build({ properties: { theme: 'dark', layout: 'grid' }, layout: 'center' })
    expect(block.themeName).toBe('')
    expect(block.properties).toEqual({ properties: { theme: 'dark', layout: 'grid' }, layout: 'center' })
  })

  it('do not change the stored params', () => {
    const params = { theme: 'dark', layout: 'center' }
    build(params)
    expect(params).toEqual({ theme: 'dark', layout: 'center' })
  })
})

describe('block.themeName and block.themeOverrides', () => {
  it('`theme: dark` pins the context and overrides nothing', () => {
    const block = build({ theme: 'dark' })
    expect(block.themeName).toBe('dark')
    expect(block.themeOverrides).toBeNull()
  })

  it('no theme follows the site: Auto', () => {
    expect(build({}).themeName).toBe('')
  })

  it('the object form takes theme.yml’s keys, and a token beside `mode`', () => {
    const block = build({
      theme: {
        mode: 'dark',
        colors: { primary: '#0a6' },
        contexts: { dark: { link: 'accent-300' }, light: { link: 'accent-700' } },
        vars: { 'header-height': '5rem' },
        heading: 'primary-900',
      },
    })
    expect(block.themeName).toBe('dark')
    expect(block.themeOverrides).toEqual({
      colors: { primary: '#0a6' },
      contexts: { dark: { link: 'var(--accent-300)' }, light: { link: 'var(--accent-700)' } },
      vars: { 'header-height': '5rem' },
      tokens: { heading: 'var(--primary-900)' },
    })
  })

  it('a neighbour sees the tokens in effect in the section’s own context', () => {
    const block = build({ theme: { mode: 'dark', contexts: { dark: { link: 'a' }, light: { link: 'b' } }, heading: 'h' } })
    expect(block.contextOverrides).toEqual({ link: 'a', heading: 'h' })
    expect(block.getBlockInfo().contextOverrides).toEqual({ link: 'a', heading: 'h' })
  })

  it('a section that follows the site applies inline only the tokens it sets in no context', () => {
    const block = build({ theme: { heading: 'h', link: 'any', contexts: { dark: { link: 'dark-only' } } } })
    expect(block.contextOverrides).toEqual({ heading: 'h' })
  })

  it('a token is a name and a value a stylesheet can hold, or nothing', () => {
    // Applied inline and in the page stylesheet, so a value that could end its
    // declaration or its element is left out (@uniweb/theming's isCssValue).
    const block = build({
      theme: { heading: 'red;}</style><script>x</script>', 'a{b': '#fff', body: '#222', contexts: { dark: { link: 'url(javascript:x)' } } },
    })
    expect(block.contextOverrides).toEqual({ body: '#222' })
    expect(block.themeOverrides.contexts).toBeNull()
  })

  it('a context’s own token beats one written beside `mode`', () => {
    const block = build({ theme: { mode: 'dark', heading: 'any', contexts: { dark: { heading: 'dark-only' } } } })
    expect(block.contextOverrides).toEqual({ heading: 'dark-only' })
  })

  it('the flat form documented before keeps working: tokens beside `mode`', () => {
    const block = build({ theme: { mode: 'light', primary: 'neutral-900' } })
    expect(block.themeName).toBe('light')
    expect(block.themeOverrides.tokens).toEqual({ primary: 'var(--neutral-900)' })
  })
})

describe('block.background', () => {
  it('is the background normalized once, for every renderer', () => {
    expect(build({ background: '/img/hero.jpg' }).background).toMatchObject({ mode: 'image', image: { src: '/img/hero.jpg' } })
    expect(build({ background: 'linear-gradient(red, blue)' }).background).toEqual({ mode: 'gradient', gradient: 'linear-gradient(red, blue)' })
  })

  it('is null when the section sets none', () => {
    expect(build({}).background).toBeNull()
  })

  it('is the section’s own, never an older editor envelope’s', () => {
    const block = build({ standardOptions: { background: { mode: 'color', color: 'red' } }, background: 'blue' })
    expect(block.background).toEqual({ mode: 'color', color: 'blue' })
  })
})

describe('the component’s variables', () => {
  it('are kept for the stylesheet, not handed to the component', () => {
    const block = build({ vars: { gap: '2rem' } })
    expect(block.sectionVars).toEqual({ gap: '2rem' })
    expect(block.properties).not.toHaveProperty('vars')
  })

  it('override the defaults the component declares, once the component is known', () => {
    const saved = globalThis.uniweb
    globalThis.uniweb = {
      getComponent: () => () => null,
      getComponentMeta: () => ({ vars: { gap: { default: '1rem' }, radius: '4px' } }),
    }
    try {
      const block = build({ vars: { gap: '2rem', undeclared: 'x' } })
      block.initComponent()
      expect(block.componentVars).toEqual({ gap: '2rem', radius: '4px' })
    } finally {
      globalThis.uniweb = saved
    }
  })
})

describe('block.fetch — the section’s own data', () => {
  it('reads `params.fetch`, where a stored section carries it, and keeps it from the component', () => {
    const block = build({ fetch: { query: 'members', as: 'team' }, layout: 'grid' })
    expect(block.fetch).toEqual({ query: 'members', as: 'team' })
    expect(block.properties).toEqual({ layout: 'grid' })
  })

  it('reads the `fetch` beside the params — framework’s own build output — when params hold none', () => {
    const block = new Block({ type: 'Team', content: { type: 'doc', content: [] }, params: {}, fetch: { query: 'members' } }, 's0', mockPage())
    expect(block.fetch).toEqual({ query: 'members' })
  })

  it('prefers `params.fetch` when both are present', () => {
    const block = new Block(
      { type: 'Team', content: { type: 'doc', content: [] }, params: { fetch: { query: 'new' } }, fetch: { query: 'old' } },
      's0',
      mockPage()
    )
    expect(block.fetch).toEqual({ query: 'new' })
  })
})

describe('sectionFetches — a page’s sections’ own data, from raw content', () => {
  it('reads `params.fetch` first, then the `fetch` beside the params, at any depth', async () => {
    const { sectionFetches } = await import('../src/fetch-config.js')
    const sections = [
      { params: { fetch: { query: 'a' } } },
      { fetch: { query: 'b' }, subsections: [{ params: { fetch: { query: 'c' } }, fetch: { query: 'stale' } }] },
    ]
    expect(sectionFetches(sections)).toEqual([{ query: 'a' }, { query: 'b' }, { query: 'c' }])
  })
})

describe('block.sticky and block.stickyTop', () => {
  // A component's own markup sits in boxes as tall as itself, where `sticky` cannot move, so the
  // section asks and the runtime makes sticky the box that can (2026-10-19).
  const withFoundation = (meta, fn) => {
    const prev = globalThis.uniweb
    globalThis.uniweb = { getComponent: () => () => null, getComponentMeta: () => meta }
    try {
      return fn()
    } finally {
      globalThis.uniweb = prev
    }
  }
  const initialized = (params, meta) => withFoundation(meta, () => {
    const block = build(params)
    block.initComponent()
    return block
  })

  it('is a setting of the section: lifted onto the block, never a param', () => {
    const block = build({ sticky: true, layout: 'center' })
    expect(block.sticky).toBe(true)
    expect(block.properties).toEqual({ layout: 'center' })
  })

  it('takes a boolean only — anything else is no answer', () => {
    expect(build({ sticky: false }).sticky).toBe(false)
    expect(build({ sticky: 'yes' }).stickySetting).toBeNull()
    expect(build({ sticky: 'yes' }).properties).toEqual({})
  })

  it("defaults to its type's `meta.js` declaration, and the author's value wins", () => {
    expect(initialized({}, { sticky: true }).sticky).toBe(true)
    expect(initialized({ sticky: false }, { sticky: true }).sticky).toBe(false)
    expect(initialized({ sticky: true }, {}).sticky).toBe(true)
  })

  it('takes `top` from the object form, a CSS length', () => {
    const block = initialized({}, { sticky: { default: true, top: 'var(--header-height)' } })
    expect(block.sticky).toBe(true)
    expect(block.stickyTop).toBe('var(--header-height)')
  })

  it('CONTROL — a type that declares nothing does not stick, at the very top', () => {
    const block = initialized({}, {})
    expect(block.sticky).toBe(false)
    expect(block.stickyTop).toBeNull()
  })
})

describe('page.isSticky(area)', () => {
  // A layout that wraps an area in an element of its own asks, and makes that element sticky.
  const page = (areas) => ({ getLayoutAreas: () => areas })
  const isSticky = (areas, name) => Page.prototype.isSticky.call(page(areas), name)

  it('is true when any of the area’s sections is sticky', () => {
    expect(isSticky({ header: [{ sticky: false }, { sticky: true }] }, 'header')).toBe(true)
  })

  it('CONTROL — false when none is, and for an area the page does not draw', () => {
    expect(isSticky({ header: [{ sticky: false }] }, 'header')).toBe(false)
    expect(isSticky({ header: [{ sticky: true }] }, 'left')).toBe(false)
  })
})
