/**
 * ⭐ WHAT A SECTION RECEIVES, AND FROM WHICH FETCH, READ OFF THE GRAPH — `blockFillsOf`, the reading
 * the entity store fills a section by, exported so a caller reporting what a section received (a
 * page's Markdown, `@uniweb/runtime`'s `section-records.js`) asks the same one and can name the fetch
 * that filled each key. The rule itself (`fillDeclaredKeys`, `blockFills`) is tested on its own; this
 * holds the reading and what it hands back.
 */
import { describe, it, expect } from 'vitest'
import { blockFillsOf, blockRouteQuery } from '../src/page-data.js'
import EntityStore from '../src/entity-store.js'

const site = (config = {}) => ({ config, getActiveLocale: () => 'en', getDefaultLocale: () => 'en' })
const pageOf = (overrides = {}) => ({ route: '/news', fetch: null, parent: null, dynamicContext: null, ...overrides })
const blockOf = (overrides = {}) => ({ fetch: null, dynamicContext: null, heldData: {}, page: pageOf(), website: site(), ...overrides })

describe('blockFillsOf', () => {
  it('⭐ a key the component declares under another name is filled by its schema, and the fill names the fetch by its `as`', () => {
    const website = site({ queries: { members: { schema: '@/member' } } })
    const block = blockOf({ website, fetch: { query: 'members', as: 'members' } })
    const fills = blockFillsOf(block, { data: { team: '@/member' } })
    expect([...fills.keys()]).toEqual(['team'])
    expect(fills.get('team').cfg.as).toBe('members')
  })

  it('reads every level that reaches the block: its own, its page\'s, its parent page\'s, the site\'s', () => {
    const website = site({ fetch: { query: 'teams', as: 'teams' } })
    const block = blockOf({
      website,
      fetch: { query: 'posts', as: 'posts' },
      page: pageOf({ fetch: { query: 'news', as: 'news' }, parent: { route: '/', fetch: { query: 'people', as: 'people' } } }),
    })
    const fills = blockFillsOf(block, { data: { posts: null, news: null, people: null, teams: null } })
    // The site's binding reaches a top-level page's sections only, and this page has a parent page.
    expect([...fills.keys()]).toEqual(['posts', 'news', 'people'])
  })

  it('a key the section holds — a tagged data block, or its own fetch\'s prerendered answer — is no fetch\'s to fill', () => {
    const block = blockOf({ fetch: { query: 'posts', as: 'posts' }, heldData: { posts: [{ $name: 'authored' }] } })
    expect(blockFillsOf(block, { data: { posts: null } }).size).toBe(0)
  })

  it('off a parametric page there is no route query; on one, the page\'s parent declares it', () => {
    expect(blockRouteQuery(blockOf())).toBe(null)
    const parent = { route: '/posts', fetch: { query: 'posts', as: 'posts' } }
    const page = pageOf({ route: '/posts/:slug', parent, dynamicContext: { paramName: 'slug', paramValue: 'a' } })
    expect(blockRouteQuery(blockOf({ page }))?.key).toBe('posts')
  })

  it('CONTROL — the store fills by this reading: what `resolve` delivers are the keys it names', () => {
    const website = site({ queries: { members: { schema: '@/member' } } })
    const answers = new Map()
    website.fetcher = { peek: (request) => answers.get(request.as) ?? null }
    website.entityStore = new EntityStore({ website })
    const block = blockOf({ website, fetch: { query: 'members', as: 'members', path: '/data/members.json' } })
    const meta = { data: { team: '@/member' } }
    answers.set('members', { data: [{ $name: 'ada' }] })
    const resolved = website.entityStore.resolve(block, meta)
    expect(resolved.status).toBe('ready')
    expect(Object.keys(resolved.data)).toEqual([...blockFillsOf(block, meta).keys()])
  })
})

describe('heldPageRecord — a parametric page\'s own record, read back from what is held', () => {
  const posts = [{ $name: 'a', title: 'A' }, { $name: 'b', title: 'B' }]
  const parent = { route: '/posts', fetch: { query: 'posts', as: 'posts', path: '/data/posts.json' } }
  const pageFor = (slug) => pageOf({ route: `/posts/${slug}`, parent, dynamicContext: { templateRoute: '/posts/:slug', paramName: 'slug', paramValue: slug, params: { slug, path: slug, dir: '' } } })
  // The cache holds the query's set, by the address its question names.
  const peekSet = (request) => (request?.path === '/data/posts.json' ? { data: posts } : null)

  it('⭐ the record the page is about, found by the question its data step asked', async () => {
    const { heldPageRecord } = await import('../src/page-data.js')
    expect(heldPageRecord(pageFor('b'), { website: site(), peek: peekSet })).toEqual(posts[1])
  })

  it('null when what is held says the route names no record; undefined when nothing held answers', async () => {
    const { heldPageRecord } = await import('../src/page-data.js')
    expect(heldPageRecord(pageFor('zz'), { website: site(), peek: peekSet })).toBe(null)
    expect(heldPageRecord(pageFor('a'), { website: site(), peek: () => null })).toBe(undefined)
  })

  it('undefined off a parametric page', async () => {
    const { heldPageRecord } = await import('../src/page-data.js')
    expect(heldPageRecord(pageOf(), { website: site(), peek: peekSet })).toBe(undefined)
  })
})
