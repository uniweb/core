import { describe, it, expect, jest } from '@jest/globals'
import EntityStore from '../src/entity-store.js'
import DataStore, { deriveCacheKey } from '../src/datastore.js'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'

/**
 * Build a minimal Website-shaped stub with a real FetcherDispatcher and
 * DataStore backed by a mock default fetcher. Returns the fetcher spy so tests
 * can assert call counts / arguments.
 */
function makeHarness({ fetcherImpl } = {}) {
  const dataStore = new DataStore()
  const defaultFetcher = {
    resolve: jest.fn((req) =>
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
  const entityStore = new EntityStore({ website })
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
    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
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
    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
    dataStore.set(deriveCacheKey(fetchConfig), { data: [{ slug: 'a' }] })

    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    expect(entityStore.resolve(block, { inheritData: false })).toEqual({ status: 'none', data: null })
  })

  it('returns pending on cache miss', () => {
    const { entityStore, website } = makeHarness()
    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
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

    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
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
    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
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
    const fetchConfig = { path: '/data/teams.json', schema: 'teams' }
    website.config = { fetch: fetchConfig }

    const block = makeBlock({ page: makePage() }, website)
    const result = await entityStore.fetch(block, {})
    expect(result.data.teams).toEqual(teams)
  })

  it('first match per schema wins (block overrides page)', async () => {
    const blockArticles = [{ from: 'block' }]
    const pageArticles = [{ from: 'page' }]
    const blockConfig = { path: '/data/block-articles.json', schema: 'articles' }
    const pageConfig = { path: '/data/page-articles.json', schema: 'articles' }

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

  it('resolves singular item for dynamic routes', async () => {
    const articles = [
      { slug: 'hello', title: 'Hello' },
      { slug: 'world', title: 'World' },
    ]
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
    const dynamicContext = { paramName: 'slug', paramValue: 'world', schema: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page, dynamicContext }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual(articles)
    expect(result.data.article).toEqual({ slug: 'world', title: 'World' })
  })

  it('detail: rest fetches single item on template page', async () => {
    const collectionItem = { slug: 'my-post', title: 'My Post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) => {
        if (req.schema === 'articles') return Promise.resolve({ data: [collectionItem] })
        return Promise.resolve({ data: detailArticle })
      },
    })

    const fetchConfig = {
      url: 'https://api.example.com/articles',
      schema: 'articles',
      detail: 'rest',
    }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, { inheritData: ['articles'] })
    expect(result.data.article).toEqual(detailArticle)
    expect(result.data.articles).toBeUndefined()
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/articles/my-post',
        schema: 'article',
      }),
      expect.anything(),
    )
  })

  it('detail: query builds query-param URL', async () => {
    const collectionItem = { slug: 'my-post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) =>
        req.schema === 'articles'
          ? Promise.resolve({ data: [collectionItem] })
          : Promise.resolve({ data: detailArticle }),
    })

    const fetchConfig = {
      url: 'https://api.example.com/articles',
      schema: 'articles',
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
        schema: 'article',
      }),
      expect.anything(),
    )
  })

  it('custom detail pattern substitutes placeholders', async () => {
    const collectionItem = { slug: 'my-post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) =>
        req.schema === 'articles'
          ? Promise.resolve({ data: [collectionItem] })
          : Promise.resolve({ data: detailArticle }),
    })

    const fetchConfig = {
      url: 'https://api.example.com/articles',
      schema: 'articles',
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
        schema: 'article',
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
      schema: 'articles',
      detail: 'rest',
    }
    dataStore.set(deriveCacheKey(fetchConfig), { data: articles })

    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.article).toEqual(detailArticle)
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
      schema: 'articles',
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
    const fetchConfig = { url: 'https://api.example.com/articles', schema: 'articles' }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post', schema: 'articles' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual(articles)
    expect(result.data.article).toEqual({ slug: 'my-post' })
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('localizes /data/ paths for non-default locale', async () => {
    const articles = [{ slug: 'a', title: 'Bonjour' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    website.getActiveLocale = () => 'fr'

    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/fr/data/articles.json', schema: 'articles' }),
      expect.anything(),
    )
  })

  it('does not localize remote URLs', async () => {
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [] }),
    })
    website.getActiveLocale = () => 'fr'

    const fetchConfig = { url: 'https://api.example.com/articles', schema: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    expect(fetcherSpy).toHaveBeenCalledWith(fetchConfig, expect.anything())
  })

  it('does not localize non-/data/ local paths', async () => {
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: { key: 'value' } }),
    })
    website.getActiveLocale = () => 'fr'

    const fetchConfig = { path: '/api/config.json', schema: 'config' }
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
      deriveCacheKey({ path: '/fr/data/articles.json', schema: 'articles' }),
      { data: articles },
    )

    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
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
        if (req.schema === 'articles') return Promise.resolve({ data: articles })
        if (req.schema === 'categories') return Promise.resolve({ data: categories })
        return Promise.resolve({ data: null })
      },
    })
    const fetchConfigs = [
      { path: '/data/articles.json', schema: 'articles' },
      { path: '/data/categories.json', schema: 'categories' },
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
    const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page }, website)
    const controller = new AbortController()

    await entityStore.fetch(block, {}, { signal: controller.signal })
    const ctxArg = fetcherSpy.mock.calls[0][1]
    expect(ctxArg?.signal).toBeDefined()
  })
})
