import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'
import { normalizeSeo } from '../src/seo.js'

function content(overrides = {}) {
  return {
    config: { name: 'Test', defaultLanguage: 'en', ...overrides.config },
    theme: {},
    pages: [
      { route: '/', isIndex: true, title: 'Home', sections: [], ...(overrides.home || {}) },
      {
        route: '/about',
        title: 'About',
        description: 'About us',
        sections: [],
        ...(overrides.about || {}),
      },
    ],
  }
}

describe('normalizeSeo', () => {
  it('returns the full canonical shape with null/false defaults', () => {
    expect(normalizeSeo(undefined)).toEqual({
      noindex: false,
      image: null,
      ogTitle: null,
      ogDescription: null,
      canonical: null,
      changefreq: null,
      priority: null,
    })
  })

  it('passes authored fields through, defaulting the rest', () => {
    const s = normalizeSeo({ image: '/og.png', ogTitle: 'T', noindex: true })
    expect(s.image).toBe('/og.png')
    expect(s.ogTitle).toBe('T')
    expect(s.noindex).toBe(true)
    expect(s.canonical).toBeNull()
  })
})

describe('Website site-level seo/keywords', () => {
  it('normalizes config.seo and carries config.keywords', () => {
    const w = new Website({
      content: content({
        config: { seo: { image: '/site-og.png', ogTitle: 'Site' }, keywords: ['a', 'b'] },
      }),
    })
    expect(w.seo.image).toBe('/site-og.png')
    expect(w.seo.ogTitle).toBe('Site')
    expect(w.keywords).toEqual(['a', 'b'])
  })

  it('defaults to empty normalized seo and null keywords', () => {
    const w = new Website({ content: content() })
    expect(w.seo).toEqual(normalizeSeo(null))
    expect(w.keywords).toBeNull()
  })
})

describe('Page.getHeadMeta cascade (page over site, site fills gaps)', () => {
  it('inherits the site social image + keywords when the page sets none', () => {
    const w = new Website({
      content: content({
        config: {
          seo: { image: '/site-og.png', ogTitle: 'Site OG', ogDescription: 'Site desc' },
          keywords: ['shared'],
        },
      }),
    })
    const about = w.pages.find((p) => p.route === '/about')
    const meta = about.getHeadMeta()
    expect(meta.og.image).toBe('/site-og.png') // inherited from site
    expect(meta.og.title).toBe('About') // page title wins over site ogTitle
    expect(meta.og.description).toBe('About us') // page description wins
    expect(meta.keywords).toEqual(['shared']) // inherited site keywords
  })

  it('lets page seo override site seo per-field', () => {
    const w = new Website({
      content: content({
        config: { seo: { image: '/site-og.png' }, keywords: ['shared'] },
        about: {
          seo: { image: '/about-og.png', ogTitle: 'Custom', noindex: true },
          keywords: ['own'],
        },
      }),
    })
    const about = w.pages.find((p) => p.route === '/about')
    const meta = about.getHeadMeta()
    expect(meta.og.image).toBe('/about-og.png') // page overrides site
    expect(meta.og.title).toBe('Custom') // page ogTitle
    expect(meta.keywords).toEqual(['own']) // page keywords override
    expect(meta.robots).toBe('noindex, nofollow') // page noindex
  })

  it('cascades site-level noindex to pages that do not set it', () => {
    const w = new Website({ content: content({ config: { seo: { noindex: true } } }) })
    const about = w.pages.find((p) => p.route === '/about')
    expect(about.getHeadMeta().robots).toBe('noindex, nofollow')
  })

  it('falls back to the site og title only when a page has no title', () => {
    const w = new Website({
      content: content({
        config: { seo: { ogTitle: 'Site Default' } },
        about: { title: '' },
      }),
    })
    const about = w.pages.find((p) => p.route === '/about')
    expect(about.getHeadMeta().og.title).toBe('Site Default')
  })
})
