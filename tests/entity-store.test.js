import { describe, it, expect, vi } from 'vitest'
import EntityStore from '../src/entity-store.js'
import DataStore, { deriveCacheKey } from '../src/datastore.js'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'
import Website from '../src/website.js'
// Derived, never re-spelled: the convention is pinned once, in
// `tests/data-paths.test.js`. See the note there before pinning it again.
import { queryDataUrl } from '../src/data-paths.js'

/**
 * Build a minimal Website-shaped stub with a real FetcherDispatcher and
 * DataStore backed by a mock default fetcher. Returns the fetcher spy so tests
 * can assert call counts / arguments.
 */
function makeHarness({ fetcherImpl, dev = false } = {}) {
  const dataStore = new DataStore()
  const defaultFetcher = {
    resolve: vi.fn((req) =>
      fetcherImpl ? fetcherImpl(req) : Promise.resolve({ data: null })
    ),
  }
  const fetcher = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })
  const website = {
    dataStore,
    fetcher,
    config: {},
    getActiveLocale: () => 'en',
    getDefaultLocale: () => 'en',
  }
  const entityStore = new EntityStore({ website, dev })
  website.entityStore = entityStore
  return { website, entityStore, dataStore, fetcher, fetcherSpy: defaultFetcher.resolve }
}

function makeBlock(overrides = {}, website = null) {
  return {
    fetch: null,
    dynamicContext: null,
    page: makePage(),
    website,
    ...overrides,
  }
}

function makePage(overrides = {}) {
  return {
    fetch: null,
    parent: null,
    dynamicContext: null,
    ...overrides,
  }
}

describe('EntityStore.resolve', () => {
  it('returns none when no fetch configs exist in the hierarchy', () => {
    const { entityStore, website } = makeHarness()
    const block = makeBlock({}, website)
    expect(entityStore.resolve(block, {})).toEqual({ status: 'none', data: null })
  })

  it('delivers data by default when a cascade match is cached', () => {
    const { entityStore, dataStore, website } = makeHarness()
    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    const articles = [{ slug: 'a', title: 'A' }]
    dataStore.set(deriveCacheKey(fetchConfig), { data: articles })

    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    const result = entityStore.resolve(block, {})
    expect(result.status).toBe('ready')
    expect(result.data.articles).toEqual(articles)
  })

  it('returns none when inheritData: false', () => {
    const { entityStore, dataStore, website } = makeHarness()
    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    dataStore.set(deriveCacheKey(fetchConfig), { data: [{ slug: 'a' }] })

    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    expect(entityStore.resolve(block, { inheritData: false })).toEqual({ status: 'none', data: null })
  })

  it('returns pending on cache miss', () => {
    const { entityStore, website } = makeHarness()
    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    expect(entityStore.resolve(block, {})).toEqual({ status: 'pending', data: null })
  })
})

describe('EntityStore.fetch', () => {
  it('walks hierarchy: block → page → parent → site', async () => {
    const articles = [{ slug: 'a' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })

    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, { inheritData: ['articles'] })
    expect(result.data.articles).toEqual(articles)
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('does not walk beyond parent page', async () => {
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [] }),
    })
    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    const grandparent = makePage({ fetch: fetchConfig })
    const parent = makePage({ parent: grandparent })
    const page = makePage({ parent })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, { inheritData: ['articles'] })
    expect(result.data).toBeNull()
    expect(fetcherSpy).not.toHaveBeenCalled()
  })

  it('finds fetch config from site-level config', async () => {
    const teams = [{ name: 'Team A' }]
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: teams }),
    })
    const fetchConfig = { path: '/data/teams.json', as: 'teams' }
    website.config = { fetch: fetchConfig }

    const block = makeBlock({ page: makePage() }, website)
    const result = await entityStore.fetch(block, {})
    expect(result.data.teams).toEqual(teams)
  })

  it('first match per schema wins (block overrides page)', async () => {
    const blockArticles = [{ from: 'block' }]
    const pageArticles = [{ from: 'page' }]
    const blockConfig = { path: '/data/block-articles.json', as: 'articles' }
    const pageConfig = { path: '/data/page-articles.json', as: 'articles' }

    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) =>
        req.path === blockConfig.path
          ? Promise.resolve({ data: blockArticles })
          : Promise.resolve({ data: pageArticles }),
    })

    const page = makePage({ fetch: pageConfig })
    const block = makeBlock({ page, fetch: blockConfig }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual(blockArticles)
    expect(fetcherSpy).toHaveBeenCalledTimes(1)
    expect(fetcherSpy).toHaveBeenCalledWith(blockConfig, expect.anything())
  })

  it('delivers the focused record as a single-element array on dynamic routes', async () => {
    const articles = [
      { slug: 'hello', title: 'Hello' },
      { slug: 'world', title: 'World' },
    ]
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    const dynamicContext = { paramName: 'slug', paramValue: 'world', schema: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page, dynamicContext }, website)

    const result = await entityStore.fetch(block, {})
    // Detail route: the focused record lands under the collection key as a
    // single-element array; there is no singular `article` key.
    expect(result.data.articles).toEqual([{ slug: 'world', title: 'World' }])
    expect(result.data.article).toBeUndefined()
  })

  it('detail: rest fetches single item on template page', async () => {
    const collectionItem = { slug: 'my-post', title: 'My Post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) => {
        // The collection and the per-record detail fetch share a schema now;
        // distinguish them by URL (the collection vs the /{slug} record).
        if (req.url === 'https://api.example.com/articles') return Promise.resolve({ data: [collectionItem] })
        return Promise.resolve({ data: detailArticle })
      },
    })

    const fetchConfig = {
      url: 'https://api.example.com/articles',
      as: 'articles',
      detail: 'rest',
    }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, { inheritData: ['articles'] })
    expect(result.data.articles).toEqual([detailArticle])
    expect(result.data.article).toBeUndefined()
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/articles/my-post',
        as: 'articles',
      }),
      expect.anything(),
    )
  })

  it('detail: query builds query-param URL', async () => {
    const collectionItem = { slug: 'my-post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) =>
        req.as === 'articles'
          ? Promise.resolve({ data: [collectionItem] })
          : Promise.resolve({ data: detailArticle }),
    })

    const fetchConfig = {
      url: 'https://api.example.com/articles',
      as: 'articles',
      detail: 'query',
    }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/articles?slug=my-post',
        as: 'articles',
      }),
      expect.anything(),
    )
  })

  it('custom detail pattern substitutes placeholders', async () => {
    const collectionItem = { slug: 'my-post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) =>
        req.as === 'articles'
          ? Promise.resolve({ data: [collectionItem] })
          : Promise.resolve({ data: detailArticle }),
    })

    const fetchConfig = {
      url: 'https://api.example.com/articles',
      as: 'articles',
      detail: 'https://api.example.com/article/{slug}',
    }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/article/my-post',
        as: 'articles',
      }),
      expect.anything(),
    )
  })

  it('uses cached collection as gate then fetches detail', async () => {
    const articles = [{ slug: 'my-post' }, { slug: 'other' }]
    const detailArticle = { slug: 'my-post', body: 'Full' }

    const { entityStore, fetcherSpy, dataStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: detailArticle }),
    })
    const fetchConfig = {
      url: 'https://api.example.com/articles',
      as: 'articles',
      detail: 'rest',
    }
    dataStore.set(deriveCacheKey(fetchConfig), { data: articles })

    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual([detailArticle])
    expect(fetcherSpy).toHaveBeenCalledTimes(1)
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/articles/my-post' }),
      expect.anything(),
    )
  })

  it('skips detail when no dynamicContext', async () => {
    const articles = [{ slug: 'a' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    const fetchConfig = {
      url: 'https://api.example.com/articles',
      as: 'articles',
      detail: 'rest',
    }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual(articles)
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('falls back to collection fetch when detail is not defined', async () => {
    const articles = [{ slug: 'my-post' }, { slug: 'other' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    const fetchConfig = { url: 'https://api.example.com/articles', as: 'articles' }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual([{ slug: 'my-post' }])
    expect(result.data.article).toBeUndefined()
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('localizes compiled-collection paths for non-default locale', async () => {
    const articles = [{ slug: 'a', title: 'Bonjour' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    website.getActiveLocale = () => 'fr'

    const fetchConfig = { path: queryDataUrl('articles'), as: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/fr${queryDataUrl('articles')}`,
        as: 'articles',
      }),
      expect.anything(),
    )
  })

  it('does not localize remote URLs', async () => {
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [] }),
    })
    website.getActiveLocale = () => 'fr'

    const fetchConfig = { url: 'https://api.example.com/articles', as: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('does not localize local paths outside the compiled-collection tree', async () => {
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: { key: 'value' } }),
    })
    website.getActiveLocale = () => 'fr'

    const fetchConfig = { path: '/api/config.json', as: 'config' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('resolve() uses localized key for cache lookup', () => {
    const { entityStore, dataStore, website } = makeHarness()
    website.getActiveLocale = () => 'fr'

    const articles = [{ slug: 'a', title: 'Bonjour' }]
    dataStore.set(
      deriveCacheKey({ path: `/fr${queryDataUrl('articles')}`, as: 'articles' }),
      { data: articles },
    )

    const fetchConfig = { path: queryDataUrl('articles'), as: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    const result = entityStore.resolve(block, {})
    expect(result.status).toBe('ready')
    expect(result.data.articles).toEqual(articles)
  })

  it('fetches multiple schemas in parallel', async () => {
    const articles = [{ slug: 'a' }]
    const categories = [{ name: 'Tech' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) => {
        if (req.as === 'articles') return Promise.resolve({ data: articles })
        if (req.as === 'categories') return Promise.resolve({ data: categories })
        return Promise.resolve({ data: null })
      },
    })
    const fetchConfigs = [
      { path: '/data/articles.json', as: 'articles' },
      { path: '/data/categories.json', as: 'categories' },
    ]
    const page = makePage({ fetch: fetchConfigs })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual(articles)
    expect(result.data.categories).toEqual(categories)
    expect(fetcherSpy).toHaveBeenCalledTimes(2)
  })

  it('forwards ctx.signal to the dispatcher', async () => {
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [] }),
    })
    const fetchConfig = { path: '/data/articles.json', as: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)
    const controller = new AbortController()

    await entityStore.fetch(block, {}, { signal: controller.signal })
    const ctxArg = fetcherSpy.mock.calls[0][1]
    expect(ctxArg?.signal).toBeDefined()
  })

  describe('refine', () => {
    it('refine: true on a block skips it as a new source and fetches parent config', async () => {
      const articles = [{ slug: 'a' }, { slug: 'b' }]
      const { entityStore, fetcherSpy, website } = makeHarness({
        fetcherImpl: () => Promise.resolve({ data: articles }),
      })
      const parentConfig = { path: '/data/articles.json', as: 'articles' }
      const blockConfig = { path: '/data/override.json', as: 'articles' }
      const parent = makePage({ fetch: parentConfig })
      const page = makePage({ parent })
      const block = makeBlock({ page, fetch: { ...blockConfig, refine: true } }, website)

      const result = await entityStore.fetch(block, {})
      expect(result.data.articles).toEqual(articles)
      // Parent's URL is fetched — block's own URL is NOT used as a new source.
      expect(fetcherSpy).toHaveBeenCalledWith(parentConfig, expect.anything())
      expect(fetcherSpy).not.toHaveBeenCalledWith(blockConfig, expect.anything())
    })

    // `inherit: true` was the alias of `refine: true`, removed 2026-09-02. It is
    // refused, not ignored: ignored, the block would render empty with nothing
    // to say why.
    it('inherit: true is refused in dev — the removed alias throws, naming refine', async () => {
      const { entityStore, website } = makeHarness({
        fetcherImpl: () => Promise.resolve({ data: [] }),
        dev: true,
      })
      const parent = makePage({ fetch: { path: '/data/articles.json', as: 'articles' } })
      const page = makePage({ parent })
      const block = makeBlock({ page, fetch: { inherit: true, limit: 3 } }, website)

      let err
      try { await entityStore.fetch(block, {}) } catch (e) { err = e }
      expect(err?.message).toMatch(/inherit: true/)
      expect(err?.message).toMatch(/refine: true/)
    })

    it('in production inherit: true logs an error once and is dropped — cascaded data arrives unrefined', async () => {
      const articles = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]
      const { entityStore, fetcherSpy, website } = makeHarness({
        fetcherImpl: () => Promise.resolve({ data: articles }),
      })
      const parentConfig = { path: '/data/articles.json', as: 'articles' }
      const parent = makePage({ fetch: parentConfig })
      const page = makePage({ parent })
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const block = makeBlock({ page, fetch: { inherit: true, limit: 1 } }, website)

      const result = await entityStore.fetch(block, {})
      // The parent's data still arrives; the `limit: 1` the alias carried does not apply.
      expect(result.data.articles).toEqual(articles)
      expect(fetcherSpy).toHaveBeenCalledWith(parentConfig, expect.anything())
      expect(error).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no longer accepted'))
      error.mockRestore()
    })

    it('refine: true with detail: false returns collection minus active item', async () => {
      const articles = [
        { slug: 'a', title: 'A' },
        { slug: 'b', title: 'B' },
        { slug: 'c', title: 'C' },
      ]
      const { entityStore, website } = makeHarness({
        fetcherImpl: () => Promise.resolve({ data: articles }),
      })
      const parentConfig = {
        url: 'https://api.example.com/articles',
        as: 'articles',
        detail: 'rest',
      }
      const dynamicContext = { paramName: 'slug', paramValue: 'b', schema: 'articles' }
      const parent = makePage({ fetch: parentConfig })
      const page = makePage({ parent, dynamicContext })
      const block = makeBlock(
        { page, fetch: { refine: true, detail: false, limit: 2 } },
        website,
      )

      const result = await entityStore.fetch(block, {})
      expect(result.data.articles.map((a) => a.slug)).toEqual(['a', 'c'])
    })
  })
})

describe('EntityStore detailPage → record.route injection', () => {
  const cfg = { path: '/data/articles.json', as: 'articles', detailPage: 'page:detail' }

  function seed(articles, resolver) {
    const h = makeHarness()
    if (resolver !== undefined) h.website.resolveDetailPageTemplate = resolver
    h.dataStore.set(deriveCacheKey(cfg), { data: articles })
    const block = makeBlock({ page: makePage({ fetch: cfg }) }, h.website)
    return { ...h, block }
  }

  it('injects the canonical route on each record (sync path), url-encoding the param', () => {
    const articles = [{ slug: 'a-post', title: 'A' }, { slug: 'b post', title: 'B' }]
    const { entityStore, block } = seed(articles, (ref) =>
      ref === 'page:detail' ? '/blog/:slug' : null
    )
    const result = entityStore.resolve(block, {})
    expect(result.status).toBe('ready')
    expect(result.data.articles[0].route).toBe('/blog/a-post')
    expect(result.data.articles[1].route).toBe('/blog/b%20post')
    // cached source records are NOT mutated (same collection may back other sections)
    expect(articles[0].route).toBeUndefined()
  })

  it('injects on the async fetch path too', async () => {
    const h = makeHarness({ fetcherImpl: () => Promise.resolve({ data: [{ slug: 'x', title: 'X' }] }) })
    h.website.resolveDetailPageTemplate = () => '/blog/:slug'
    const block = makeBlock({ page: makePage({ fetch: cfg }) }, h.website)
    const result = await h.entityStore.fetch(block, {})
    expect(result.data.articles[0].route).toBe('/blog/x')
  })

  it('leaves records untouched for a dangling detailPage ref', () => {
    const { entityStore, block } = seed([{ slug: 'a', title: 'A' }], () => null)
    const result = entityStore.resolve(block, {})
    expect(result.data.articles[0].route).toBeUndefined()
  })

  it('preserves a record’s existing baked route (file lane back-compat)', () => {
    const { entityStore, block } = seed(
      [{ slug: 'a', title: 'A', route: '/blog/a' }],
      () => '/other/:slug'
    )
    const result = entityStore.resolve(block, {})
    expect(result.data.articles[0].route).toBe('/blog/a')
  })

  it('skips a record missing the :param field (no broken href)', () => {
    const { entityStore, block } = seed([{ title: 'no slug' }], () => '/blog/:slug')
    const result = entityStore.resolve(block, {})
    expect(result.data.articles[0].route).toBeUndefined()
  })

  it('is a no-op when the fetch config declares no detailPage', () => {
    const plain = { path: '/data/articles.json', as: 'articles' }
    const h = makeHarness()
    h.website.resolveDetailPageTemplate = () => '/blog/:slug'
    h.dataStore.set(deriveCacheKey(plain), { data: [{ slug: 'a', title: 'A' }] })
    const block = makeBlock({ page: makePage({ fetch: plain }) }, h.website)
    const result = h.entityStore.resolve(block, {})
    expect(result.data.articles[0].route).toBeUndefined()
  })
})

describe('EntityStore + real Website: end-to-end detailPage resolution', () => {
  it('a list preview on ANY page links to the collection’s canonical detail (real _pageIdMap)', () => {
    // A site where Home carries an articles preview but the detail page lives
    // under Blog — the exact cross-page case the runtime scan got wrong.
    const w = new Website({
      content: {
        config: { name: 'T', defaultLanguage: 'en' },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/blog', id: 'blog-list', title: 'Blog', sections: [] },
          {
            route: '/blog/:slug',
            id: 'article-detail',
            isDynamic: true,
            paramName: 'slug',
            parentSchema: 'articles',
            title: 'Article',
            sections: [],
          },
        ],
      },
    })

    const cfg = {
      path: '/data/articles.json',
      as: 'articles',
      detailPage: 'page:article-detail',
    }
    w.dataStore.set(deriveCacheKey(cfg), {
      data: [{ slug: 'first', title: 'First' }, { slug: 'second', title: 'Second' }],
    })

    // A block on the HOME page (route '/') whose fetch pulls the articles preview.
    const block = {
      fetch: null,
      dynamicContext: null,
      page: { route: '/', fetch: cfg, parent: null, dynamicContext: null },
      website: w,
    }

    const result = w.entityStore.resolve(block, {})
    expect(result.status).toBe('ready')
    // Cards link to /blog/:slug (canonical), NOT /first relative to Home.
    expect(result.data.articles.map((a) => a.route)).toEqual(['/blog/first', '/blog/second'])
  })
})

describe('EntityStore detailPage — SECTION-level (block.fetch) resolution', () => {
  it('resolves detailPage from a SECTION own fetch (block.fetch) on a page with NO page fetch', () => {
    const cfg = { path: '/data/articles.json', as: 'articles', detailPage: 'page:detail' }
    const h = makeHarness()
    h.website.resolveDetailPageTemplate = () => '/blog/:slug'
    h.dataStore.set(deriveCacheKey(cfg), { data: [{ slug: 'x', title: 'X' }] })
    // The section carries its own full fetch; the page has none.
    const block = makeBlock({ fetch: cfg, page: makePage({ fetch: null }) }, h.website)
    const result = h.entityStore.resolve(block, {})
    expect(result.status).toBe('ready')
    expect(result.data.articles[0].route).toBe('/blog/x')
  })

  it('section fetch.detailPage WINS over page fetch.detailPage for the same schema', () => {
    const sectionCfg = { path: '/data/articles.json', as: 'articles', detailPage: 'page:section' }
    const pageCfg = { path: '/data/articles.json', as: 'articles', detailPage: 'page:page' }
    const h = makeHarness()
    h.website.resolveDetailPageTemplate = (ref) =>
      ref === 'page:section' ? '/section/:slug' : '/page/:slug'
    h.dataStore.set(deriveCacheKey(sectionCfg), { data: [{ slug: 'x' }] })
    const block = makeBlock({ fetch: sectionCfg, page: makePage({ fetch: pageCfg }) }, h.website)
    const result = h.entityStore.resolve(block, {})
    expect(result.data.articles[0].route).toBe('/section/x')
  })
})
