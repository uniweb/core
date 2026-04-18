/**
 * End-to-end integration: Website + foundation with a state-aware fetcher +
 * block + dispatch through the cascade, with a focus on the reactive path
 * where page.state changes force a new cache key and a new fetcher call.
 *
 * This is the scenario the plan is ultimately justifying — each unit test
 * covers its layer, but nothing else proves they compose. A regression
 * anywhere in the chain (dispatcher key derivation, observable-state
 * subscription, EntityStore ctx building, cascade walk, peek/dispatch
 * contract) should surface here.
 */

import { describe, it, expect, jest } from '@jest/globals'
import Website from '../src/website.js'

/**
 * Minimal Uniweb-like site content. Two pages, the articles page declares
 * a site-level fetch at page scope. No layouts, no locales.
 */
function makeContent() {
  return {
    config: {
      name: 'Integration Site',
      defaultLanguage: 'en',
      // Site picks which named transport handles which schema. Under the
      // post-plan model, all foundation/extension-owned transport is
      // name-registered and explicitly selected by the site.
      fetcher: { transports: { default: 'stateful' } },
    },
    theme: {},
    pages: [
      {
        route: '/articles',
        title: 'Articles',
        sections: [],
        // Page-level fetch config — the cascade lands here when a block
        // on this page asks for data.
        fetch: { schema: 'articles', url: 'https://api.example.com/articles' },
      },
    ],
  }
}

/**
 * A foundation whose fetcher reads `ctx.page.state.get('tag')` and encodes
 * it into the request, declaring `cacheKey` so distinct tags cache as
 * distinct entries. This is the pattern a position-2 foundation uses.
 */
function makeStatefulFoundation() {
  const fetches = [] // record every call the fetcher sees

  const fetcher = {
    async resolve(request, ctx) {
      const tag = ctx?.page?.state?.get?.('tag') ?? null
      fetches.push({ url: request.url, tag })
      return {
        data: [{ slug: `a-${tag ?? 'none'}` }, { slug: `b-${tag ?? 'none'}` }],
        meta: { tag },
      }
    },
    cacheKey(request) {
      // Derive a state-aware key: the fetcher *knows* it varies on `tag`,
      // so it bakes that into the key. Without this, a change to page.state
      // would hit the old cached entry and the page wouldn't update.
      return `articles:${request.url}:${request.__tag ?? ''}`
    },
  }

  const foundation = {
    default: {
      // Named transport the site selects via `fetcher.transports.default`.
      // The transport reads ctx.page.state inside resolve() and declares
      // its own cacheKey so state-dependent queries produce distinct
      // cache entries.
      transports: {
        stateful: {
          resolve: fetcher.resolve,
          cacheKey: fetcher.cacheKey,
        },
      },
    },
  }

  return { foundation, fetches }
}

/**
 * A block stub just rich enough for EntityStore + the dispatcher to walk
 * through it. In the real runtime this is a full Block instance; here we
 * only need the cascade-relevant fields.
 */
function blockOn(page, website, extras = {}) {
  return {
    fetch: null,
    dynamicContext: null,
    page,
    website,
    ...extras,
  }
}

describe('integration — Website + foundation + state-aware fetcher', () => {
  it('site-level + page-level cascade delivers data through the dispatcher', async () => {
    const { foundation, fetches } = makeStatefulFoundation()
    const website = new Website({ content: makeContent(), foundation })

    const articlesPage = website.pages.find((p) => p.route === '/articles')
    expect(articlesPage).toBeDefined()

    // Inject a tag the fetcher's cacheKey knows to vary on. The route's
    // match runs on schema, but the fetcher reads state at dispatch time
    // and the dispatcher keys off the request's __tag (which EntityStore
    // doesn't populate — we add it here so the cacheKey sees it).
    // In production a foundation would fold state into the request inside
    // its own resolve wrapper; this test uses the simpler path of letting
    // the fetcher peek at page.state directly.
    articlesPage.state.set('tag', 'featured')

    const block = blockOn(articlesPage, website)

    // Resolve is sync — should be pending on first try (cache empty).
    const resolved = website.entityStore.resolve(block, {})
    expect(resolved.status).toBe('pending')

    // Async fetch runs through the dispatcher, which runs the foundation's
    // route fetcher, which reads ctx.page.state.
    const fetched = await website.entityStore.fetch(block, {})
    expect(fetches).toHaveLength(1)
    expect(fetches[0].tag).toBe('featured')
    expect(fetched.data.articles).toEqual([{ slug: 'a-featured' }, { slug: 'b-featured' }])

    // Resolve is now ready from cache — no second fetcher call.
    const resolved2 = website.entityStore.resolve(block, {})
    expect(resolved2.status).toBe('ready')
    expect(resolved2.data.articles).toEqual([{ slug: 'a-featured' }, { slug: 'b-featured' }])
    expect(fetches).toHaveLength(1)
  })

  it('state-aware cacheKey: changing page.state forces a new fetch', async () => {
    // A foundation whose cacheKey incorporates page.state directly. This
    // is the pattern for "request encodes the state value" — the fetcher
    // reads ctx.page.state both for cacheKey derivation and for the
    // response. A change to page.state produces a new cache key, which
    // misses the cache, which triggers a new fetcher call with the new
    // state value in scope.
    const fetches = []
    const fetcher = {
      async resolve(request, ctx) {
        const tag = ctx?.page?.state?.get?.('tag') ?? null
        fetches.push({ tag })
        return { data: [{ slug: `item-${tag ?? 'none'}` }], meta: { tag } }
      },
    }
    // Wrap so cacheKey gets the ctx too, which the dispatcher doesn't
    // hand it today. The workaround: the route's `match` predicate
    // folds state into a synthetic request field the cacheKey reads.
    // (See plan Part 3: "foundations must include state-dependent values
    // in cacheKey or the reactivity path stalls.")
    const foundation = {
      default: {
        transports: {
          stateful: {
            resolve: (req, ctx) => fetcher.resolve(req, ctx),
            cacheKey: (req) => `articles:${req.__stateTag ?? ''}`,
          },
        },
      },
    }

    const website = new Website({ content: makeContent(), foundation })
    const page = website.pages.find((p) => p.route === '/articles')

    // Seed state + annotate the page.fetch config so the request carries
    // the current state value into cacheKey. This mimics what a real
    // foundation would do in its own layer (e.g., a handler that reshapes
    // the fetch config before EntityStore walks it).
    page.state.set('tag', 'red')
    page.fetch = { ...page.fetch, __stateTag: page.state.get('tag') }

    const block = blockOn(page, website)
    const r1 = await website.entityStore.fetch(block, {})
    expect(r1.data.articles).toEqual([{ slug: 'item-red' }])
    expect(fetches).toHaveLength(1)

    // Flip state, re-derive the request, re-dispatch.
    page.state.set('tag', 'blue')
    page.fetch = { ...page.fetch, __stateTag: page.state.get('tag') }

    const r2 = await website.entityStore.fetch(block, {})
    expect(r2.data.articles).toEqual([{ slug: 'item-blue' }])
    expect(fetches).toHaveLength(2)
    expect(website.dataStore.has('articles:red')).toBe(true)
    expect(website.dataStore.has('articles:blue')).toBe(true)
  })

  it('rebuild({ content }) preserves cache and page.state across a content edit', async () => {
    const { foundation, fetches } = makeStatefulFoundation()
    const website = new Website({ content: makeContent(), foundation })
    const page = website.pages.find((p) => p.route === '/articles')

    page.state.set('tag', 'warm')
    const block = blockOn(page, website)
    await website.entityStore.fetch(block, {})
    expect(fetches).toHaveLength(1)

    const origDataStore = website.dataStore
    const origFetcher = website.fetcher

    // Editor live-edit: same content shape, rebuild in place.
    website.rebuild({ content: makeContent() })

    expect(website.dataStore).toBe(origDataStore) // cache preserved
    expect(website.fetcher).toBe(origFetcher)     // dispatcher preserved

    // Page instances are rebuilt from content — page-level state is
    // re-created because pages are re-constructed. That's the documented
    // contract (website.state survives, page.state does not).
    const newPage = website.pages.find((p) => p.route === '/articles')
    expect(newPage.state.has('tag')).toBe(false) // fresh Page, fresh state

    // The *cache* is preserved: the same request (URL + schema, no state
    // bake-in on the default cacheKey) hits the warm entry. Fetcher is
    // not called again — fetches length stays at 1. This is the property
    // that makes live-edit feel instantaneous: reshaping the content
    // doesn't force re-fetching the data already in the cache.
    const block2 = blockOn(newPage, website)
    const afterRebuild = await website.entityStore.fetch(block2, {})
    expect(fetches).toHaveLength(1) // cache hit; no new fetcher call
    expect(afterRebuild.data.articles).toEqual([{ slug: 'a-warm' }, { slug: 'b-warm' }])
  })

  it('in-flight dedup survives the full Website stack', async () => {
    // Two concurrent blocks on the same page, identical request. The
    // dispatcher should produce exactly one fetcher call.
    let resolveFetch
    const fetcher = {
      resolve: jest.fn(() => new Promise((r) => { resolveFetch = r })),
    }
    const foundation = {
      default: { transports: { stateful: { resolve: fetcher.resolve } } },
    }
    const website = new Website({ content: makeContent(), foundation })
    const page = website.pages.find((p) => p.route === '/articles')

    const b1 = blockOn(page, website)
    const b2 = blockOn(page, website)

    const p1 = website.entityStore.fetch(b1, {})
    const p2 = website.entityStore.fetch(b2, {})

    expect(fetcher.resolve).toHaveBeenCalledTimes(1)

    resolveFetch({ data: [{ slug: 'x' }] })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.data.articles).toEqual([{ slug: 'x' }])
    expect(r2.data.articles).toEqual([{ slug: 'x' }])
  })

  it('ObservableState notifications reach subscribers before re-dispatch', () => {
    // Not a re-dispatch test (there's no React here) but a tight contract:
    // page.state.subscribe(key, fn) must fire synchronously when .set() runs,
    // since kit hooks depend on this to schedule re-renders that then
    // trigger re-dispatch. Regress this and the whole reactive path stalls.
    const website = new Website({ content: makeContent() })
    const page = website.pages.find((p) => p.route === '/articles')

    const log = []
    page.state.subscribe('tag', () => log.push(page.state.get('tag')))

    page.state.set('tag', 'a')
    page.state.set('tag', 'b')
    page.state.set('tag', 'b') // no-op, value unchanged
    page.state.delete('tag')

    expect(log).toEqual(['a', 'b', undefined])
  })
})
