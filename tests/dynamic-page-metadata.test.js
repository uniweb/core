/**
 * A detail page's title, description and not-found flag come from the record
 * the page is ABOUT — and the probe that finds it has to look where the entity
 * store WROTE it.
 *
 * Two defects, both silent on a visitor's page, both measured 2026-09-04:
 *
 *   1. `_createDynamicPage` peeked the parent's fetch AS AUTHORED while the store
 *      writes under the RESOLVED config. On a live lane (`door`, no `path`)
 *      and on a non-default locale (`/fr/data/…`) the keys differ, so the probe
 *      always missed: no title, no not-found, page never cached.
 *   2. It scanned the LIST only. On a cold load of a detail URL the list is not
 *      cached while the record may be — a live lane's record address, a deferred
 *      query's per-record file — and the scan found nothing (F3).
 */
import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'
import { deriveCacheKey } from '../src/datastore.js'
import { resolveFetchConfigs } from '../src/fetch-config.js'
import { buildDetailConfig } from '../src/detail-url.js'

// The one live lane: the question door, with the query's Model ref on the payload.
const SERVICES = { records: '/_records/_query/{locale}' }
const QUERIES = { articles: { schema: '@x/article' } }
const LIVE = { services: SERVICES, queries: QUERIES }
// The keys the entity store writes on that lane — computed by the same rule, never
// hand-written, so the probe and the store cannot disagree.
const listCfg = (w) => resolveFetchConfigs([{ query: 'articles', path: '/data/articles.json', as: 'articles' }], {
  services: SERVICES, queries: QUERIES,
  locale: w.getActiveLocale?.() ?? null, defaultLocale: w.getDefaultLocale?.() ?? null,
}).get('articles')
const listKey = (w) => deriveCacheKey(listCfg(w))
const recordKey = (w, slug) => deriveCacheKey(buildDetailConfig(listCfg(w), { paramName: 'slug', paramValue: slug }))

function site(config = {}) {
  return new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en', ...config },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/blog', title: 'Blog', sections: [], fetch: { query: 'articles', path: '/data/articles.json', as: 'articles' } },
        { route: '/blog/:slug', isDynamic: true, paramName: 'slug', title: 'Article', sections: [] },
      ],
    },
  })
}

describe('the probe reads the key the store writes', () => {
  it('on a live lane the list is cached under its QUESTION — and the title is found there', () => {
    const w = site(LIVE)
    // What the entity store writes for `{ query: 'articles' }` on this lane.
    w.dataStore.set(listKey(w), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    const page = w.getPage('/blog/hello')
    expect(page.title).toBe('Hello World')
  })

  it('on a live lane a missing record is a definitive not-found once the list is cached', () => {
    const w = site(LIVE)
    w.dataStore.set(listKey(w), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    const page = w.getPage('/blog/nope')
    expect(page.notFound).toBe(true)
    expect(page.title).toBe('Not found')
  })

  it('on a non-default locale the list is cached under its localized path', () => {
    const w = site({ languages: ['en', 'fr'] })
    w.setActiveLocale?.('fr')
    w.activeLocale = 'fr'
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', path: '/fr/data/articles.json' }), {
      data: [{ slug: 'bonjour', title: 'Bonjour' }],
    })
    const page = w.getPage('/fr/blog/bonjour')
    expect(page.title).toBe('Bonjour')
  })

  it('CONTROL — the static lane, default locale, still resolves as before', () => {
    const w = site()
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', path: '/data/articles.json' }), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    expect(w.getPage('/blog/hello').title).toBe('Hello World')
  })
})

describe('the page is about one record, so the record is asked first (F3)', () => {
  it('a cold load with the RECORD cached and the list not still titles the page', () => {
    const w = site(LIVE)
    // Only the detail question landed (the door answers one record by its handle).
    w.dataStore.set(recordKey(w, 'hello'), {
      data: [{ slug: 'hello', title: 'Hello World', description: 'The one' }],
    })
    const page = w.getPage('/blog/hello')
    expect(page.title).toBe('Hello World')
    expect(page.description).toBe('The one')
    expect(page.notFound).toBeFalsy()
  })

  it('and caches the resolved page, since the record was available', () => {
    const w = site(LIVE)
    w.dataStore.set(recordKey(w, 'hello'), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    expect(w.getPage('/blog/hello')).toBe(w.getPage('/blog/hello'))
  })

  it('with neither cached, nothing is claimed: no title change, no not-found, page not cached', () => {
    const w = site(LIVE)
    const first = w.getPage('/blog/hello')
    expect(first.title).toBe('Article')
    expect(first.notFound).toBeFalsy()
    expect(w.getPage('/blog/hello')).not.toBe(first)
  })

  it('⭐ on a live lane an answered record question of `[]` is a definitive not-found — no list needed (2026-09-14)', () => {
    // The record question checks the route query's set, so its empty answer means the set
    // does not hold the record; the page asks no list beside it any more.
    const w = site(LIVE)
    w.dataStore.set(recordKey(w, 'nope'), { data: [] })
    const page = w.getPage('/blog/nope')
    expect(page.notFound).toBe(true)
    expect(page.title).toBe('Not found')
    // and the answer was available, so the page is cached
    expect(w.getPage('/blog/nope')).toBe(page)
  })
})

describe('the record names the page by the one title rule — `recordTitle` (ruled 2026-09-14)', () => {
  // ⛔ Until then the page read `title` alone, so a record with a `name` and no `title`
  // kept the template's title. Measured on a served site whose template title was the
  // route token: the page read `:slug` while its body rendered the person.
  const personSite = () => site(LIVE)

  it('a live record — `$name`, a `name`, no `title` — titles the page by its name', () => {
    const w = personSite()
    w.dataStore.set(recordKey(w, 'alice'), {
      data: [{ $uuid: 'u1', $name: 'alice', name: 'Alice Nguyen' }],
    })
    const page = w.getPage('/blog/alice')
    expect(page.title).toBe('Alice Nguyen')
    expect(page.notFound).toBeFalsy()
  })

  it('a record with neither `title` nor `name` is titled by its handle, never the template\'s title', () => {
    const w = personSite()
    w.dataStore.set(recordKey(w, 'alice'), { data: [{ $uuid: 'u1', $name: 'alice' }] })
    expect(w.getPage('/blog/alice').title).toBe('alice')
  })

  it('on the file lane the list\'s record is titled by the same rule', () => {
    const w = site()
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', path: '/data/articles.json' }), {
      data: [{ slug: 'ada', name: 'Ada Lovelace' }],
    })
    expect(w.getPage('/blog/ada').title).toBe('Ada Lovelace')
  })

  it('a value that is not text does not name the page — the next step does', () => {
    const w = personSite()
    w.dataStore.set(recordKey(w, 'alice'), {
      data: [{ $name: 'alice', title: { en: 'A map' }, name: 'Alice Nguyen' }],
    })
    expect(w.getPage('/blog/alice').title).toBe('Alice Nguyen')
  })

  it('CONTROL — `title` still wins over `name`', () => {
    const w = personSite()
    w.dataStore.set(recordKey(w, 'hello'), {
      data: [{ $name: 'hello', title: 'Hello World', name: 'Not this' }],
    })
    expect(w.getPage('/blog/hello').title).toBe('Hello World')
  })
})

describe('recordPageFor — the page a query\'s records link to (ruled 2026-09-14)', () => {
  const pagesOf = (pages) => new Website({ content: { config: { name: 'T', defaultLanguage: 'en' }, theme: {}, pages } })

  it('answers from the parametric page whose route query is the query', () => {
    const w = site()
    expect(w.recordPageFor('articles')).toEqual({ route: '/blog/:slug', paramName: 'slug' })
  })

  it('is null for a query the site routes no page over, and for no query', () => {
    const w = site()
    expect(w.recordPageFor('people')).toBeNull()
    expect(w.recordPageFor(undefined)).toBeNull()
  })

  it('reports the author\'s own param name, not a default', () => {
    const w = pagesOf([
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/products', title: 'P', sections: [], fetch: { query: 'products', path: '/data/products.json', as: 'products' } },
      { route: '/products/:id', isDynamic: true, paramName: 'id', title: 'Product', sections: [] },
    ])
    expect(w.recordPageFor('products')).toEqual({ route: '/products/:id', paramName: 'id' })
  })

  it('several pages route the query — the first in page order', () => {
    const w = pagesOf([
      { route: '/blog', title: 'Blog', sections: [], fetch: { query: 'articles', as: 'articles' } },
      { route: '/blog/:slug', isDynamic: true, paramName: 'slug', title: 'A', sections: [] },
      { route: '/archive', title: 'Archive', sections: [], fetch: { query: 'articles', as: 'articles' } },
      { route: '/archive/:slug', isDynamic: true, paramName: 'slug', title: 'B', sections: [] },
    ])
    expect(w.recordPageFor('articles').route).toBe('/blog/:slug')
  })

  it('⛔ the same schema is not enough — a page routing another query over it is not the page', () => {
    const w = pagesOf([
      { route: '/news', title: 'News', sections: [], fetch: { query: 'news', as: 'news' } },
      { route: '/news/:slug', isDynamic: true, paramName: 'slug', title: 'N', sections: [] },
    ])
    w.config.queries = { news: { schema: '@std/article' }, articles: { schema: '@std/article' } }
    expect(w.recordPageFor('news').route).toBe('/news/:slug')
    expect(w.recordPageFor('articles')).toBeNull()
  })

  it('⛔ a page nested inside a parametric page is not a record\'s page', () => {
    const w = pagesOf([
      { route: '/team', title: 'Team', sections: [], fetch: { query: 'members', as: 'members' } },
      { route: '/team/:slug/cv', isDynamic: true, paramName: 'slug', title: 'CV', sections: [] },
    ])
    expect(w.recordPageFor('members')).toBeNull()
  })

  it('⭐ answers on a PRERENDERED payload too — concrete pages that carry their template\'s route, and no template', () => {
    // A static build replaces `/logbook/:path*` with one page per record
    // (`expandDynamicPages`); the payload it prerenders and hydrates holds no template.
    // ⛔ Measured on the `dynamic` template: read from templates alone, no record linked.
    const concrete = (route, capture) => ({
      route, title: capture, parent: '/logbook', sections: [],
      dynamicContext: { templateRoute: '/logbook/:path*', params: { path: capture }, paramName: 'slug', paramValue: capture.split('/').pop() },
    })
    const w = pagesOf([
      { route: '/logbook', title: 'Logbook', sections: [], fetch: { query: 'logbook', as: 'logbook' } },
      concrete('/logbook/field/river-survey', 'field/river-survey'),
      concrete('/logbook/welcome', 'welcome'),
    ])
    expect(w.recordPageFor('logbook')).toEqual({ route: '/logbook/:path*', paramName: 'slug' })
  })

  it('⛔ answers by query NAME, never by the key the route query lands under', () => {
    // `detailTemplateFor`, which this replaced, answered for either — so a page whose route
    // query landed under the key `posts` answered for any query delivered as `posts`.
    const w = pagesOf([
      { route: '/blog', title: 'Blog', sections: [], fetch: { query: 'articles', as: 'posts' } },
      { route: '/blog/:id', isDynamic: true, paramName: 'id', title: 'Post', sections: [] },
    ])
    expect(w.recordPageFor('articles')).toEqual({ route: '/blog/:id', paramName: 'id' })
    expect(w.recordPageFor('posts')).toBeNull()
  })
})

describe('a [...path] template binds its capture to the standard variables', () => {
  function pathSite() {
    return new Website({
      content: {
        config: { name: 'T', defaultLanguage: 'en' },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/blog', title: 'Blog', sections: [], fetch: { query: 'posts', path: '/data/posts.json', as: 'posts' } },
          { route: '/blog/:path*', isDynamic: true, paramName: 'slug', title: 'Post', sections: [] },
        ],
      },
    })
  }

  it('delivers by slug, the last segment, and exposes path and dir', () => {
    const w = pathSite()
    w.dataStore.set(deriveCacheKey({ query: 'posts', as: 'posts', path: '/data/posts.json' }), {
      data: [{ slug: 'my-post', path: 'rust/2025', title: 'Rust post' }],
    })
    const page = w.getPage('/blog/rust/2025/my-post')
    expect(page.dynamicContext).toEqual({
      templateRoute: '/blog/:path*',
      params: { path: 'rust/2025/my-post', dir: 'rust/2025', slug: 'my-post' },
      paramName: 'slug',
      paramValue: 'my-post',
    })
    // ⛔ no `schema`: the key the URL narrows is worked out where it is read
    expect('schema' in page.dynamicContext).toBe(false)
    expect(page.title).toBe('Rust post')
  })

  it('a single segment binds an empty dir, so :slug means the same thing as under [slug]', () => {
    const w = pathSite()
    const page = w.getPage('/blog/my-post')
    expect(page.dynamicContext.params).toEqual({ path: 'my-post', dir: '', slug: 'my-post' })
    expect(page.dynamicContext.paramValue).toBe('my-post')
  })

  it('a [slug] page binds the same three variables — one segment is :slug and :path, :dir empty', () => {
    const w = site()
    const page = w.getPage('/blog/hello')
    expect(page.dynamicContext.params).toEqual({ slug: 'hello', path: 'hello', dir: '' })
    expect(page.dynamicContext.paramName).toBe('slug')
  })

  it('an [id] page keeps its capture under its own label beside the three', () => {
    const w = new Website({
      content: {
        config: { name: 'T', defaultLanguage: 'en' },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/products', title: 'P', sections: [], fetch: { query: 'products', path: '/data/products.json', as: 'products' } },
          { route: '/products/:id', isDynamic: true, paramName: 'id', title: 'Product', sections: [] },
        ],
      },
    })
    const page = w.getPage('/products/7')
    expect(page.dynamicContext).toMatchObject({ paramName: 'id', paramValue: '7', params: { id: '7', slug: '7', path: '7', dir: '' } })
  })
})

describe('the route query is chosen at the page level — the page, its parent, the site (ruled 2026-09-11)', () => {
  const people = [{ slug: 'ada', title: 'Ada' }]
  const withPages = (pages, config = {}) => new Website({
    content: { config: { name: 'T', defaultLanguage: 'en', ...config }, theme: {}, pages },
  })
  const key = (name) => deriveCacheKey({ path: `/data/${name}.json`, as: name })

  it('a query on the parametric page itself is its route query — the title is found', () => {
    const w = withPages([
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/team', title: 'Team', sections: [] },
      { route: '/team/:slug', isDynamic: true, paramName: 'slug', title: 'Person', sections: [], fetch: { query: 'people', path: '/data/people.json', as: 'people' } },
    ])
    w.dataStore.set(key('people'), { data: people })
    expect(w.getPage('/team/ada').title).toBe('Ada')
  })

  it('a query only in site.yml is the route query of a TOP-LEVEL parametric page', () => {
    const w = withPages([
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/:slug', isDynamic: true, paramName: 'slug', title: 'Person', sections: [] },
    ], { fetch: { query: 'people', path: '/data/people.json', as: 'people' } })
    w.dataStore.set(key('people'), { data: people })
    expect(w.getPage('/ada').title).toBe('Ada')
    expect(w.getPage('/nobody').notFound).toBe(true)
  })

  it('⛔ and of no deeper one — the site is the virtual root page, not every page\'s ancestor (ruled 2026-09-13)', () => {
    const w = withPages([
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/team', title: 'Team', sections: [] },
      { route: '/team/:slug', isDynamic: true, paramName: 'slug', title: 'Person', sections: [] },
    ], { fetch: { query: 'people', path: '/data/people.json', as: 'people' } })
    w.dataStore.set(key('people'), { data: people })
    expect(w.getPage('/team/ada').title).toBe('Person')
    expect(w.getPage('/team/ada').notFound).toBeFalsy()
  })

  it('a top-level parametric page has no parent — the homepage\'s query is not its route query', () => {
    // It probed the homepage until 2026-09-11, a parent the section cascade never used.
    const w = withPages([
      { route: '/', isIndex: true, title: 'Home', sections: [], fetch: { query: 'news', path: '/data/news.json', as: 'news' } },
      { route: '/:slug', isDynamic: true, paramName: 'slug', title: 'Person', sections: [] },
    ], { fetch: { query: 'people', path: '/data/people.json', as: 'people' } })
    w.dataStore.set(key('news'), { data: [{ slug: 'ada', title: 'A news item' }] })
    w.dataStore.set(key('people'), { data: people })
    const page = w.getPage('/ada')
    expect(page.parent).toBeNull()
    expect(page.title).toBe('Ada')
  })

  it('recordPageFor answers for the site\'s query on a top-level parametric page', () => {
    const w = withPages([
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/:slug', isDynamic: true, paramName: 'slug', title: 'Person', sections: [] },
    ], { fetch: { query: 'people', path: '/data/people.json', as: 'people' } })
    expect(w.recordPageFor('people')).toEqual({ route: '/:slug', paramName: 'slug' })
  })
})

describe('a page nested inside a parametric page is parametric too (ruled 2026-09-11)', () => {
  function nestedSite() {
    return new Website({
      content: {
        config: { name: 'T', defaultLanguage: 'en' },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/members', title: 'Members', sections: [], fetch: { query: 'members', path: '/data/members.json', as: 'members' } },
          { route: '/members/:slug', isDynamic: true, paramName: 'slug', title: 'Member', sections: [], fetch: { query: 'members', path: '/data/members.json', as: 'members' } },
          { route: '/members/:slug/cv', isDynamic: true, paramName: 'slug', parent: '/members/:slug', title: 'CV', sections: [] },
        ],
      },
    })
  }

  it('routes, binds its ancestor\'s param, and inherits from the parametric page above it', () => {
    const w = nestedSite()
    w.dataStore.set(deriveCacheKey({ path: '/data/members.json', as: 'members' }), { data: [{ slug: 'alice', title: 'Alice' }] })
    const page = w.getPage('/members/alice/cv')
    expect(page.route).toBe('/members/alice/cv')
    expect(page.dynamicContext).toMatchObject({ paramName: 'slug', paramValue: 'alice', params: { slug: 'alice', path: 'alice', dir: '' } })
    expect(page.parent.route).toBe('/members/:slug')
    // its route query is its parent's — the parametric page above, which declares `members`
    expect(page.title).toBe('Alice')
  })
})

describe('a parametric page\'s record is one of its route query\'s set — a fetch\'s `limit` decides nothing, the query\'s does (ruled 2026-09-14)', () => {
  // ⛔ Until 2026-09-13 the probe read the list a fetch's `limit` cut, and a record past it
  // was declared not found as soon as that list was cached. ⛔ Until 2026-09-14 no `limit`
  // counted — the query's included.
  const limited = (queries = { articles: { schema: '@x/article' } }) => new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en', queries },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/blog', title: 'Blog', sections: [], fetch: { query: 'articles', path: '/data/articles.json', as: 'articles', limit: 1 } },
        { route: '/blog/:slug', isDynamic: true, paramName: 'slug', title: 'Article', sections: [] },
      ],
    },
  })
  const records = [{ slug: 'hello', title: 'Hello' }, { slug: 'world', title: 'World' }]
  const file = { query: 'articles', as: 'articles', path: '/data/articles.json' }

  it('the list a fetch narrowed claims nothing about a record past its count', () => {
    const w = limited()
    w.dataStore.set(deriveCacheKey({ ...file, narrow: { limit: 1 } }), { data: records.slice(0, 1) })
    const page = w.getPage('/blog/world')
    expect(page.notFound).toBeFalsy()
    expect(page.title).toBe('Article')
  })

  it('the set titles it', () => {
    const w = limited()
    w.dataStore.set(deriveCacheKey(file), { data: records })
    expect(w.getPage('/blog/world').title).toBe('World')
  })

  it('⛔ a record past the QUERY\'s `limit` is not found once the set is loaded — a query\'s count is part of what it selects', () => {
    const w = limited({ articles: { schema: '@x/article', limit: 1 } })
    // the set: the query as saved, its `limit` included
    w.dataStore.set(deriveCacheKey({ ...file, limit: 1 }), { data: records.slice(0, 1) })
    const page = w.getPage('/blog/world')
    expect(page.notFound).toBe(true)
    // CONTROL — the record the set holds is titled
    expect(w.getPage('/blog/hello').title).toBe('Hello')
  })
})

describe('a page nested inside a parametric page is titled by its record (ruled 2026-09-13)', () => {
  const nested = () => new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en' },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/team', title: 'Team', sections: [], fetch: { query: 'members', path: '/data/members.json', as: 'members' } },
        { route: '/team/:slug', isDynamic: true, paramName: 'slug', title: 'Member', sections: [] },
        { route: '/team/:slug/cv', isDynamic: true, paramName: 'slug', title: 'CV', sections: [] },
      ],
    },
  })

  it('its route query is the capturing page\'s — declared two levels up', () => {
    const w = nested()
    w.dataStore.set(deriveCacheKey({ query: 'members', as: 'members', path: '/data/members.json' }), {
      data: [{ slug: 'ada', title: 'Ada Lovelace' }],
    })
    expect(w.getPage('/team/ada/cv').title).toBe('Ada Lovelace')
    expect(w.getPage('/team/nobody/cv').notFound).toBe(true)
  })
})
