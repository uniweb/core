import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

function content(overrides = {}) {
  return {
    config: { name: 'Test', defaultLanguage: 'en', ...overrides.config },
    theme: {},
    pages: [{ route: '/', isIndex: true, title: 'Home', sections: [] }],
  }
}

describe('getSearchIndexUrl — base path', () => {
  it('returns a root path when the site is served from the root', () => {
    const w = new Website({ content: content() })

    expect(w.getSearchIndexUrl()).toBe('/search-index.json')
  })

  it('includes the base path under a subdirectory deployment', () => {
    // Regression: the URL used to be returned bare and fetched verbatim, so
    // search 404'd on every non-root deployment while data fetching — which
    // resolves the same base — worked.
    const w = new Website({ content: content() })
    w.setBasePath('/docs/')

    expect(w.getSearchIndexUrl()).toBe('/docs/search-index.json')
  })

  it('includes the base path for a backend-served subpath', () => {
    const w = new Website({ content: content() })
    w.setBasePath('/sites/abc123/')

    expect(w.getSearchIndexUrl()).toBe('/sites/abc123/search-index.json')
  })

  it("treats '/' as no base path", () => {
    const w = new Website({ content: content() })
    w.setBasePath('/')

    expect(w.getSearchIndexUrl()).toBe('/search-index.json')
  })

  it('composes base path with a non-default locale prefix', () => {
    const w = new Website({
      content: content({ config: { languages: ['en', 'fr'], activeLocale: 'fr' } }),
    })
    w.setBasePath('/docs')

    expect(w.getSearchIndexUrl()).toBe('/docs/fr/search-index.json')
  })
})

describe('getSearchConfig — provider declaration', () => {
  it('defaults to the index provider', () => {
    const w = new Website({ content: content() })

    expect(w.getSearchConfig().provider).toBe('index')
    expect(w.getSearchConfig().endpoint).toBeUndefined()
  })

  it('passes a declared provider and endpoint through untouched', () => {
    // Core only carries the declaration; kit resolves the endpoint against
    // basePath, so the raw relative spelling has to survive intact.
    const w = new Website({
      content: content({ config: { search: { provider: 'endpoint', endpoint: '_search' } } }),
    })

    expect(w.getSearchConfig().provider).toBe('endpoint')
    expect(w.getSearchConfig().endpoint).toBe('_search')
  })

  it('keeps a declared provider even when search is disabled', () => {
    const w = new Website({
      content: content({ config: { search: { enabled: false, provider: 'endpoint' } } }),
    })

    expect(w.isSearchEnabled()).toBe(false)
    expect(w.getSearchConfig().provider).toBe('endpoint')
  })

  it('names a foundation transport verbatim', () => {
    const w = new Website({
      content: content({ config: { search: { provider: 'algolia' } } }),
    })

    expect(w.getSearchConfig().provider).toBe('algolia')
  })
})

describe('isSearchEnabled — the boolean `search:` form', () => {
  // Regression, measured on a live hosted payload 2026-08-25: the served
  // config carried `search: true` — a bare boolean, not the documented
  // object. The predicate was `config?.search?.enabled !== false`, and
  // optional chaining short-circuits on null/undefined ONLY, so
  // `false?.enabled` evaluated `false.enabled` to `undefined` and
  // `undefined !== false` was true.
  //
  // ⇒ `search: false` — the natural shorthand for "off" — left search ON,
  // and `search: true` worked only by the same accident. The pair below is
  // the point: asserting only the `true` case would have passed against the
  // broken predicate.
  it('honours `search: false` as disabled', () => {
    const w = new Website({ content: content({ config: { search: false } }) })

    expect(w.isSearchEnabled()).toBe(false)
  })

  it('honours `search: true` as enabled', () => {
    const w = new Website({ content: content({ config: { search: true } }) })

    expect(w.isSearchEnabled()).toBe(true)
  })

  it('still honours the documented object form in both directions', () => {
    const off = new Website({ content: content({ config: { search: { enabled: false } } }) })
    const on = new Website({ content: content({ config: { search: { enabled: true } } }) })

    expect(off.isSearchEnabled()).toBe(false)
    expect(on.isSearchEnabled()).toBe(true)
  })

  it('defaults to enabled when nothing is declared', () => {
    const w = new Website({ content: content() })

    expect(w.isSearchEnabled()).toBe(true)
  })

  it('normalizes a boolean away so option reads land on an object', () => {
    // `true || {}` yields `true`, so every option read below would otherwise
    // dereference a boolean and silently return undefined.
    const w = new Website({ content: content({ config: { search: true } }) })
    const cfg = w.getSearchConfig()

    expect(cfg.provider).toBe('index')
    expect(cfg.include.pages).toBe(true)
    expect(cfg.exclude.routes).toEqual([])
  })
})

describe('isSearchEnabled — the host declines the service', () => {
  // ⭐ WHY THIS LIVES IN CORE AND NOT IN KIT, which is the whole point of it.
  // A foundation bundles its own frozen copy of `@uniweb/kit`, so a fix made
  // there never reaches a foundation built before it. `@uniweb/core` is
  // carried by the runtime and re-exported through the import map, so a
  // foundation of ANY age calls this method — kit's `isEnabled()` is
  // `website.isSearchEnabled()` and has been for every published version.
  //
  // Measured 2026-08-25: a host-served site whose host does not offer search
  // drew a search box that fell through to a local index nothing on that lane
  // emits, and 404'd. The rule is that a control for a service the site does
  // not have must not be drawn — uniform across services, no message.

  const hosted = (services, authored) =>
    new Website({
      content: content({ config: { ...(services !== undefined ? { services } : {}), ...(authored ?? {}) } }),
    })

  it('is false when a host publishes services and does not name search', () => {
    // The shape entitlement gating actually produces: the key is REMOVED.
    expect(hosted({ tracking: { endpoint: '/_a/e' } }).isSearchEnabled()).toBe(false)
  })

  it('is false when a host publishes an empty services block', () => {
    expect(hosted({}).isSearchEnabled()).toBe(false)
  })

  it('is true when the host offers search', () => {
    expect(hosted({ search: { endpoint: '/_search' } }).isSearchEnabled()).toBe(true)
  })

  it('⭐ a site OWN endpoint survives a host decline', () => {
    // The case worth re-running if this is ever edited: an operator running
    // self-hosted search on a host that does not sell it must keep working.
    // `resolveService` answers from the site tier first.
    const w = hosted({ tracking: {} }, { search: { endpoint: '/my-own-search' } })

    expect(w.isSearchEnabled()).toBe(true)
  })

  it('CONTROL: a static host — no services block at all — is unaffected', () => {
    // Declining nothing is not declining. This is the path where the build
    // really does emit a local index, so the old default is correct.
    expect(new Website({ content: content() }).isSearchEnabled()).toBe(true)
  })

  it('an explicit site-level disable still wins over a host that offers it', () => {
    expect(
      hosted({ search: { endpoint: '/_search' } }, { search: false }).isSearchEnabled(),
    ).toBe(false)
  })
})
