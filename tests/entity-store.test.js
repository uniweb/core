import { describe, it, expect, jest } from '@jest/globals'
import EntityStore from '../src/entity-store.js'
import DataStore from '../src/datastore.js'

/**
 * Helper to create a minimal block stub
 */
function makeBlock(overrides = {}) {
  return {
    fetch: null,
    dynamicContext: null,
    page: makePage(),
    website: null,
    ...overrides,
  }
}

/**
 * Helper to create a minimal page stub
 */
function makePage(overrides = {}) {
  return {
    fetch: null,
    parent: null,
    dynamicContext: null,
    ...overrides,
  }
}

describe('EntityStore', () => {
  describe('resolve()', () => {
    it('returns none when component has no inheritData', () => {
      const dataStore = new DataStore()
      const store = new EntityStore({ dataStore })
      const block = makeBlock()

      const result = store.resolve(block, {})
      expect(result.status).toBe('none')
      expect(result.data).toBeNull()
    })

    it('returns none when meta is null', () => {
      const dataStore = new DataStore()
      const store = new EntityStore({ dataStore })
      const block = makeBlock()

      const result = store.resolve(block, null)
      expect(result.status).toBe('none')
    })

    it('returns ready when DataStore is pre-populated', () => {
      const dataStore = new DataStore()
      const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
      const articles = [{ slug: 'a', title: 'A' }]
      dataStore.set(fetchConfig, articles)

      const store = new EntityStore({ dataStore })
      const page = makePage({ fetch: fetchConfig })
      const block = makeBlock({ page })
      const meta = { inheritData: true }

      const result = store.resolve(block, meta)
      expect(result.status).toBe('ready')
      expect(result.data.articles).toEqual(articles)
    })

    it('returns ready from DataStore cache', () => {
      const dataStore = new DataStore()
      const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
      const articles = [{ slug: 'a' }]
      dataStore.set(fetchConfig, articles)

      const store = new EntityStore({ dataStore })
      const page = makePage({ fetch: fetchConfig })
      const block = makeBlock({ page })
      const meta = { inheritData: true }

      const result = store.resolve(block, meta)
      expect(result.status).toBe('ready')
      expect(result.data.articles).toEqual(articles)
    })

    it('returns pending on cache miss', () => {
      const dataStore = new DataStore()
      const fetchConfig = { path: '/data/articles.json', schema: 'articles' }

      const store = new EntityStore({ dataStore })
      const page = makePage({ fetch: fetchConfig })
      const block = makeBlock({ page })
      const meta = { inheritData: true }

      const result = store.resolve(block, meta)
      expect(result.status).toBe('pending')
      expect(result.data).toBeNull()
    })

    it('returns none when no fetch configs found', () => {
      const dataStore = new DataStore()
      const store = new EntityStore({ dataStore })
      const page = makePage()
      const block = makeBlock({ page })
      const meta = { inheritData: true }

      const result = store.resolve(block, meta)
      expect(result.status).toBe('none')
    })
  })

  describe('fetch()', () => {
    it('walks hierarchy: block → page → parent → site', async () => {
      const dataStore = new DataStore()
      const articles = [{ slug: 'a' }]
      const fetcher = jest.fn().mockResolvedValue({ data: articles })
      dataStore.registerFetcher(fetcher)

      const store = new EntityStore({ dataStore })

      const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
      const parent = makePage({ fetch: fetchConfig })
      const page = makePage({ parent })
      const block = makeBlock({ page })
      const meta = { inheritData: ['articles'] }

      const result = await store.fetch(block, meta)
      expect(result.data.articles).toEqual(articles)
      expect(fetcher).toHaveBeenCalledWith(fetchConfig)
    })

    it('does not walk beyond parent page', async () => {
      const dataStore = new DataStore()
      const fetcher = jest.fn().mockResolvedValue({ data: [] })
      dataStore.registerFetcher(fetcher)

      const store = new EntityStore({ dataStore })

      const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
      const grandparent = makePage({ fetch: fetchConfig })
      const parent = makePage({ parent: grandparent })
      const page = makePage({ parent })
      const block = makeBlock({ page })
      const meta = { inheritData: ['articles'] }

      const result = await store.fetch(block, meta)
      // Should NOT find grandparent's fetch config — only walks one parent level
      expect(result.data).toBeNull()
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('finds fetch config from site-level config', async () => {
      const dataStore = new DataStore()
      const teams = [{ name: 'Team A' }]
      const fetcher = jest.fn().mockResolvedValue({ data: teams })
      dataStore.registerFetcher(fetcher)

      const store = new EntityStore({ dataStore })

      const fetchConfig = { path: '/data/teams.json', schema: 'teams' }
      const page = makePage()
      const block = makeBlock({
        page,
        website: { config: { fetch: fetchConfig }, dataStore },
      })
      const meta = { inheritData: true }

      const result = await store.fetch(block, meta)
      expect(result.data.teams).toEqual(teams)
    })

    it('first match per schema wins (block overrides page)', async () => {
      const dataStore = new DataStore()
      const blockArticles = [{ from: 'block' }]
      const pageArticles = [{ from: 'page' }]

      const blockConfig = { path: '/data/block-articles.json', schema: 'articles' }
      const pageConfig = { path: '/data/page-articles.json', schema: 'articles' }

      const fetcher = jest.fn((config) => {
        if (config.path === blockConfig.path) return Promise.resolve({ data: blockArticles })
        return Promise.resolve({ data: pageArticles })
      })
      dataStore.registerFetcher(fetcher)

      const store = new EntityStore({ dataStore })
      const page = makePage({ fetch: pageConfig })
      const block = makeBlock({ page, fetch: blockConfig })
      const meta = { inheritData: true }

      const result = await store.fetch(block, meta)
      expect(result.data.articles).toEqual(blockArticles)
      // Should only fetch the block-level config (first match wins)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledWith(blockConfig)
    })

    it('resolves singular item for dynamic routes', async () => {
      const dataStore = new DataStore()
      const articles = [
        { slug: 'hello', title: 'Hello' },
        { slug: 'world', title: 'World' },
      ]
      const fetcher = jest.fn().mockResolvedValue({ data: articles })
      dataStore.registerFetcher(fetcher)

      const store = new EntityStore({ dataStore })

      const fetchConfig = { path: '/data/articles.json', schema: 'articles' }
      const dynamicContext = {
        paramName: 'slug',
        paramValue: 'world',
        schema: 'articles',
      }
      const page = makePage({ fetch: fetchConfig })
      const block = makeBlock({ page, dynamicContext })
      const meta = { inheritData: true }

      const result = await store.fetch(block, meta)
      expect(result.data.articles).toEqual(articles)
      expect(result.data.article).toEqual({ slug: 'world', title: 'World' })
    })

    it('returns null data when no inheritData', async () => {
      const dataStore = new DataStore()
      const store = new EntityStore({ dataStore })
      const block = makeBlock()

      const result = await store.fetch(block, {})
      expect(result.data).toBeNull()
    })

    it('returns null data when no fetch configs found', async () => {
      const dataStore = new DataStore()
      const store = new EntityStore({ dataStore })
      const page = makePage()
      const block = makeBlock({ page })
      const meta = { inheritData: true }

      const result = await store.fetch(block, meta)
      expect(result.data).toBeNull()
    })

    it('fetches multiple schemas in parallel', async () => {
      const dataStore = new DataStore()
      const articles = [{ slug: 'a' }]
      const categories = [{ name: 'Tech' }]

      const fetcher = jest.fn((config) => {
        if (config.schema === 'articles') return Promise.resolve({ data: articles })
        if (config.schema === 'categories') return Promise.resolve({ data: categories })
        return Promise.resolve({ data: null })
      })
      dataStore.registerFetcher(fetcher)

      const store = new EntityStore({ dataStore })
      const fetchConfigs = [
        { path: '/data/articles.json', schema: 'articles' },
        { path: '/data/categories.json', schema: 'categories' },
      ]
      const page = makePage({ fetch: fetchConfigs })
      const block = makeBlock({ page })
      const meta = { inheritData: true }

      const result = await store.fetch(block, meta)
      expect(result.data.articles).toEqual(articles)
      expect(result.data.categories).toEqual(categories)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
  })
})
