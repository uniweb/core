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
      schema: 'articles',
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
      { url: 'https://api.test/a', detail: 'rest', schema: 'articles', transform: 'unwrap' },
      ctx,
    )
    expect(out).toMatchObject({ schema: 'articles', transform: 'unwrap' })
  })
})
