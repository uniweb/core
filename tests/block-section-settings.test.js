/**
 * A section's own settings — `theme`, `background`, `grid`, `vars`, the names framework
 * reserves in its params (`@uniweb/schemas/section`). Framework applies each, so the Block
 * lifts each onto itself, normalized, and a component never receives one as a param
 * [Diego, 2026-09-28].
 */

import { describe, it, expect } from 'vitest'
import Block from '../src/block.js'

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

  it('leave out the older editor envelope too', () => {
    const block = build({ standardOptions: { background: { mode: 'color', color: 'red' } }, layout: 'center' })
    expect(block.properties).toEqual({ layout: 'center' })
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

  it('takes an editor’s older envelope while one is sent', () => {
    const block = build({ standardOptions: { background: { mode: 'color', color: 'red' } }, background: 'blue' })
    expect(block.background).toEqual({ mode: 'color', color: 'red' })
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
