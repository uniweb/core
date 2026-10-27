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
      twitterHandle: null,
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

describe('Page.getHeadMeta — absolute URLs on the site’s address (`config.url`)', () => {
  const PAGES = 'https://octocat.github.io/handbook/'

  it('⭐ each page names ITSELF as its canonical and og:url — not the home page', () => {
    const w = new Website({ content: content({ config: { url: PAGES, trailingSlash: true } }) })
    const about = w.pages.find((p) => p.route === '/about').getHeadMeta()
    expect(about.canonical).toBe(`${PAGES}about/`)
    expect(about.og.url).toBe(`${PAGES}about/`)
    expect(w.pages.find((p) => p.route === '/').getHeadMeta().canonical).toBe(PAGES)
  })

  it('states no canonical or og:url when the address is unknown — never a bare route', () => {
    const meta = new Website({ content: content() }).pages.find((p) => p.route === '/about').getHeadMeta()
    expect(meta.canonical).toBeNull()
    expect(meta.og.url).toBeNull()
    expect(meta.alternates).toEqual([])
  })

  it('an authored canonical wins, made absolute on the address', () => {
    const w = new Website({
      content: content({ config: { url: PAGES }, about: { seo: { canonical: '/team' } } }),
    })
    const meta = w.pages.find((p) => p.route === '/about').getHeadMeta()
    expect(meta.canonical).toBe(`${PAGES}team`)
    expect(meta.og.url).toBe(`${PAGES}team`)
  })

  it('the social card image is absolute, with the base path once', () => {
    const w = new Website({ content: content({ config: { url: PAGES, seo: { image: '/og/default.png' } } }) })
    expect(w.pages.find((p) => p.route === '/about').getHeadMeta().og.image).toBe(`${PAGES}og/default.png`)
    const absolute = new Website({ content: content({ config: { url: PAGES, seo: { image: 'https://cdn.example.com/c.png' } } }) })
    expect(absolute.pages.find((p) => p.route === '/about').getHeadMeta().og.image).toBe('https://cdn.example.com/c.png')
  })

  it('a site in several locales gives each page its URL in each, and the default as x-default', () => {
    const w = new Website({
      content: content({ config: { url: 'https://example.com', languages: ['en', 'fr'], trailingSlash: true } }),
    })
    expect(w.pages.find((p) => p.route === '/about').getHeadMeta().alternates).toEqual([
      { hreflang: 'en', url: 'https://example.com/about/' },
      { hreflang: 'fr', url: 'https://example.com/fr/about/' },
      { hreflang: 'x-default', url: 'https://example.com/about/' },
    ])
    const one = new Website({ content: content({ config: { url: 'https://example.com' } }) })
    expect(one.pages.find((p) => p.route === '/about').getHeadMeta().alternates).toEqual([])
  })

  describe('⭐ a locale on a domain of its own is named there, and the rest as the address serves them', () => {
    const i18n = { routeTranslations: { fr: { '/about': '/a-propos' }, de: { '/about': '/uber-uns' } } }
    /** acme.com is the address and acme.fr is French's own; `served` is the host serving the page. */
    const headOf = (served, path) => {
      const w = new Website({
        content: content({
          config: { url: 'https://acme.com/', languages: ['en', 'fr', 'de'], i18n, domainLocales: { 'acme.fr': 'fr' }, ...served },
        }),
      })
      w.setActivePage(path)
      return w.activePage.getHeadMeta()
    }
    const ALTERNATES = [
      { hreflang: 'en', url: 'https://acme.com/about' },
      { hreflang: 'fr', url: 'https://acme.fr/a-propos' },
      { hreflang: 'de', url: 'https://acme.com/de/uber-uns' },
      { hreflang: 'x-default', url: 'https://acme.com/about' },
    ]

    it('on the address', () => {
      const english = headOf({}, '/about')
      expect(english.canonical).toBe('https://acme.com/about')
      expect(english.alternates).toEqual(ALTERNATES)
    })

    it('⭐ on the domain pinned to French, which serves English at /en/… — the same URLs', () => {
      const french = headOf({ domainLocale: 'fr', activeLocale: 'fr' }, '/a-propos')
      expect(french.canonical).toBe('https://acme.fr/a-propos')
      expect(french.alternates).toEqual(ALTERNATES)
      // not `https://acme.com/en/about`, which the address answers with a 301 to `/about`
      const english = headOf({ domainLocale: 'fr', activeLocale: 'en' }, '/about')
      expect(english.canonical).toBe('https://acme.com/about')
      expect(english.alternates).toEqual(ALTERNATES)
    })

    it('an address on a domain pinned to a locale shows every other locale prefixed', () => {
      const w = new Website({
        content: content({
          config: { url: 'https://acme.fr/', languages: ['en', 'fr'], i18n, domainLocales: { 'acme.fr': 'fr' } },
        }),
      })
      // served where English is unprefixed; on the address it is not
      expect(w.pages.find((p) => p.route === '/about').getHeadMeta().alternates).toEqual([
        { hreflang: 'en', url: 'https://acme.fr/en/about' },
        { hreflang: 'fr', url: 'https://acme.fr/a-propos' },
        { hreflang: 'x-default', url: 'https://acme.fr/en/about' },
      ])
    })
  })

  it('the site’s description is the home page’s, and no other page’s', () => {
    const w = new Website({
      content: content({ config: { description: 'A site about things' }, about: { description: '' } }),
    })
    const home = w.pages.find((p) => p.route === '/').getHeadMeta()
    expect(home.description).toBe('A site about things')
    expect(home.og.description).toBe('A site about things')
    expect(w.pages.find((p) => p.route === '/about').getHeadMeta().description).toBeNull()
  })

  it('names the site and its account', () => {
    const w = new Website({ content: content({ config: { seo: { twitterHandle: '@acme' } } }) })
    const meta = w.pages.find((p) => p.route === '/about').getHeadMeta()
    expect(meta.og.siteName).toBe('Test')
    expect(meta.twitter.site).toBe('@acme')
  })
})
