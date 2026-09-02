/**
 * `detail:` resolution — a cross-boundary contract.
 *
 * A host that renders a detail page server-side must fetch the same record the
 * browser fetches when it hydrates over that render. The four forms below each
 * decide a different URL, so a host resolving them differently prerenders
 * record A and hydrates record B — silently, and only on the routes that have a
 * pattern. Extracted from `EntityStore#_buildDetailConfig` (which now delegates)
 * so the rule is imported rather than transcribed, the same move
 * `./route-match.js` made for routing.
 *
 * These tests pin the *four forms*, not just the happy path, because a
 * consumer matching identically depends on all of them.
 */

import { describe, it, expect } from 'vitest'
import { buildDetailConfig } from '../src/detail-url.js'

const ctx = { paramName: 'slug', paramValue: 'my-post' }

describe('the four detail: forms', () => {
  it("'rest' appends the value as a path segment", () => {
    expect(buildDetailConfig({ url: 'https://api.test/articles', detail: 'rest' }, ctx))
      .toMatchObject({ url: 'https://api.test/articles/my-post' })
  })

  // ⭐ DELIBERATE, and the example is the reason: a locale (or an API key, or a
  // tenancy id) is exactly what a single-record read still needs. Dropping the
  // query would 401 the detail request or return the wrong language.
  // ⚠️ The cost lands on projection params — `?fields=summary` carried onto a
  // detail request truncates the record it exists to fetch in full. Framework
  // cannot tell the categories apart, so the custom-pattern form is the way out.
  // Do not "fix" this by dropping the query; see src/detail-url.js.
  it("'rest' keeps an existing query string after the appended segment", () => {
    expect(buildDetailConfig({ url: 'https://api.test/articles?lang=en', detail: 'rest' }, ctx))
      .toMatchObject({ url: 'https://api.test/articles/my-post?lang=en' })
  })

  it("'query' appends paramName=paramValue, picking the right separator", () => {
    expect(buildDetailConfig({ url: 'https://api.test/a', detail: 'query' }, ctx))
      .toMatchObject({ url: 'https://api.test/a?slug=my-post' })
    expect(buildDetailConfig({ url: 'https://api.test/a?x=1', detail: 'query' }, ctx))
      .toMatchObject({ url: 'https://api.test/a?x=1&slug=my-post' })
  })

  it('a custom pattern substitutes {paramName}', () => {
    expect(buildDetailConfig({ url: 'https://api.test/x', detail: '/articles/{slug}' }, ctx))
      .toMatchObject({ url: '/articles/my-post' })
  })

  it('a custom pattern leaves an unmatched placeholder literal', () => {
    expect(buildDetailConfig({ url: 'https://api.test/x', detail: '/a/{slug}/{other}' }, ctx))
      .toMatchObject({ url: '/a/my-post/{other}' })
  })

  it('the object form reuses the collection URL and substitutes into the body', () => {
    const cfg = {
      url: 'https://api.test/graphql',
      method: 'POST',
      as: 'articles',
      detail: { body: { variables: { slug: '{slug}' } }, envelope: { item: 'data.article' } },
    }
    expect(buildDetailConfig(cfg, ctx)).toMatchObject({
      url: 'https://api.test/graphql',
      method: 'POST',
      body: { variables: { slug: 'my-post' } },
      envelope: { item: 'data.article' },
    })
  })

  it('the object form falls back to the collection body when detail declares none', () => {
    const cfg = { url: 'https://api.test/g', body: { q: '{slug}' }, detail: { envelope: { item: 'd' } } }
    expect(buildDetailConfig(cfg, ctx)).toMatchObject({ body: { q: 'my-post' } })
  })
})

describe('local path vs remote url', () => {
  it('a path-based collection yields path, not url', () => {
    const out = buildDetailConfig({ path: '/data/articles', detail: '/data/articles/{slug}.json' }, ctx)
    expect(out).toMatchObject({ path: '/data/articles/my-post.json' })
    expect(out.url).toBeUndefined()
  })

  it('a url-based collection yields url, not path', () => {
    const out = buildDetailConfig({ url: 'https://api.test/a', detail: 'rest' }, ctx)
    expect(out.path).toBeUndefined()
  })
})

describe('the value is encoded, so a slug may carry reserved characters', () => {
  it("encodes in 'rest' and 'query'", () => {
    const odd = { paramName: 'slug', paramValue: 'a b/c' }
    expect(buildDetailConfig({ url: 'https://api.test/a', detail: 'rest' }, odd).url)
      .toBe('https://api.test/a/a%20b%2Fc')
    expect(buildDetailConfig({ url: 'https://api.test/a', detail: 'query' }, odd).url)
      .toBe('https://api.test/a?slug=a%20b%2Fc')
  })
})

describe('returns null rather than throwing — the common case is "no detail fetch"', () => {
  it('no detail: declared', () => {
    expect(buildDetailConfig({ url: 'https://api.test/a' }, ctx)).toBeNull()
  })

  it('no param in the dynamic context', () => {
    expect(buildDetailConfig({ url: 'https://api.test/a', detail: 'rest' }, {})).toBeNull()
    expect(buildDetailConfig({ url: 'https://api.test/a', detail: 'rest' }, { paramName: 'slug' })).toBeNull()
  })

  it('neither url: nor path: to build from', () => {
    expect(buildDetailConfig({ detail: 'rest' }, ctx)).toBeNull()
  })
})

describe('the leaf property consumers rely on', () => {
  it('carries schema and transform through so the fetch lands on the right key', () => {
    const out = buildDetailConfig(
      { url: 'https://api.test/a', detail: 'rest', as: 'articles', transform: 'unwrap' },
      ctx,
    )
    expect(out).toMatchObject({ as: 'articles', transform: 'unwrap' })
  })
})

describe('the generic {param} alias', () => {
  const ctx = { paramName: 'slug', paramValue: 'my-post' }

  // An AUTHOR knows their route and writes {slug} or {id}. A HOST publishing one
  // record pattern for every site it serves cannot know the site's param_name,
  // so it writes {param}. Binding both names to one value lets the two
  // conventions coexist without a translation step between them — and a
  // translation step is where this codebase has twice grown a second copy of a
  // rule that then drifted.
  it('resolves a host-written {param}', () => {
    const out = buildDetailConfig({ endpoint: '/_d/articles', detail: '/_d/articles/{param}' }, ctx)
    expect(out.endpoint).toBe('/_d/articles/my-post')
  })

  it('still resolves an author-written {paramName} — the convention is unchanged', () => {
    const out = buildDetailConfig({ path: '/data/a.json', detail: '/data/a/{slug}.json' }, ctx)
    expect(out.path).toBe('/data/a/my-post.json')
  })

  it('resolves {param} whatever the route calls its param', () => {
    const out = buildDetailConfig(
      { endpoint: '/_d/x', detail: '/_d/x/{param}' },
      { paramName: 'id', paramValue: '42' }
    )
    expect(out.endpoint).toBe('/_d/x/42')
  })

  it('leaves an unrelated placeholder literal, as it always has', () => {
    const out = buildDetailConfig({ path: '/a.json', detail: '/a/{other}/{slug}' }, ctx)
    expect(out.path).toBe('/a/{other}/my-post')
  })

  it('substitutes into an object-form body too', () => {
    const out = buildDetailConfig(
      { url: 'https://x.example/gql', detail: { body: { vars: { s: '{param}' } } } },
      ctx
    )
    expect(out.body).toEqual({ vars: { s: 'my-post' } })
  })
})

describe('the detail request keeps the collection\'s address kind', () => {
  const ctx = { paramName: 'slug', paramValue: 'p' }

  // An `endpoint` carries remote semantics the fetcher decides on. Returning a
  // detail as `path` would silently drop operator pushdown and the site's
  // static headers for exactly the request that is one record.
  it('endpoint → endpoint', () => {
    const out = buildDetailConfig({ endpoint: '/_d/a', detail: 'rest', as: 'a' }, ctx)
    expect(out).toMatchObject({ endpoint: '/_d/a/p' })
    expect(out.path).toBeUndefined()
    expect(out.url).toBeUndefined()
  })

  it('path → path, url → url', () => {
    // `rest` appends the param as a segment, so the assertion is about WHICH
    // key carries the result, not about the URL shape that form produces.
    const local = buildDetailConfig({ path: '/d/a', detail: 'rest' }, ctx)
    expect(local.path).toBe('/d/a/p')
    expect(local.endpoint).toBeUndefined()

    const remote = buildDetailConfig({ url: 'https://x.example/a', detail: 'rest' }, ctx)
    expect(remote.url).toBe('https://x.example/a/p')
    expect(remote.endpoint).toBeUndefined()
  })

  it('returns null when the collection has no address at all', () => {
    expect(buildDetailConfig({ detail: 'rest', as: 'a' }, ctx)).toBeNull()
  })
})
