/**
 * ⭐ THE TWO DRIVERS AGREE — the same plan, run both ways.
 *
 * `EntityStore.fetch` runs a block's plan by dispatching; `EntityStore.resolve` runs the SAME plan
 * against the cache, and that is what a server-side render reads. So the property this file pins is
 * the one every prerendered page depends on:
 *
 *   **after a fetch, a resolve finds everything, and delivers the same values.**
 *
 * ⛔ Nothing else notices when it breaks. In the browser a disagreement is invisible: `BlockRenderer`
 * renders what `fetch` returned, so the block shows its data whether or not `resolve` could find it
 * again. It shows up only where a render has no second chance — the HTML a crawler, a link preview or
 * an agent reads — which is exactly the class of failure that made
 * `kb/framework/plans/what-a-page-needs.md` necessary.
 *
 * ⚖️ Every case is its own control: `resolve` is asked BEFORE the fetch and must be `pending`, so
 * "ready afterwards" cannot pass by the plan asking for nothing.
 */
import { describe, it, expect, vi } from 'vitest'
import EntityStore from '../src/entity-store.js'
import DataStore from '../src/datastore.js'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'

function makeHarness({ answer, config = {} } = {}) {
  const dataStore = new DataStore()
  const defaultFetcher = { resolve: vi.fn((req) => Promise.resolve(answer(req))) }
  const fetcher = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })
  const website = {
    dataStore,
    fetcher,
    config,
    getActiveLocale: () => 'en',
    getDefaultLocale: () => 'en',
  }
  const entityStore = new EntityStore({ website })
  website.entityStore = entityStore
  return { entityStore, website, asked: defaultFetcher.resolve }
}

const declaring = (...keys) => ({ data: Object.fromEntries(keys.map((key) => [key, null])) })
const page = (over = {}) => ({ route: '/posts/:slug', fetch: null, parent: null, dynamicContext: null, ...over })
const block = (over, website) => ({ fetch: null, dynamicContext: null, page: page(), website, ...over })
const on = (slug) => ({ paramName: 'slug', paramValue: slug, params: { slug, path: slug, dir: '' } })

const POSTS = [
  { slug: 'a', title: 'A', n: 1 },
  { slug: 'b', title: 'B', n: 2 },
  { slug: 'c', title: 'C', n: 3 },
]
const LIST = { query: 'posts', as: 'posts' }
const list = page({ route: '/posts', fetch: LIST })

/** A fetcher that answers a list, a per-record file, and a question door. */
const answers = (req) => {
  if (req.ask) return { data: [{ $uuid: 'u1', $name: 'c', slug: 'c', title: 'C', body: 'Full' }], meta: { whole: true } }
  if (req.path === '/data/posts/c.json') return { data: { slug: 'c', title: 'C', body: 'Full' }, meta: { whole: true } }
  return { data: POSTS }
}

/**
 * Each case: the site's config, the block, and what its component declares. The assertion is the
 * same for all of them, which is the point — one rule, two drivers.
 */
const CASES = {
  'a plain list': {
    config: { queries: { posts: { schema: '@/post' } } },
    block: (w) => block({ page: page({ route: '/posts', fetch: LIST }) }, w),
    meta: declaring('posts'),
  },
  'a page the record plays no part in — `include`': {
    config: { queries: { posts: { schema: '@/post' } } },
    block: (w) => block({ page: page({ parent: list, dynamicContext: on('b') }), fetch: { ...LIST, current: 'include' } }, w),
    meta: declaring('posts'),
  },
  '`exclude` — the others, one longer then cut': {
    config: { queries: { posts: { schema: '@/post' } } },
    block: (w) => block({ page: page({ parent: list, dynamicContext: on('b') }), fetch: { ...LIST, as: 'related', current: 'exclude', limit: 2 } }, w),
    meta: declaring('related'),
  },
  '`only` — the record found in its query’s set': {
    config: { queries: { posts: { schema: '@/post' } } },
    block: (w) => block({ page: page({ parent: list, dynamicContext: on('c') }) }, w),
    meta: declaring('posts'),
  },
  '`only` — a `deferred:` query, so the record is asked for in full AFTER the set answers': {
    config: { queries: { posts: { schema: '@/post', path: '/data/posts.json', deferred: ['body'] } } },
    block: (w) => block({ page: page({ parent: list, dynamicContext: on('c') }) }, w),
    meta: declaring('posts'),
  },
  '`only` — a question door asks the record alone': {
    config: { services: { records: '/_records/ask/{locale}' }, queries: { posts: { schema: '@/post', sort: 'title', limit: 50 } } },
    block: (w) => block({ page: page({ parent: list, dynamicContext: on('c') }) }, w),
    meta: declaring('posts'),
  },
  'a record that is not in the set — not found, which is a value': {
    config: { queries: { posts: { schema: '@/post' } } },
    block: (w) => block({ page: page({ parent: list, dynamicContext: on('zzz') }) }, w),
    meta: declaring('posts'),
  },
  'two keys at once — one filled by name, one by schema': {
    config: { queries: { posts: { schema: '@/post' } } },
    block: (w) => block({
      page: page({ route: '/posts', fetch: [LIST, { query: 'posts', as: 'featured', limit: 1 }] }),
    }, w),
    meta: declaring('posts', 'featured'),
  },
}

describe('the plan’s two drivers agree', () => {
  for (const [name, { config, block: makeBlock, meta }] of Object.entries(CASES)) {
    it(`${name}: after a fetch, a resolve finds it all and says the same`, async () => {
      const { entityStore, website } = makeHarness({ answer: answers, config })

      // the control: nothing is cached, so the render cannot answer this block yet
      expect(entityStore.resolve(makeBlock(website), meta).status).toBe('pending')

      const fetched = await entityStore.fetch(makeBlock(website), meta)
      expect(fetched.errors).toBeNull()
      expect(Object.keys(fetched.data).length).toBeGreaterThan(0)

      const resolved = entityStore.resolve(makeBlock(website), meta)
      expect(resolved.status).toBe('ready')
      expect(resolved.data).toEqual(fetched.data)
    })
  }

  it('a block whose component declares nothing asks for nothing, on both drivers', async () => {
    const { entityStore, website, asked } = makeHarness({
      answer: answers,
      config: { queries: { posts: { schema: '@/post' } } },
    })
    const declaresNothing = { data: {} }
    const target = () => block({ page: page({ route: '/posts', fetch: LIST }) }, website)

    expect(entityStore.resolve(target(), declaresNothing)).toEqual({ status: 'none', data: null })
    expect(await entityStore.fetch(target(), declaresNothing)).toEqual({ data: null, errors: null })
    expect(asked).not.toHaveBeenCalled()
  })

  it('⛔ a failed request is the one thing the drivers cannot share: the cache holds answers only', async () => {
    const { entityStore, website } = makeHarness({
      answer: () => ({ data: [], error: 'HTTP 502' }),
      config: { queries: { posts: { schema: '@/post' } } },
    })
    const target = () => block({ page: page({ route: '/posts', fetch: LIST }) }, website)

    const fetched = await entityStore.fetch(target(), declaring('posts'))
    expect(fetched.errors).toEqual({ posts: 'HTTP 502' })
    expect(fetched.data.posts).toBeUndefined() // absent, never `[]`
    // nothing was cached, so the render still has nothing to read — and says so
    expect(entityStore.resolve(target(), declaring('posts')).status).toBe('pending')
  })
})
