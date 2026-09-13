/**
 * A parametric page's record request — a cross-boundary contract.
 *
 * A host that renders a detail page server-side must fetch the same record the
 * browser fetches when it hydrates over that render, so the request is built by
 * one function every lane imports (`buildDetailConfig`). These tests pin its three
 * sources — the records service (in `records-service-client.test.js`), an external
 * query's `record:`, and a `deferred:` query's per-record file — and that nothing
 * else builds one.
 *
 * ⛔ The authored `detail:` forms — `rest`, `query`, a URL pattern, `{ body, envelope }`
 * — were retired on 2026-09-13 with inline `url:` fetches: an external query's
 * `record:` says the same thing, on the query [Diego].
 */

import { describe, it, expect } from 'vitest'
import { buildDetailConfig } from '../src/detail-url.js'
import { resolveFetchConfigs } from '../src/fetch-config.js'

const ctx = { paramName: 'slug', paramValue: 'my-post' }

/** An external query's resolved binding, as `resolveFetchConfigs` makes it. */
const external = (decl, binding = {}) =>
  resolveFetchConfigs([{ query: 'items', as: 'items', ...binding }], { queries: { items: decl } }).get('items')

describe('an external query\'s `record:` — its own request', () => {
  it('its url, with the route\'s value substituted', () => {
    const cfg = external({ url: 'https://api.test/items', transform: 'results', record: { url: 'https://api.test/items/{slug}' } })
    expect(buildDetailConfig(cfg, ctx)).toMatchObject({ url: 'https://api.test/items/my-post', as: 'items', whole: true })
  })

  it('⛔ the list\'s `transform` never carries over — a record response is rarely wrapped like the list', () => {
    const cfg = external({ url: 'https://api.test/items', transform: 'results', record: { url: 'https://api.test/items/{slug}' } })
    expect(buildDetailConfig(cfg, ctx).transform).toBeUndefined()
    const wrapped = external({ url: 'https://api.test/items', transform: 'results', record: { url: 'https://api.test/items/{slug}', transform: 'data' } })
    expect(buildDetailConfig(wrapped, ctx).transform).toBe('data')
  })

  it('url and method default to the query\'s; ⛔ body never carries over', () => {
    const cfg = external({
      url: 'https://api.test/graphql',
      method: 'POST',
      body: { query: '{ items { id } }' },
      transform: 'data.items',
      record: { body: { query: 'query Item($slug: String!) { item(slug: $slug) { id } }', variables: { slug: '{slug}' } }, transform: 'data.item' },
    })
    expect(buildDetailConfig(cfg, ctx)).toMatchObject({
      url: 'https://api.test/graphql',
      method: 'POST',
      body: { query: 'query Item($slug: String!) { item(slug: $slug) { id } }', variables: { slug: 'my-post' } },
      transform: 'data.item',
    })
    const noBody = external({ url: 'https://api.test/g', method: 'POST', body: { q: 'list' }, record: { url: 'https://api.test/g/{slug}' } })
    expect(buildDetailConfig(noBody, ctx).body).toBeUndefined()
  })

  it('the value is encoded in a url, so a slug may carry reserved characters', () => {
    const cfg = external({ url: 'https://api.test/a', record: { url: 'https://api.test/a/{slug}' } })
    expect(buildDetailConfig(cfg, { paramName: 'slug', paramValue: 'a b/c' }).url).toBe('https://api.test/a/a%20b%2Fc')
  })

  it('the route\'s own param and the host\'s `{param}` alias resolve too', () => {
    const cfg = external({ url: 'https://api.test/a', record: { url: 'https://api.test/a/{id}?alias={param}' } })
    expect(buildDetailConfig(cfg, { paramName: 'id', paramValue: '42' }).url).toBe('https://api.test/a/42?alias=42')
  })

  it('carries the query, the locale, whole, and the route context beside its address', () => {
    const cfg = { ...external({ url: 'https://api.test/a', record: { url: 'https://api.test/a/{slug}' } }), locale: 'fr' }
    expect(buildDetailConfig(cfg, ctx)).toEqual({
      url: 'https://api.test/a/my-post',
      as: 'items',
      query: 'items',
      locale: 'fr',
      whole: true,
      dynamicContext: { paramName: 'slug', paramValue: 'my-post' },
    })
  })

  it('CONTROL — an external query with no `record:` has no separate request: its record is found in the list', () => {
    const cfg = external({ url: 'https://api.test/a' })
    expect(cfg.detail).toBeUndefined()
    expect(buildDetailConfig(cfg, ctx)).toBeNull()
  })
})

describe('⛔ the retired `detail:` forms build nothing', () => {
  it('rest, query, a pattern and the object form, on a url', () => {
    for (const detail of ['rest', 'query', 'https://api.test/a/{slug}', { body: { s: '{slug}' }, envelope: { item: 'd' } }]) {
      expect(buildDetailConfig({ url: 'https://api.test/a', as: 'a', detail }, ctx)).toBeNull()
    }
  })
})

describe('a `deferred:` query\'s per-record file', () => {
  const deferred = { path: '/data/articles.json', as: 'articles', detail: '/data/articles/{slug}.json' }

  it('a path yields a path, not a url', () => {
    const out = buildDetailConfig(deferred, ctx)
    expect(out).toMatchObject({ path: '/data/articles/my-post.json', as: 'articles', whole: true })
    expect(out.url).toBeUndefined()
  })

  // The file lane keys per-record files by `item.slug` and injects
  // `/data/<name>/{slug}.json`. A site routing `[id]` used to leave `{slug}`
  // literal — `/data/articles/{slug}.json`, a guaranteed 404 on every template
  // page with `deferred:` fields.
  it('fills {slug} from the record the caller holds when the route param is something else', () => {
    const out = buildDetailConfig(deferred, { paramName: 'id', paramValue: '42', record: { id: 42, slug: 'design-tips' } })
    expect(out.path).toBe('/data/articles/design-tips.json')
  })

  it('leaves {slug} literal with no record in hand — an unresolved address, not a guessed one', () => {
    expect(buildDetailConfig(deferred, { paramName: 'id', paramValue: '42' }).path).toBe('/data/articles/{slug}.json')
  })

  it('CONTROL — on a [slug] route the capture is the slug, record or not', () => {
    const withRecord = buildDetailConfig(deferred, { paramName: 'slug', paramValue: 'design-tips', record: { slug: 'design-tips' } })
    const without = buildDetailConfig(deferred, { paramName: 'slug', paramValue: 'design-tips' })
    expect(withRecord.path).toBe('/data/articles/design-tips.json')
    expect(without.path).toBe(withRecord.path)
  })

  it('a record with no slug adds nothing', () => {
    expect(buildDetailConfig(deferred, { paramName: 'id', paramValue: '42', record: { id: 42 } }).path).toBe('/data/articles/{slug}.json')
  })

  it('omits query and locale when the list had none', () => {
    const out = buildDetailConfig(deferred, ctx)
    expect('query' in out).toBe(false)
    expect('locale' in out).toBe(false)
  })
})

describe('returns null rather than throwing — the common case is "find the record in the list"', () => {
  it('no per-record source', () => {
    expect(buildDetailConfig({ path: '/data/a.json', as: 'a' }, ctx)).toBeNull()
  })

  it('no param in the dynamic context', () => {
    expect(buildDetailConfig({ path: '/data/a.json', detail: '/data/a/{slug}.json' }, {})).toBeNull()
    expect(buildDetailConfig({ path: '/data/a.json', detail: '/data/a/{slug}.json' }, { paramName: 'slug' })).toBeNull()
  })
})
