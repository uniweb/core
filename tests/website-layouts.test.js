/**
 * How a page finds its layout: by name, regardless of case, and with no borrowing.
 *
 * ⭐ A page's `layout:`, the foundation's `defaultLayout`, the foundation's layout
 * components and a site's `layout/<name>/` folder name one layout whatever their
 * case, and with or without a trailing `Layout` (both ruled 2026-09-13). ⛔ They
 * matched exactly until then, so `layout: Docs` found neither the foundation's
 * `docs` layout nor the site's `layout/docs/` areas, and a foundation's `DocsLayout`
 * needed the folder `layout/DocsLayout/`.
 *
 * ⭐ A named layout's areas are its own: an area it does not have is absent, never
 * taken from the default layout — named layouts are usually very different layouts.
 */

import { describe, it, expect, afterEach } from 'vitest'
import Website from '../src/website.js'

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const area = (route, type) => ({ route, title: type, description: '', layout: {}, sections: [{ type, content: doc(type) }] })

function website(pageLayout) {
  return new Website({
    content: {
      config: { name: 'Test', defaultLanguage: 'en' },
      theme: {},
      pages: [{ route: '/', isIndex: true, title: 'Home', layout: pageLayout ? { name: pageLayout } : {}, sections: [] }],
      layouts: {
        default: { header: area('/layout/header', 'Header'), footer: area('/layout/footer', 'Footer') },
        docs: { header: area('/layout/docs/header', 'DocsHeader') },
      },
    },
  })
}

const types = (blocks) => (blocks || []).map((b) => b.type)

afterEach(() => {
  delete globalThis.uniweb
})

describe('a layout name matches regardless of case', () => {
  it('finds the site\'s layout areas for a page whose layout name differs in case', () => {
    const w = website('Docs')
    expect(types(w.pages[0].getAreaBlocks('header'))).toEqual(['DocsHeader'])
    expect(Object.keys(w.pages[0].getLayoutAreas())).toEqual(['header'])
  })

  it('finds the foundation\'s layout component and its meta in any case', () => {
    const DocsLayout = () => null
    globalThis.uniweb = { foundationConfig: { layouts: { docs: DocsLayout }, layoutMeta: { docs: { scroll: 'self' } } } }
    const w = website('DOCS')
    expect(w.getRemoteLayout('DOCS')).toBe(DocsLayout)
    expect(w.getLayoutMeta('Docs')).toEqual({ scroll: 'self' })
    expect(w.getRemoteLayout('marketing')).toBe(null)
  })

  it('prefers an exact key when two differ only in case', () => {
    const Lower = () => null
    const Upper = () => null
    globalThis.uniweb = { foundationConfig: { layouts: { docs: Lower, Docs: Upper } } }
    expect(website().getRemoteLayout('Docs')).toBe(Upper)
  })
})

describe('a trailing `Layout` is optional — the folder need not repeat it (ruled 2026-09-13)', () => {
  it('the site\'s `layout/docs/` areas serve a page whose layout is the foundation\'s `DocsLayout`', () => {
    const w = website('DocsLayout')
    expect(types(w.pages[0].getAreaBlocks('header'))).toEqual(['DocsHeader'])
  })

  it('the foundation\'s `DocsLayout` component and meta answer `layout: docs`', () => {
    const DocsLayout = () => null
    globalThis.uniweb = { foundationConfig: { layouts: { DocsLayout }, layoutMeta: { DocsLayout: { scroll: 'self' } } } }
    const w = website('docs')
    expect(w.getRemoteLayout('docs')).toBe(DocsLayout)
    expect(w.getLayoutMeta('docs')).toEqual({ scroll: 'self' })
  })

  it('an exact or case-only match still wins over one that differs by the suffix', () => {
    const Docs = () => null
    const DocsLayout = () => null
    globalThis.uniweb = { foundationConfig: { layouts: { Docs, DocsLayout } } }
    expect(website().getRemoteLayout('DocsLayout')).toBe(DocsLayout)
    expect(website().getRemoteLayout('docs')).toBe(Docs)
  })
})

describe('a named layout does not borrow the default layout\'s areas', () => {
  it('has no footer when it declares none, though the default layout has one', () => {
    const w = website('docs')
    expect(w.pages[0].getAreaBlocks('footer')).toBe(null)
  })

  it('falls back to the default layout only when the page\'s layout has no areas at all', () => {
    const w = website('marketing')
    expect(types(w.pages[0].getAreaBlocks('footer'))).toEqual(['Footer'])
  })
})

describe('the site\'s binding reaches layout sections and top-level pages, and no deeper (ruled 2026-09-13)', () => {
  const team = [{ name: 'Ada' }]
  const siteFetch = { query: 'team', path: '/data/team.json', as: 'team' }
  const make = () => {
    const w = new Website({
      content: {
        config: { name: 'Test', defaultLanguage: 'en', fetch: siteFetch },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [{ type: 'Hero', content: doc('Hero') }] },
          { route: '/about', title: 'About', sections: [{ type: 'Text', content: doc('About') }] },
          { route: '/about/team', title: 'Team', sections: [{ type: 'Text', content: doc('Team') }] },
        ],
        layouts: { default: { header: area('/layout/header', 'Header') } },
      },
    })
    w.dataStore.set(JSON.stringify({ path: '/data/team.json', as: 'team' }), { data: team })
    return w
  }
  // a component that declares `team` (a section receives only what its component declares)
  const delivered = (w, block) => w.entityStore.resolve(block, { data: { team: null } })

  it('a layout section gets it — the layout belongs to the site', () => {
    const w = make()
    const [header] = w.getAreaBlocks('header')
    expect(delivered(w, header)).toEqual({ status: 'ready', data: { team } })
  })

  it('a top-level page\'s sections get it', () => {
    const w = make()
    expect(delivered(w, w.getPage('/about').bodyBlocks[0])).toEqual({ status: 'ready', data: { team } })
  })

  it('⛔ a page under a page does not', () => {
    const w = make()
    expect(delivered(w, w.getPage('/about/team').bodyBlocks[0])).toEqual({ status: 'none', data: null })
  })
})
