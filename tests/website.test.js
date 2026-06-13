import { describe, it, expect, vi } from 'vitest'
import Website from '../src/website.js'

function simpleContent(overrides = {}) {
  return {
    config: { name: 'Test', defaultLanguage: 'en', ...overrides.config },
    theme: {},
    pages: [
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/about', title: 'About', sections: [] },
    ],
    ...overrides,
  }
}

describe('Website constructor', () => {
  it('builds from { content } with no foundation', () => {
    const w = new Website({ content: simpleContent() })

    expect(w.pages).toHaveLength(2)
    expect(w.activePage?.route).toBe('/')
    expect(w.dataStore).toBeDefined()
    expect(w.fetcher).toBeDefined()
    expect(w.state).toBeDefined()
    expect(w.entityStore).toBeDefined()
  })

  it('exposes page.state as ObservableState', () => {
    const w = new Website({ content: simpleContent() })
    const page = w.pages[0]

    page.state.set('slug', 'X')
    expect(page.state.get('slug')).toBe('X')
  })

  it('exposes website.state as ObservableState', () => {
    const w = new Website({ content: simpleContent() })
    w.state.set('appearance', 'dark')
    expect(w.state.get('appearance')).toBe('dark')
  })

  it('assembles the FetcherDispatcher from the foundation transports', async () => {
    const resolve = vi.fn().mockResolvedValue({ data: ['x'] })
    const foundation = { default: { capabilities: { transports: { my: { resolve } } } } }

    const w = new Website({
      content: simpleContent({ config: { fetcher: { transports: { default: 'my' } } } }),
      foundation,
    })
    const result = await w.fetcher.dispatch(
      { schema: 's' },
      { website: w },
    )
    expect(result.data).toEqual(['x'])
  })

  it('honors a runtime transport override', async () => {
    const foundationResolve = vi.fn()
    const bridgeResolve = vi.fn().mockResolvedValue({ data: ['bridge'] })
    const foundation = { default: { capabilities: { transports: { my: { resolve: foundationResolve } } } } }

    const w = new Website({
      content: simpleContent({ config: { fetcher: { transports: { default: 'my' } } } }),
      foundation,
      transport: { resolve: bridgeResolve },
    })
    const result = await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(result.data).toEqual(['bridge'])
    expect(foundationResolve).not.toHaveBeenCalled()
  })

  it('preserves the transport override across rebuild({ foundation })', async () => {
    const bridgeResolve = vi.fn().mockResolvedValue({ data: ['bridge'] })
    const foundationA = { default: { capabilities: { transports: { my: { resolve: vi.fn() } } } } }
    const foundationB = { default: { capabilities: { transports: { my: { resolve: vi.fn() } } } } }

    const w = new Website({
      content: simpleContent({ config: { fetcher: { transports: { default: 'my' } } } }),
      foundation: foundationA,
      transport: { resolve: bridgeResolve },
    })

    w.rebuild({ foundation: foundationB })
    const result = await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(result.data).toEqual(['bridge'])
    expect(bridgeResolve).toHaveBeenCalled()
  })
})

describe('Website.rebuild', () => {
  it('content-only rebuild preserves dispatcher, dataStore, and state', () => {
    const foundation = { default: { capabilities: { transports: { my: { resolve: vi.fn() } } } } }
    const w = new Website({ content: simpleContent(), foundation })
    const origFetcher = w.fetcher
    const origDataStore = w.dataStore
    const origState = w.state

    origDataStore.set('k', { data: [1] })
    origState.set('mode', 'A')

    w.rebuild({ content: simpleContent({ config: { name: 'Renamed' } }) })

    expect(w.fetcher).toBe(origFetcher) // preserved
    expect(w.dataStore).toBe(origDataStore) // preserved
    expect(w.state).toBe(origState) // preserved
    expect(w.dataStore.get('k')).toEqual({ data: [1] }) // cache survives
    expect(w.state.get('mode')).toBe('A') // state survives
    expect(w.config.name).toBe('Renamed') // content changed
  })

  it('foundation swap reassembles the dispatcher; cache and state survive', async () => {
    const a = vi.fn().mockResolvedValue({ data: ['a'] })
    const b = vi.fn().mockResolvedValue({ data: ['b'] })
    const foundationA = { default: { capabilities: { transports: { my: { resolve: a } } } } }
    const foundationB = { default: { capabilities: { transports: { my: { resolve: b } } } } }
    const content = simpleContent({ config: { fetcher: { transports: { default: 'my' } } } })

    const w = new Website({ content, foundation: foundationA })
    const origDataStore = w.dataStore
    const origState = w.state
    w.state.set('mode', 'A')

    await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(a).toHaveBeenCalledTimes(1)

    w.rebuild({ foundation: foundationB })

    expect(w.dataStore).toBe(origDataStore)
    expect(w.state).toBe(origState)
    expect(w.state.get('mode')).toBe('A')

    // Dispatcher reassembled — second fetch routes to foundationB. Key
    // derived from request is the same, so the cached entry wins regardless
    // of which fetcher would run. Clear cache first to force a real dispatch.
    w.dataStore.clear()
    await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('rebuild is chainable', () => {
    const w = new Website({ content: simpleContent() })
    expect(w.rebuild({ content: simpleContent() })).toBe(w)
  })
})

describe('Website route translation (localized slugs)', () => {
  // config.i18n.routeTranslations: { <locale>: { <canonicalRoute>: <displayRoute> } }
  // Produced by the build from page.yml `slug:` maps (and by the editor/backend
  // from a per-locale slug field). The default locale is omitted — its routes
  // are the canonical keys.
  const RT = {
    fr: { '/About-Us': '/a-propos', '/blog': '/blogue' },
    es: { '/About-Us': '/acerca-de' },
  }

  function localizedSite(configOverrides = {}) {
    return new Website({
      content: {
        config: {
          name: 'T',
          defaultLanguage: 'en',
          i18n: { routeTranslations: RT },
          ...configOverrides,
        },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/About-Us', title: 'About', sections: [] },
          { route: '/blog', title: 'Blog', sections: [] },
        ],
      },
    })
  }

  describe('translateRoute (canonical → display)', () => {
    it('maps an exact canonical route', () => {
      expect(localizedSite().translateRoute('/About-Us', 'fr')).toBe('/a-propos')
      expect(localizedSite().translateRoute('/About-Us', 'es')).toBe('/acerca-de')
    })

    it('bypasses the default locale (route unchanged)', () => {
      expect(localizedSite().translateRoute('/About-Us', 'en')).toBe('/About-Us')
    })

    it('prefix-cascades a localized parent to its children', () => {
      expect(localizedSite().translateRoute('/blog/my-post', 'fr')).toBe('/blogue/my-post')
    })

    it('preserves :param segments through the cascade', () => {
      expect(localizedSite().translateRoute('/blog/:slug', 'fr')).toBe('/blogue/:slug')
    })

    it('returns the route unchanged when nothing maps', () => {
      expect(localizedSite().translateRoute('/contact', 'fr')).toBe('/contact')
      expect(localizedSite().translateRoute('/About-Us', 'de')).toBe('/About-Us')
    })
  })

  describe('reverseTranslateRoute (display → canonical)', () => {
    it('reverses an exact localized route', () => {
      expect(localizedSite().reverseTranslateRoute('/a-propos', 'fr')).toBe('/About-Us')
    })

    it('reverses a prefix-cascaded child route', () => {
      expect(localizedSite().reverseTranslateRoute('/blogue/my-post', 'fr')).toBe('/blog/my-post')
    })

    it('bypasses the default locale', () => {
      expect(localizedSite().reverseTranslateRoute('/About-Us', 'en')).toBe('/About-Us')
    })
  })

  describe('getLocaleUrl (cross-locale switching)', () => {
    it('maps a canonical route to a prefixed localized URL from the default locale', () => {
      const w = localizedSite({ activeLocale: 'en' })
      expect(w.getLocaleUrl('fr', '/About-Us')).toBe('/fr/a-propos')
      expect(w.getLocaleUrl('es', '/About-Us')).toBe('/es/acerca-de')
    })

    it('returns the unprefixed canonical route for the default locale', () => {
      const w = localizedSite({ activeLocale: 'en' })
      expect(w.getLocaleUrl('en', '/About-Us')).toBe('/About-Us')
    })

    it('switches between two non-default locales via the canonical route', () => {
      const w = localizedSite({ activeLocale: 'fr' })
      expect(w.getLocaleUrl('es', '/a-propos')).toBe('/es/acerca-de')
    })

    it('switches a non-default locale back to the default', () => {
      const w = localizedSite({ activeLocale: 'fr' })
      expect(w.getLocaleUrl('en', '/a-propos')).toBe('/About-Us')
    })
  })
})
