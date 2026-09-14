import { describe, it, expect, vi } from 'vitest'
import EntityStore from '../src/entity-store.js'
import DataStore, { deriveCacheKey } from '../src/datastore.js'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'
import Website from '../src/website.js'
import { resolveFetchConfigs, routeSelection } from '../src/fetch-config.js'
import { evaluateQuery } from '../src/query-evaluation.js'
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
    // A page's route pattern — a parametric one, so a page given a `dynamicContext`
    // is the page that captured its URL's variable (`pageRouteQuery`). A test of a
    // page nested inside a parametric page sets its own.
    route: '/items/:slug',
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
    expect(fetcherSpy).toHaveBeenCalledWith(expect.objectContaining(fetchConfig), expect.anything())
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

  it('finds fetch config from site-level config — on a page with no parent page', async () => {
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

  it('⛔ the site\'s binding reaches no deeper — a page with a parent page does not get it (ruled 2026-09-13)', async () => {
    const { entityStore, website, fetcherSpy } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [{ name: 'Team A' }] }),
    })
    website.config = { fetch: { path: '/data/teams.json', as: 'teams' } }
    const child = makePage({ route: '/about/team', parent: makePage({ route: '/about' }) })
    expect(await entityStore.fetch(makeBlock({ page: child }, website), {})).toEqual({ data: null, errors: null })
    expect(fetcherSpy).not.toHaveBeenCalled()
    // ⭐ a layout area is the site's own — it has no parent page, so the binding reaches it
    const header = makePage({ route: '/layout/header' })
    const result = await entityStore.fetch(makeBlock({ page: header }, website), {})
    expect(result.data.teams).toEqual([{ name: 'Team A' }])
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
    expect(fetcherSpy).toHaveBeenCalledWith(expect.objectContaining(blockConfig), expect.anything())
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
    const dynamicContext = { paramName: 'slug', paramValue: 'world' }
    const page = makePage({ fetch: fetchConfig })
    const block = makeBlock({ page, dynamicContext }, website)

    const result = await entityStore.fetch(block, {})
    // Detail route: the focused record lands under the collection key as a
    // single-element array; there is no singular `article` key.
    expect(result.data.articles).toEqual([{ slug: 'world', title: 'World' }])
    expect(result.data.article).toBeUndefined()
  })

  // ⭐ An external query's `record:` is the record's own request (2026-09-13 — the
  // authored `detail: rest | query | pattern` forms it replaces are refused).
  const externalSite = (website, record) => {
    website.config = { queries: { articles: { url: 'https://api.example.com/articles', transform: 'results', record } } }
  }

  it('an external query\'s record: fetches the record on its own, with its own transform', async () => {
    const collectionItem = { slug: 'my-post', title: 'My Post' }
    const detailArticle = { ...collectionItem, body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) => {
        if (req.url === 'https://api.example.com/articles') return Promise.resolve({ data: [collectionItem] })
        return Promise.resolve({ data: detailArticle })
      },
    })
    externalSite(website, { url: 'https://api.example.com/articles/{slug}', transform: 'data' })

    const dynamicContext = { paramName: 'slug', paramValue: 'my-post' }
    const parent = makePage({ fetch: { query: 'articles', as: 'articles' } })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, { inheritData: ['articles'] })
    expect(result.data.articles).toEqual([detailArticle])
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://api.example.com/articles/my-post', as: 'articles', transform: 'data' }),
      expect.anything(),
    )
  })

  it('uses the cached list as the gate, then fetches the record', async () => {
    const articles = [{ slug: 'my-post' }, { slug: 'other' }]
    const detailArticle = { slug: 'my-post', body: 'Full' }

    const { entityStore, fetcherSpy, dataStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: detailArticle }),
    })
    externalSite(website, { url: 'https://api.example.com/articles/{slug}' })
    const list = resolveFetchConfigs([{ query: 'articles', as: 'articles' }], { queries: website.config.queries }).get('articles')
    dataStore.set(deriveCacheKey(list), { data: articles })

    const dynamicContext = { paramName: 'slug', paramValue: 'my-post' }
    const parent = makePage({ fetch: { query: 'articles', as: 'articles' } })
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

  it('skips the record request when no dynamicContext', async () => {
    const articles = [{ slug: 'a' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    externalSite(website, { url: 'https://api.example.com/articles/{slug}' })
    const page = makePage({ fetch: { query: 'articles', as: 'articles' } })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual(articles)
    expect(fetcherSpy).toHaveBeenCalledTimes(1)
    expect(fetcherSpy).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.com/articles' }), expect.anything())
  })

  it('falls back to collection fetch when detail is not defined', async () => {
    const articles = [{ slug: 'my-post' }, { slug: 'other' }]
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: articles }),
    })
    const fetchConfig = { url: 'https://api.example.com/articles', as: 'articles' }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual([{ slug: 'my-post' }])
    expect(result.data.article).toBeUndefined()
    expect(fetcherSpy).toHaveBeenCalledWith(expect.objectContaining(fetchConfig), expect.anything())
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
    expect(fetcherSpy).toHaveBeenCalledWith(expect.objectContaining(fetchConfig), expect.anything())
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
    expect(fetcherSpy).toHaveBeenCalledWith(expect.objectContaining(fetchConfig), expect.anything())
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

})

describe('current: — how a section on a parametric page uses the page\'s record (ruled 2026-09-13)', () => {
  // ⛔ It replaces `refine: true, detail: false`, which delivered the "exclude" case
  // alone; its `sort` and `where` changed nothing, and `order` was the one sort read.
  const posts = ['a', 'b', 'c', 'd', 'e'].map((slug, i) => ({ slug, n: i + 1 }))
  const listFetch = { query: 'posts', as: 'posts' }
  const on = (slug) => ({ paramName: 'slug', paramValue: slug, params: { slug, path: slug, dir: '' } })
  // the default fetcher's own order of work: the set, then the fetch's narrowing
  const harness = (queries = { posts: { schema: '@/post' } }) => {
    const h = makeHarness({ fetcherImpl: (req) => Promise.resolve({ data: evaluateQuery(posts, req) }) })
    h.website.config = { queries }
    return h
  }
  const detail = (slug) => makePage({ parent: makePage({ route: '/posts', fetch: listFetch }), dynamicContext: on(slug) })
  const slugs = (result) => result.data.posts.map((p) => p.slug)

  it('only — the default: the record, as a list of one', async () => {
    const { entityStore, website } = harness()
    const page = detail('c')
    expect(slugs(await entityStore.fetch(makeBlock({ page }, website), {}))).toEqual(['c'])
    const explicit = makeBlock({ page, fetch: { ...listFetch, current: 'only' } }, website)
    expect(slugs(await entityStore.fetch(explicit, {}))).toEqual(['c'])
  })

  it('exclude — the records without this page\'s, and `limit` counts the others', async () => {
    const { entityStore, website, fetcherSpy } = harness()
    const block = makeBlock({ page: detail('b'), fetch: { ...listFetch, current: 'exclude', limit: 3 } }, website)
    expect(slugs(await entityStore.fetch(block, {}))).toEqual(['a', 'c', 'd'])
    // the fetch's `narrow.limit` asked one higher, so removing the record still leaves three
    expect(fetcherSpy.mock.calls.map(([req]) => req.narrow?.limit)).toEqual([4])
  })

  it('⭐ exclude never reaches past the set — a query\'s own `limit` bounds the others (ruled 2026-09-14)', async () => {
    const { entityStore, website, fetcherSpy } = harness({ posts: { schema: '@/post', limit: 3 } })
    const block = makeBlock({ page: detail('b'), fetch: { ...listFetch, current: 'exclude', limit: 5 } }, website)
    // the set is a, b, c — so two others, not five
    expect(slugs(await entityStore.fetch(block, {}))).toEqual(['a', 'c'])
    expect(fetcherSpy.mock.calls.map(([req]) => [req.limit, req.narrow?.limit])).toEqual([[3, 6]])
  })

  it('exclude — the order is narrow, sort, remove the record, limit', async () => {
    const { entityStore, website } = harness()
    const block = makeBlock({ page: detail('d'), fetch: { ...listFetch, current: 'exclude', sort: 'n desc', limit: 2 } }, website)
    expect(slugs(await entityStore.fetch(block, {}))).toEqual(['e', 'c'])
  })

  it('exclude — a record outside the first `limit + 1` removes nothing, and the list is cut', async () => {
    const { entityStore, website } = harness()
    const block = makeBlock({ page: detail('e'), fetch: { ...listFetch, current: 'exclude', limit: 2 } }, website)
    expect(slugs(await entityStore.fetch(block, {}))).toEqual(['a', 'b'])
  })

  it('include — all of them, this page\'s record among them: a pager', async () => {
    const { entityStore, website } = harness()
    const block = makeBlock({ page: detail('b'), fetch: { ...listFetch, current: 'include', limit: 3 } }, website)
    expect(slugs(await entityStore.fetch(block, {}))).toEqual(['a', 'b', 'c'])
  })

  it('the sync path gives the same answers from the cache', async () => {
    const { entityStore, website } = harness()
    const exclude = makeBlock({ page: detail('b'), fetch: { ...listFetch, current: 'exclude', limit: 3 } }, website)
    const include = makeBlock({ page: detail('b'), fetch: { ...listFetch, current: 'include', limit: 3 } }, website)
    expect(entityStore.resolve(exclude, {}).status).toBe('pending')
    await entityStore.fetch(exclude, {})
    await entityStore.fetch(include, {})
    expect(entityStore.resolve(exclude, {})).toEqual({ status: 'ready', data: { posts: [posts[0], posts[2], posts[3]] } })
    expect(entityStore.resolve(include, {})).toEqual({ status: 'ready', data: { posts: posts.slice(0, 3) } })
  })

  // ⭐ `current:` FOLLOWS THE QUERY, NOT THE KEY (ruled 2026-09-14 [Diego]): a fetch naming
  // the route query gets the page's record unless its `current:` says otherwise, whatever
  // its `as`; a fetch naming another query gets that query's records, and its `current:` is
  // read when written. ⛔ Until then both were decided by the fetch's KEY: `current:` was
  // read only under the route key, and there it defaulted to the record whatever query the
  // fetch named.
  describe('§2.6 — a fetch of the route query under ANOTHER key', () => {
    it('exclude — the others, under the key it names: `related`', async () => {
      const { entityStore, website, fetcherSpy } = harness()
      const block = makeBlock({ page: detail('b'), fetch: { query: 'posts', as: 'related', current: 'exclude', limit: 3 } }, website)
      const result = await entityStore.fetch(block, {})
      expect(result.data.related.map((p) => p.slug)).toEqual(['a', 'c', 'd'])
      expect(result.data.posts.map((p) => p.slug)).toEqual(['b'])
      expect(fetcherSpy.mock.calls.some(([req]) => req.as === 'related' && req.narrow?.limit === 4)).toBe(true)
    })

    it('no `current:` — the page\'s record, whatever the key', async () => {
      const { entityStore, website } = harness()
      const block = makeBlock({ page: detail('c'), fetch: { query: 'posts', as: 'post' } }, website)
      expect((await entityStore.fetch(block, {})).data.post.map((p) => p.slug)).toEqual(['c'])
    })

    it('include — the records as the fetch describes them', async () => {
      const { entityStore, website } = harness()
      const block = makeBlock({ page: detail('c'), fetch: { query: 'posts', as: 'pager', current: 'include', limit: 2 } }, website)
      expect((await entityStore.fetch(block, {})).data.pager.map((p) => p.slug)).toEqual(['a', 'b'])
    })

    it('the sync path gives the same answer from the cache', async () => {
      const { entityStore, website } = harness()
      const block = makeBlock({ page: detail('b'), fetch: { query: 'posts', as: 'related', current: 'exclude', limit: 3 } }, website)
      await entityStore.fetch(block, {})
      const answer = entityStore.resolve(block, {})
      expect(answer.status).toBe('ready')
      expect(answer.data.related.map((p) => p.slug)).toEqual(['a', 'c', 'd'])
    })

    it('on the records service: exclude asks the list one longer, and the default asks the record', async () => {
      const asked = []
      const { entityStore, website } = makeHarness({
        fetcherImpl: (req) => {
          asked.push({ as: req.as, limit: req.narrow?.limit, match: req.narrow?.match })
          return Promise.resolve({ data: evaluateQuery(posts.map((p) => ({ ...p, $name: p.slug })), req) })
        },
      })
      website.config = { services: { records: '/_records/ask/{locale}' }, queries: { posts: { schema: '@/post' } } }
      const page = makePage({ parent: makePage({ route: '/posts', fetch: { query: 'posts', as: 'posts' } }), dynamicContext: on('a') })
      const related = await entityStore.fetch(makeBlock({ page, fetch: { query: 'posts', as: 'related', current: 'exclude', limit: 2 } }, website), {})
      expect(related.data.related.map((p) => p.slug)).toEqual(['b', 'c'])
      const post = await entityStore.fetch(makeBlock({ page, fetch: { query: 'posts', as: 'post' } }, website), {})
      expect(post.data.post.map((p) => p.slug)).toEqual(['a'])
      expect(asked.filter((q) => q.as === 'related')).toEqual([{ as: 'related', limit: 3, match: undefined }])
      expect(asked.filter((q) => q.as === 'post').map((q) => q.match)).toEqual([{ $name: 'a' }])
    })
  })

  // A section can show another query's records beside the page's record — under the route
  // key, and under any other key alike, since `current:` follows the query.
  describe('a fetch that names ANOTHER query', () => {
    const featured = [{ slug: 'b', n: 2 }, { slug: 'x', n: 9 }, { slug: 'd', n: 4 }]
    const twoQueries = () => {
      const h = makeHarness({
        fetcherImpl: (req) => {
          const rows = req.path === '/data/featured.json' ? featured : posts
          return Promise.resolve({ data: evaluateQuery(rows, req) })
        },
      })
      h.website.config = { queries: { posts: { schema: '@/post' }, featured: { schema: '@/post' } } }
      return h
    }
    const featuredBinding = (extra) => ({ query: 'featured', as: 'posts', ...extra })

    it('exclude — that query\'s records, without this page\'s record', async () => {
      const { entityStore, website, fetcherSpy } = twoQueries()
      const block = makeBlock({ page: detail('b'), fetch: featuredBinding({ current: 'exclude', limit: 2 }) }, website)
      expect(slugs(await entityStore.fetch(block, {}))).toEqual(['x', 'd'])
      expect(fetcherSpy.mock.calls.map(([req]) => req.path)).toEqual(['/data/featured.json'])
    })

    it('include — that query\'s records as the binding describes them', async () => {
      const { entityStore, website } = twoQueries()
      const block = makeBlock({ page: detail('b'), fetch: featuredBinding({ current: 'include' }) }, website)
      expect(slugs(await entityStore.fetch(block, {}))).toEqual(['b', 'x', 'd'])
    })

    it('only — this page\'s record when that query selects it, and none when it does not', async () => {
      const { entityStore, website } = twoQueries()
      const inIt = makeBlock({ page: detail('b'), fetch: featuredBinding({ current: 'only' }) }, website)
      expect(slugs(await entityStore.fetch(inIt, {}))).toEqual(['b'])
      const notInIt = makeBlock({ page: detail('c'), fetch: featuredBinding({ current: 'only' }) }, website)
      expect(slugs(await entityStore.fetch(notInIt, {}))).toEqual([])
    })

    it('⛔ no `current:` — that query\'s records, even under the route key (2026-09-14)', async () => {
      // Until then the route key decided, and this delivered the page's record: ['b'].
      const { entityStore, website } = twoQueries()
      const block = makeBlock({ page: detail('b'), fetch: featuredBinding() }, website)
      expect(slugs(await entityStore.fetch(block, {}))).toEqual(['b', 'x', 'd'])
    })

    it('exclude under a key of its own — `current:` is read there too', async () => {
      // Until 2026-09-14 a key the URL does not narrow ignored it: ['b', 'x', 'd'].
      const { entityStore, website } = twoQueries()
      const block = makeBlock({ page: detail('b'), fetch: { query: 'featured', as: 'highlights', current: 'exclude' } }, website)
      const result = await entityStore.fetch(block, {})
      expect(result.data.highlights.map((p) => p.slug)).toEqual(['x', 'd'])
      expect(slugs(result)).toEqual(['b'])
    })
  })

  it('CONTROL — a fetch that names no query is decided by key: under another key `current:` changes nothing', async () => {
    const { entityStore, website } = harness()
    const page = detail('b')
    const block = makeBlock({ page, fetch: [{ path: '/data/tags.json', as: 'tags', current: 'exclude', limit: 2 }] }, website)
    const result = await entityStore.fetch(block, {})
    expect(result.data.tags.map((p) => p.slug)).toEqual(['a', 'b'])
  })

  it('on the records service, exclude asks the list one longer and never the record', async () => {
    const asked = []
    const { entityStore, website } = makeHarness({
      fetcherImpl: (req) => {
        asked.push({ limit: req.narrow?.limit, match: req.narrow?.match })
        return Promise.resolve({ data: evaluateQuery(posts.map((p) => ({ ...p, $name: p.slug })), req) })
      },
    })
    website.config = { services: { records: '/_records/ask/{locale}' }, queries: { posts: { schema: '@/post' } } }
    const page = makePage({ parent: makePage({ route: '/posts', fetch: { query: 'posts', as: 'posts' } }), dynamicContext: on('a') })
    const block = makeBlock({ page, fetch: { query: 'posts', as: 'posts', current: 'exclude', limit: 2 } }, website)
    const result = await entityStore.fetch(block, {})
    expect(result.data.posts.map((p) => p.slug)).toEqual(['b', 'c'])
    expect(asked).toEqual([{ limit: 3, match: undefined }])
  })
})

describe('a page nested inside a parametric page shares its route query (ruled 2026-09-13)', () => {
  // ⛔ Until then every lane looked one parent up from `/members/:slug/cv`, found no
  // query on the `[slug]` page, and the nested page had no record.
  const members = [{ slug: 'alice', name: 'Alice' }, { slug: 'bob', name: 'Bob' }]
  const pubs = [{ slug: 'p1' }]
  const membersFetch = { path: '/data/members.json', as: 'members' }
  const pubsFetch = { path: '/data/pubs.json', as: 'pubs' }
  const dynamicContext = { paramName: 'slug', paramValue: 'bob', params: { slug: 'bob', path: 'bob', dir: '' }, templateRoute: '/members/:slug/cv' }
  const harness = () => makeHarness({
    fetcherImpl: (req) => Promise.resolve({ data: req.path === membersFetch.path ? members : pubs }),
  })
  const tree = ({ list = null, capturing = null, nestedFetch = null } = {}) => {
    const listPage = makePage({ route: '/members', fetch: list })
    const capturingPage = makePage({ route: '/members/:slug', fetch: capturing, parent: listPage })
    return makePage({ route: '/members/:slug/cv', fetch: nestedFetch, parent: capturingPage, dynamicContext })
  }

  it('the record of a route query declared two levels up — on the list page', async () => {
    const { entityStore, website } = harness()
    const result = await entityStore.fetch(makeBlock({ page: tree({ list: membersFetch }) }, website), {})
    expect(result.data.members).toEqual([members[1]])
  })

  it('the record of a route query declared on the `[slug]` page itself', async () => {
    const { entityStore, website } = harness()
    const result = await entityStore.fetch(makeBlock({ page: tree({ capturing: membersFetch }) }, website), {})
    expect(result.data.members).toEqual([members[1]])
  })

  it('a query the nested page declares under another key is its own data — `:slug` still names a member', async () => {
    const { entityStore, website } = harness()
    const page = tree({ list: membersFetch, nestedFetch: pubsFetch })
    const result = await entityStore.fetch(makeBlock({ page }, website), {})
    expect(result.data.pubs).toEqual(pubs)
    expect(result.data.members).toEqual([members[1]])
  })

  it('CONTROL — only the route key reaches down: the list page\'s other keys do not cascade two levels', async () => {
    const { entityStore, website } = harness()
    const page = tree({ list: [membersFetch, pubsFetch] })
    const result = await entityStore.fetch(makeBlock({ page }, website), {})
    expect(result.data.members).toEqual([members[1]])
    expect(result.data.pubs).toBeUndefined()
  })
})

describe('a record links to its query\'s page — `$route` (ruled 2026-09-14)', () => {
  // ⛔ Until then the link was `route`: baked by the build from `route:` on a query,
  // overwriting an entity's own field, and filled here only from a `detailPage`.
  const cfg = { query: 'articles', as: 'articles', path: '/data/articles.json', detailPage: 'page:detail' }
  const plain = { query: 'articles', as: 'articles', path: '/data/articles.json' }

  function seed(articles, { detailPage = () => null, recordPage = () => null, fetch = cfg } = {}) {
    const h = makeHarness()
    h.website.resolveDetailPageTemplate = detailPage
    h.website.recordPageFor = recordPage
    h.dataStore.set(deriveCacheKey(fetch), { data: articles })
    const block = makeBlock({ page: makePage({ route: '/', fetch }) }, h.website)
    return { ...h, block }
  }

  it('fills each record\'s `$route` from its query\'s page when the fetch picks none (sync path), url-encoding the param', () => {
    const articles = [{ slug: 'a-post', title: 'A' }, { slug: 'b post', title: 'B' }]
    const { entityStore, block } = seed(articles, { fetch: plain, recordPage: (q) => (q === 'articles' ? { route: '/blog/:slug', paramName: 'slug' } : null) })
    const result = entityStore.resolve(block, {})
    expect(result.status).toBe('ready')
    expect(result.data.articles.map((a) => a.$route)).toEqual(['/blog/a-post', '/blog/b%20post'])
    // cached source records are NOT mutated (one record may back other sections)
    expect(articles[0]).not.toHaveProperty('$route')
  })

  it('a fetch\'s `detailPage` picks the page, and wins over the query\'s own', () => {
    const { entityStore, block } = seed([{ slug: 'x' }], {
      detailPage: (ref) => (ref === 'page:detail' ? '/featured/:slug' : null),
      recordPage: () => ({ route: '/blog/:slug', paramName: 'slug' }),
    })
    expect(entityStore.resolve(block, {}).data.articles[0].$route).toBe('/featured/x')
  })

  it('fills on the async fetch path too', async () => {
    const h = makeHarness({ fetcherImpl: () => Promise.resolve({ data: [{ slug: 'x', title: 'X' }] }) })
    h.website.recordPageFor = () => ({ route: '/blog/:slug', paramName: 'slug' })
    const block = makeBlock({ page: makePage({ route: '/', fetch: plain }) }, h.website)
    const result = await h.entityStore.fetch(block, {})
    expect(result.data.articles[0].$route).toBe('/blog/x')
  })

  it('a dangling `detailPage` falls back to the query\'s page', () => {
    const { entityStore, block } = seed([{ slug: 'a' }], { recordPage: () => ({ route: '/blog/:slug', paramName: 'slug' }) })
    expect(entityStore.resolve(block, {}).data.articles[0].$route).toBe('/blog/a')
  })

  it('no page for the query, and no `detailPage` — no link', () => {
    const { entityStore, block } = seed([{ slug: 'a' }], { fetch: plain })
    expect(entityStore.resolve(block, {}).data.articles[0]).not.toHaveProperty('$route')
  })

  it('⭐ a record\'s own `route` is the author\'s field — never read, never overwritten', () => {
    const { entityStore, block } = seed([{ slug: 'a', route: 'north-trail' }], { fetch: plain, recordPage: () => ({ route: '/blog/:slug', paramName: 'slug' }) })
    const record = entityStore.resolve(block, {}).data.articles[0]
    expect(record.route).toBe('north-trail')
    expect(record.$route).toBe('/blog/a')
  })

  it('skips a record missing the :param field — no broken href', () => {
    const { entityStore, block } = seed([{ title: 'no slug' }], { fetch: plain, recordPage: () => ({ route: '/blog/:slug', paramName: 'slug' }) })
    expect(entityStore.resolve(block, {}).data.articles[0]).not.toHaveProperty('$route')
  })
})

describe('`$route` through a real Website — a list on any page links to its query\'s page', () => {
  const site = () => new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en', queries: { articles: { schema: '@std/article' }, news: { schema: '@std/article' } } },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/blog', id: 'blog-list', title: 'Blog', sections: [], fetch: { query: 'articles', as: 'articles' } },
        { route: '/blog/:slug', id: 'article-detail', isDynamic: true, paramName: 'slug', title: 'Article', sections: [] },
        { route: '/news', title: 'News', sections: [], fetch: { query: 'news', as: 'news' } },
        { route: '/news/:slug', id: 'news-detail', isDynamic: true, paramName: 'slug', title: 'News item', sections: [] },
      ],
    },
  })
  const homeBlock = (w, fetch) => ({ fetch: null, dynamicContext: null, page: { route: '/', fetch, parent: null, dynamicContext: null }, website: w })
  const records = [{ slug: 'first', title: 'First' }, { slug: 'second', title: 'Second' }]

  it('a preview on the home page links to the page whose route query is its query — no `detailPage` needed', () => {
    const w = site()
    const fetch = { query: 'articles', as: 'articles', limit: 2 }
    const resolved = resolveFetchConfigs([fetch], { queries: w.config.queries, locale: 'en', defaultLocale: 'en' }).get('articles')
    w.dataStore.set(deriveCacheKey(resolved), { data: records })
    const result = w.entityStore.resolve(homeBlock(w, fetch), {})
    expect(result.status).toBe('ready')
    expect(result.data.articles.map((a) => a.$route)).toEqual(['/blog/first', '/blog/second'])
  })

  it('a `detailPage` resolves through the real page ids', () => {
    const w = site()
    const fetch = { query: 'articles', as: 'articles', detailPage: 'page:news-detail' }
    const resolved = resolveFetchConfigs([fetch], { queries: w.config.queries, locale: 'en', defaultLocale: 'en' }).get('articles')
    w.dataStore.set(deriveCacheKey(resolved), { data: records })
    expect(w.entityStore.resolve(homeBlock(w, fetch), {}).data.articles[0].$route).toBe('/news/first')
  })
})

describe('`$route` from a SECTION\'s own fetch', () => {
  it('a section\'s own `detailPage` wins over its page\'s for the same key', () => {
    const sectionCfg = { query: 'articles', path: '/data/articles.json', as: 'articles', detailPage: 'page:section' }
    const pageCfg = { query: 'articles', path: '/data/articles.json', as: 'articles', detailPage: 'page:page' }
    const h = makeHarness()
    h.website.resolveDetailPageTemplate = (ref) => (ref === 'page:section' ? '/section/:slug' : '/page/:slug')
    h.dataStore.set(deriveCacheKey(sectionCfg), { data: [{ slug: 'x' }] })
    const block = makeBlock({ fetch: sectionCfg, page: makePage({ route: '/', fetch: pageCfg }) }, h.website)
    expect(h.entityStore.resolve(block, {}).data.articles[0].$route).toBe('/section/x')
  })
})

describe('`$route` on the records a section already HOLDS — its own fetch, prerendered into its content', () => {
  // The static build bakes a section's own fetch into `parsedContent.data`, and a key the
  // block holds outranks the store's answer (`prepareProps`), so the store's `$route`
  // never reached the component. `linkOwnRecords` links what it holds by the same rule.
  const plain = { query: 'articles', as: 'articles', path: '/data/articles.json' }
  function held(data, fetch = plain) {
    const h = makeHarness()
    h.website.recordPageFor = (q) => (q === 'articles' ? { route: '/blog/:slug', paramName: 'slug' } : null)
    const block = makeBlock({ fetch, parsedContent: { data }, page: makePage({ route: '/' }) }, h.website)
    return { ...h, block }
  }

  it('links the records under its own fetch\'s key, and writes into nothing it was given', () => {
    const data = { articles: [{ slug: 'a' }, { slug: 'b' }] }
    const { entityStore, block } = held(data)
    entityStore.linkOwnRecords(block)
    expect(block.parsedContent.data.articles.map((a) => a.$route)).toEqual(['/blog/a', '/blog/b'])
    expect(data.articles[0]).not.toHaveProperty('$route')
    expect(block.parsedContent.data).not.toBe(data)
  })

  it('a second render changes nothing — the linked data keeps its identity', () => {
    const { entityStore, block } = held({ articles: [{ slug: 'a' }] })
    entityStore.linkOwnRecords(block)
    const once = block.parsedContent.data
    entityStore.linkOwnRecords(block)
    expect(block.parsedContent.data).toBe(once)
    expect(block.parsedContent.data.articles).toBe(once.articles)
  })

  it('CONTROL — a key no fetch of its own binds is not linked, and nothing is replaced', () => {
    const data = { articles: [{ slug: 'a' }] }
    const { entityStore, block } = held(data, { query: 'news', as: 'news', path: '/data/news.json' })
    entityStore.linkOwnRecords(block)
    expect(block.parsedContent.data).toBe(data)
    expect(data.articles[0]).not.toHaveProperty('$route')
  })

  it('a block with no fetch of its own is left alone', () => {
    const data = { articles: [{ slug: 'a' }] }
    const { entityStore, block } = held(data, null)
    entityStore.linkOwnRecords(block)
    expect(block.parsedContent.data).toBe(data)
  })
})

describe('⛔ a failed fetch delivers NOTHING under its key, and says so', () => {
  // Until 2026-09-04 a failure wrote `[]` into `content.data`: the fetcher
  // returns `{ data: [], error }`, `[]` is neither undefined nor null, and
  // nothing read `error`. By the framework's own rule that `[]` is a value, a
  // failed key was indistinguishable from a successful empty answer.
  it('leaves the key ABSENT — not [] — and reports the message on errors[key]', async () => {
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [], error: 'HTTP 502: Bad Gateway' }),
    })
    const page = makePage({ fetch: { path: '/data/articles.json', as: 'articles' } })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect('articles' in result.data).toBe(false)
    expect(result.data.articles).toBeUndefined()
    expect(result.errors).toEqual({ articles: 'HTTP 502: Bad Gateway' })
  })

  it('CONTROL — a successful empty answer IS delivered as [], with no error', async () => {
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [] }),
    })
    const page = makePage({ fetch: { path: '/data/articles.json', as: 'articles' } })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual([])
    expect(result.errors).toBeNull()
  })

  it('one failed key does not take the others down', async () => {
    const { entityStore, website } = makeHarness({
      fetcherImpl: (req) => req.as === 'articles'
        ? Promise.resolve({ data: [], error: 'down' })
        : Promise.resolve({ data: [{ name: 'Tech' }] }),
    })
    const page = makePage({ fetch: [
      { path: '/data/articles.json', as: 'articles' },
      { path: '/data/categories.json', as: 'categories' },
    ] })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data).toEqual({ categories: [{ name: 'Tech' }] })
    expect(result.errors).toEqual({ articles: 'down' })
  })

  it('a failed DETAIL fetch keeps the record the list matched — never [[]]', async () => {
    // `result.data ?? match` delivered `[[]]` here, because a failure's data is
    // `[]`, not null. The brief the list matched is a held value; keep it.
    const list = [{ slug: 'my-post', title: 'Brief' }]
    const { entityStore, website } = makeHarness({
      fetcherImpl: (req) => req.url === 'https://api.example.com/articles'
        ? Promise.resolve({ data: list })
        : Promise.resolve({ data: [], error: 'HTTP 500' }),
    })
    website.config = { queries: { articles: { url: 'https://api.example.com/articles', record: { url: 'https://api.example.com/articles/{slug}' } } } }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post' }
    const parent = makePage({ fetch: { query: 'articles', as: 'articles' } })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual([{ slug: 'my-post', title: 'Brief' }])
    expect(result.errors).toEqual({ articles: 'HTTP 500' })
  })

  it('a failed LIST fetch on a detail page reports rather than delivering "not found"', async () => {
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [], error: 'down' }),
    })
    const fetchConfig = { url: 'https://api.example.com/articles', as: 'articles' }
    const dynamicContext = { paramName: 'slug', paramValue: 'my-post' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    // `[]` here would have read as "no such record" — a delivered answer.
    expect(result.data.articles).toBeUndefined()
    expect(result.errors).toEqual({ articles: 'down' })
  })

  it('in dev, logs the failure once, naming the key, the page and the address', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [], error: 'down' }),
      dev: true,
    })
    const page = makePage({ fetch: { path: '/data/dev-fail.json', as: 'devfail' }, route: '/x' })
    const block = makeBlock({ page }, website)

    await entityStore.fetch(block, {})
    await entityStore.fetch(block, {})
    const lines = error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('content.data.devfail'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('/x')
    expect(lines[0]).toContain('/data/dev-fail.json')
    expect(lines[0]).toContain('down')
    error.mockRestore()
  })
})

describe('the record in hand reaches the detail address', () => {
  it('a [id] route over a deferred file-lane query fetches the record\'s own per-record file', async () => {
    // `/data/articles/{slug}.json` used to stay literal on an `[id]` route: the
    // context carried `id` and `param`, never `slug`. The list already matched
    // the record, so its slug names the file the build wrote.
    const list = [{ id: 7, slug: 'design-tips', title: 'Brief' }]
    const full = { id: 7, slug: 'design-tips', title: 'Brief', body: 'Full' }
    const { entityStore, fetcherSpy, website } = makeHarness({
      fetcherImpl: (req) => req.path === '/data/articles.json'
        ? Promise.resolve({ data: list })
        : Promise.resolve({ data: full }),
    })
    website.config = { queries: { articles: { deferred: ['body'] } } }
    const fetchConfig = { query: 'articles', path: '/data/articles.json', as: 'articles' }
    const dynamicContext = { paramName: 'id', paramValue: '7' }
    const parent = makePage({ fetch: fetchConfig })
    const page = makePage({ parent, dynamicContext })
    const block = makeBlock({ page }, website)

    const result = await entityStore.fetch(block, {})
    expect(result.data.articles).toEqual([full])
    expect(fetcherSpy).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/data/articles/design-tips.json' }),
      expect.anything(),
    )
  })
})

describe('R1 on a detail page — a record held in full is delivered, not fetched again', () => {
  // On the question door (the one live lane): the list question answers briefs,
  // the query's set narrowed by `$name` answers the record in full.
  const SERVICES = { records: '/_records/ask/{locale}' }
  const QUERIES = { members: { schema: '@std/person' } }
  const briefs = [{ $uuid: 'u1', $name: 'ada', title: 'Ada' }, { $uuid: 'u2', $name: 'lin', title: 'Lin' }]
  const fullAda = { $uuid: 'u1', $name: 'ada', title: 'Ada', bio: 'Full bio' }
  // The record question carries `narrow.match`; the list question does not.
  const isRecord = (req) => req.narrow?.match?.$name !== undefined

  function liveHarness(fetcherImpl) {
    const h = makeHarness({ fetcherImpl })
    h.website.config = { services: SERVICES, queries: QUERIES, defaultLanguage: 'en' }
    return h
  }
  const detailPage = () => {
    const dynamicContext = { paramName: 'slug', paramValue: 'ada' }
    const parent = makePage({ fetch: { query: 'members', as: 'members' } })
    return makePage({ parent, dynamicContext })
  }

  it('asks the record once, then delivers it from the cache on the next visit', async () => {
    const calls = []
    const { entityStore, website } = liveHarness((req) => {
      calls.push(isRecord(req) ? 'record' : 'list')
      return isRecord(req)
        ? Promise.resolve({ data: [fullAda], meta: { whole: true } })
        : Promise.resolve({ data: briefs, meta: { whole: false } })
    })
    const first = await entityStore.fetch(makeBlock({ page: detailPage() }, website), {})
    expect(first.data.members).toEqual([fullAda])
    // ⭐ the record question checks the set, so no list is asked beside it (2026-09-14)
    expect(calls).toEqual(['record'])

    // second visit: the question is cached under its own key — no request
    const second = await entityStore.fetch(makeBlock({ page: detailPage() }, website), {})
    expect(second.data.members).toEqual([fullAda])
    expect(calls).toHaveLength(1)
    const resolved = entityStore.resolve(makeBlock({ page: detailPage() }, website), {})
    expect(resolved.status).toBe('ready')
    expect(resolved.data.members).toEqual([fullAda])
  })

  it('the list page then sees the upgraded record too — R3, through the index', async () => {
    const { entityStore, website } = liveHarness((req) =>
      isRecord(req)
        ? Promise.resolve({ data: [fullAda], meta: { whole: true } })
        : Promise.resolve({ data: briefs, meta: { whole: false } }),
    )
    await entityStore.fetch(makeBlock({ page: detailPage() }, website), {})
    const list = await entityStore.fetch(makeBlock({ page: makePage({ fetch: { query: 'members', as: 'members' } }) }, website), {})
    expect(list.data.members.find((r) => r.$uuid === 'u1').bio).toBe('Full bio')
    expect(list.data.members.find((r) => r.$uuid === 'u2')).toEqual(briefs[1])
  })

  it('CONTROL — a record with no identity is still delivered, cached by its question', async () => {
    const calls = []
    const noIds = [{ $name: 'ada', title: 'Ada' }]
    const { entityStore, website } = liveHarness((req) => {
      calls.push(isRecord(req) ? 'record' : 'list')
      return isRecord(req)
        ? Promise.resolve({ data: [{ $name: 'ada', bio: 'x' }], meta: { whole: true } })
        : Promise.resolve({ data: noIds, meta: { whole: false } })
    })
    const first = await entityStore.fetch(makeBlock({ page: detailPage() }, website), {})
    expect(first.data.members).toEqual([{ $name: 'ada', bio: 'x' }])
    await entityStore.fetch(makeBlock({ page: detailPage() }, website), {})
    expect(calls.filter((c) => c === 'record')).toHaveLength(1) // cached by key, not by index
  })
})

describe('on a question door a detail page asks its RECORD alone — the question checks the set, no scan gates the fetch', () => {
  // ⛔ Until 2026-09-14 the list was asked beside the record: the record question dropped
  // the query's `sort` and `limit` and could not say whether the set held the record.
  const SERVICES = { records: '/_records/ask/{locale}' }
  const QUERIES = { members: { name: 'members', schema: '@std/person', sort: 'name', limit: 100 } }

  it('dispatches the record question alone — the query as saved plus `narrow.match` — and delivers its answer', async () => {
    const asked = []
    const { entityStore, website } = makeHarness({
      fetcherImpl: (req) => {
        asked.push({ whole: req.whole, where: req.where, sort: req.sort, limit: req.limit, narrow: req.narrow })
        if (req.whole === true) return Promise.resolve({ data: [{ $uuid: 'u1', $name: 'ada', name: 'Ada', bio: 'Full' }], meta: { whole: true } })
        return Promise.resolve({ data: [{ $uuid: 'u1', $name: 'ada', name: 'Ada' }], meta: { whole: false } })
      },
    })
    website.config = { services: SERVICES, queries: QUERIES }
    const dynamicContext = { paramName: 'slug', paramValue: 'ada' }
    // the list page narrows the query; the record question does not carry that narrowing
    const parent = makePage({ fetch: { query: 'members', as: 'members', limit: 5 } })
    const page = makePage({ parent, dynamicContext })

    const result = await entityStore.fetch(makeBlock({ page }, website), {})
    expect(result.data.members).toEqual([{ $uuid: 'u1', $name: 'ada', name: 'Ada', bio: 'Full' }])
    // ⭐ one question: the set — its sort and limit — narrowed to the record; the author's `where` untouched
    expect(asked).toEqual([{ whole: true, where: undefined, sort: 'name', limit: 100, narrow: { match: { $name: 'ada' } } }])
    // second visit: the record's answer is cached under its own key; the sync path delivers it
    const resolved = entityStore.resolve(makeBlock({ page }, website), {})
    expect(resolved.status).toBe('ready')
    expect(resolved.data.members[0].bio).toBe('Full')
  })

  it('an empty answer is not-found — the record is not in the set', async () => {
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [], meta: { whole: true } }),
    })
    website.config = { services: SERVICES, queries: QUERIES }
    const dynamicContext = { paramName: 'slug', paramValue: 'nope' }
    const page = makePage({ parent: makePage({ fetch: { query: 'members', as: 'members' } }), dynamicContext })
    const result = await entityStore.fetch(makeBlock({ page }, website), {})
    expect(result.data.members).toEqual([])
    expect(result.errors).toBeNull()
  })

  it('a failed answer is absent, with an error', async () => {
    const { entityStore, website } = makeHarness({
      fetcherImpl: () => Promise.resolve({ data: [], error: 'HTTP 502' }),
    })
    website.config = { services: SERVICES, queries: QUERIES }
    const dynamicContext = { paramName: 'slug', paramValue: 'ada' }
    const page = makePage({ parent: makePage({ fetch: { query: 'members', as: 'members' } }), dynamicContext })
    const result = await entityStore.fetch(makeBlock({ page }, website), {})
    expect('members' in result.data).toBe(false)
    expect(result.errors).toEqual({ members: 'HTTP 502' })
  })
})

describe('the route query names the key a parametric page narrows — at every level (ruled 2026-09-11)', () => {
  const members = [{ slug: 'alice', name: 'Alice' }, { slug: 'bob', name: 'Bob' }]
  const pubs = [{ slug: 'p1' }, { slug: 'p2' }]
  const membersFetch = { path: '/data/members.json', as: 'members' }
  const pubsFetch = { path: '/data/pubs.json', as: 'pubs' }
  const dynamicContext = { paramName: 'slug', paramValue: 'alice', params: { slug: 'alice', path: 'alice', dir: '' } }
  const harness = () => makeHarness({
    fetcherImpl: (req) => Promise.resolve({ data: req.path === membersFetch.path ? members : pubs }),
  })

  it('the site\'s query, on a parametric page whose page and parent declare none', async () => {
    const { entityStore, website } = harness()
    website.config = { fetch: membersFetch }
    const result = await entityStore.fetch(makeBlock({ page: makePage({ dynamicContext }) }, website), {})
    expect(result.data.members).toEqual([members[0]])
  })

  it('the key the page\'s sections share, when no page, parent or site declares one — narrowed in the section that declares it', async () => {
    const { entityStore, website } = harness()
    const page = makePage({ dynamicContext, _bodySections: [{ fetch: membersFetch }, { fetch: membersFetch }] })
    const result = await entityStore.fetch(makeBlock({ page, fetch: membersFetch }, website), {})
    expect(result.data.members).toEqual([members[0]])
  })

  it('sections that declare different keys name no route query — nothing narrows', async () => {
    const { entityStore, website } = harness()
    const page = makePage({ dynamicContext, _bodySections: [{ fetch: membersFetch }, { fetch: pubsFetch }] })
    const result = await entityStore.fetch(makeBlock({ page, fetch: membersFetch }, website), {})
    expect(result.data.members).toEqual(members)
  })

  it('a section\'s own query under ANOTHER key is delivered as declared; the route key still reaches it narrowed', async () => {
    const { entityStore, website } = harness()
    const page = makePage({ dynamicContext, fetch: membersFetch })
    const result = await entityStore.fetch(makeBlock({ page, fetch: pubsFetch }, website), {})
    expect(result.data.pubs).toEqual(pubs)
    expect(result.data.members).toEqual([members[0]])
  })

  it('CONTROL — the page level chooses: its query wins over the key its sections share', async () => {
    const { entityStore, website } = harness()
    const page = makePage({ dynamicContext, fetch: membersFetch, _bodySections: [{ fetch: pubsFetch }] })
    const result = await entityStore.fetch(makeBlock({ page, fetch: pubsFetch }, website), {})
    expect(result.data.pubs).toEqual(pubs)
    expect(result.data.members).toEqual([members[0]])
  })
})

describe('a parametric page over a `multi` field delivers the record a member matches', () => {
  const people = [
    { slug: 'ada', dept: ['biology'] },
    { slug: 'lin', dept: ['geology', 'biology'] },
  ]
  const fetchConfig = { path: '/data/people.json', as: 'people' }
  const harness = () => makeHarness({ fetcherImpl: () => Promise.resolve({ data: people }) })

  it('a member of the field, not the whole array', async () => {
    const { entityStore, website } = harness()
    const page = makePage({ fetch: fetchConfig })
    const dynamicContext = { paramName: 'dept', paramValue: 'geology', params: { slug: 'geology', path: 'geology', dir: '' } }
    const result = await entityStore.fetch(makeBlock({ page, dynamicContext }, website), {})
    expect(result.data.people).toEqual([people[1]])
  })

  it('several records hold the value — the first wins, as it does for any ambiguity', async () => {
    const { entityStore, website } = harness()
    const page = makePage({ fetch: fetchConfig })
    const dynamicContext = { paramName: 'dept', paramValue: 'biology', params: { slug: 'biology', path: 'biology', dir: '' } }
    const result = await entityStore.fetch(makeBlock({ page, dynamicContext }, website), {})
    expect(result.data.people).toEqual([people[0]])
  })
})

describe('a parametric page\'s record is one of its route query\'s SET — past a fetch\'s `limit` it is found, past the query\'s it is not (ruled 2026-09-14)', () => {
  // ⛔ Until 2026-09-13 the compiled-file lane looked the record up in the list the
  // `limit` had cut, so `/blog/e` under a list's `limit: 2` rendered "not found". ⛔ From
  // then until 2026-09-14 no `limit` counted, the query's included, so a record outside
  // a query's `limit` still had a page.
  const posts = ['a', 'b', 'c', 'd', 'e'].map((slug) => ({ slug, title: slug.toUpperCase() }))
  const listFetch = { query: 'posts', as: 'posts', limit: 2 }
  const on = (slug) => ({ paramName: 'slug', paramValue: slug, params: { slug, path: slug, dir: '' } })
  const dynamicContext = on('e')
  // the default fetcher's own order of work: the set, then the fetch's narrowing
  const harness = (queries = { posts: { schema: '@/post' } }) => {
    const h = makeHarness({ fetcherImpl: (req) => Promise.resolve({ data: evaluateQuery(posts, req) }) })
    h.website.config = { queries }
    return h
  }

  it('past a fetch\'s `limit`: found in the set — the request carries no `narrow`', async () => {
    const { entityStore, website, fetcherSpy } = harness()
    const page = makePage({ dynamicContext, parent: makePage({ fetch: listFetch }) })
    const result = await entityStore.fetch(makeBlock({ page }, website), {})
    expect(result.data.posts).toEqual([posts[4]])
    expect(fetcherSpy.mock.calls.map(([req]) => req.narrow)).toEqual([undefined])
  })

  it('⛔ past the query\'s `limit`: not found — a query\'s count is part of what it selects', async () => {
    const { entityStore, website, fetcherSpy } = harness({ posts: { schema: '@/post', limit: 3 } })
    const parent = makePage({ fetch: { query: 'posts', as: 'posts' } })
    const result = await entityStore.fetch(makeBlock({ page: makePage({ dynamicContext, parent }) }, website), {})
    expect(result.data.posts).toEqual([])
    expect(fetcherSpy.mock.calls.map(([req]) => req.limit)).toEqual([3])
    // CONTROL — a record inside the set is found
    const inside = await entityStore.fetch(makeBlock({ page: makePage({ dynamicContext: on('c'), parent }) }, website), {})
    expect(inside.data.posts).toEqual([posts[2]])
  })

  it('resolve() reads the set from the cache — a cached narrowed list alone is a miss, never "not found"', () => {
    const { entityStore, dataStore, website } = harness()
    const page = makePage({ dynamicContext, parent: makePage({ fetch: listFetch }) })
    const narrowed = resolveFetchConfigs([listFetch], { queries: website.config.queries, locale: 'en', defaultLocale: 'en' }).get('posts')
    expect(narrowed.narrow).toEqual({ limit: 2 })
    dataStore.set(deriveCacheKey(narrowed), { data: posts.slice(0, 2) })
    expect(entityStore.resolve(makeBlock({ page }, website), {}).status).toBe('pending')
    dataStore.set(deriveCacheKey(routeSelection(narrowed)), { data: posts })
    const ready = entityStore.resolve(makeBlock({ page }, website), {})
    expect(ready).toEqual({ status: 'ready', data: { posts: [posts[4]] } })
  })

  it('CONTROL — the list page itself still gets the narrowed list', async () => {
    const { entityStore, website } = harness()
    const result = await entityStore.fetch(makeBlock({ page: makePage({ fetch: listFetch }) }, website), {})
    expect(result.data.posts).toEqual(posts.slice(0, 2))
  })
})
