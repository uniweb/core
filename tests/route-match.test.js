/**
 * The dynamic-route matcher — a cross-boundary contract.
 *
 * This rule is implemented once and imported by everything that needs it: the
 * Website graph in the browser, the SSR renderer's 404 lane, and any host that
 * resolves a path to a page server-side. It was previously implemented twice
 * inside this repo with two different param-name patterns, which agreed on
 * every route anyone had tried and would have disagreed on `/blog/:post-id`.
 *
 * So these tests pin the *syntax*, not just the happy path: what a param may
 * match, what the language deliberately does not support, and the normalization
 * a caller can rely on. A host matching identically depends on all of it.
 */

import {
  matchDynamicRoute,
  routePatternToRegex,
  normalizeRoute,
  isDynamicRoute,
  stripLocalePrefix,
} from '../src/route-match.js'

describe('matchDynamicRoute — what a param matches', () => {
  it('captures one segment by name', () => {
    expect(matchDynamicRoute('/blog/:slug', '/blog/my-post')).toEqual({
      params: { slug: 'my-post' },
    })
  })

  it('captures several params in one pattern', () => {
    expect(matchDynamicRoute('/:year/:month/:slug', '/2026/08/hello')).toEqual({
      params: { year: '2026', month: '08', slug: 'hello' },
    })
  })

  // The divergence that motivated the shared module: core matched the name with
  // `\w+`, so it consumed only `post` and left `-id` as a literal.
  it('accepts a hyphen in the param name', () => {
    expect(matchDynamicRoute('/blog/:post-id', '/blog/abc')).toEqual({
      params: { 'post-id': 'abc' },
    })
  })

  it('a param is exactly one segment — it cannot span a slash', () => {
    expect(matchDynamicRoute('/blog/:slug', '/blog/a/b')).toBeNull()
  })

  it('a param is non-empty', () => {
    expect(matchDynamicRoute('/blog/:slug', '/blog/')).toBeNull()
    expect(matchDynamicRoute('/blog/:slug', '/blog')).toBeNull()
  })

  it('decodes percent-encoding in the captured value', () => {
    expect(matchDynamicRoute('/blog/:slug', '/blog/caf%C3%A9')).toEqual({
      params: { slug: 'café' },
    })
  })

  it('matches a literal suffix in the same segment', () => {
    expect(matchDynamicRoute('/files/:name.json', '/files/data.json')).toEqual({
      params: { name: 'data' },
    })
  })
})

describe('matchDynamicRoute — what the syntax deliberately is NOT', () => {
  it('has no catch-all', () => {
    expect(matchDynamicRoute('/docs/*', '/docs/a/b')).toBeNull()
    // `*` is escaped to a literal asterisk, not treated as a wildcard.
    expect(matchDynamicRoute('/docs/*', '/docs/*')).toEqual({ params: {} })
  })

  it('has no optional segments', () => {
    expect(matchDynamicRoute('/blog/:slug?', '/blog')).toBeNull()
  })

  it('treats regex metacharacters as literals', () => {
    // A `.` matches a dot and nothing else.
    expect(matchDynamicRoute('/a.b', '/axb')).toBeNull()
    expect(matchDynamicRoute('/a.b', '/a.b')).toEqual({ params: {} })
  })

  it('is case-sensitive', () => {
    expect(matchDynamicRoute('/Blog/:slug', '/blog/x')).toBeNull()
  })

  it('is anchored at both ends', () => {
    expect(matchDynamicRoute('/blog/:slug', '/prefix/blog/x')).toBeNull()
    expect(matchDynamicRoute('/blog/:slug', '/blog/x/suffix')).toBeNull()
  })
})

describe('normalizeRoute', () => {
  it('collapses a trailing slash but keeps the root', () => {
    expect(normalizeRoute('/about/')).toBe('/about')
    expect(normalizeRoute('/about')).toBe('/about')
    expect(normalizeRoute('/')).toBe('/')
    expect(normalizeRoute('')).toBe('/')
  })

  it('is applied to the path before matching', () => {
    expect(matchDynamicRoute('/blog/:slug', '/blog/x/')).toEqual({
      params: { slug: 'x' },
    })
  })
})

describe('isDynamicRoute', () => {
  it('is true only for a pattern carrying a param', () => {
    expect(isDynamicRoute('/blog/:id')).toBe(true)
    expect(isDynamicRoute('/blog')).toBe(false)
    expect(isDynamicRoute(undefined)).toBe(false)
  })
})

describe('routePatternToRegex', () => {
  it('exposes the compiled regex and its param names', () => {
    const { regex, paramNames } = routePatternToRegex('/blog/:year/:slug')
    expect(paramNames).toEqual(['year', 'slug'])
    expect(regex.test('/blog/2026/hello')).toBe(true)
    expect(regex.test('/blog/2026')).toBe(false)
  })

  it('compiles once and is reusable across paths', () => {
    const { regex } = routePatternToRegex('/blog/:id')
    // A `g`-flagged regex would carry lastIndex between calls and alternate.
    expect([regex.test('/blog/a'), regex.test('/blog/b'), regex.test('/blog/c')]).toEqual([
      true,
      true,
      true,
    ])
  })
})

describe('stripLocalePrefix', () => {
  it('strips a non-default locale prefix', () => {
    expect(stripLocalePrefix('/fr/about', 'fr', 'en')).toBe('/about')
  })

  it('maps the locale root to the site root', () => {
    expect(stripLocalePrefix('/fr', 'fr', 'en')).toBe('/')
    expect(stripLocalePrefix('/fr/', 'fr', 'en')).toBe('/')
  })

  it('leaves the default locale untouched — it carries no prefix', () => {
    expect(stripLocalePrefix('/en/about', 'en', 'en')).toBe('/en/about')
    expect(stripLocalePrefix('/about', 'en', 'en')).toBe('/about')
  })

  it('does not strip a path that merely starts with the same letters', () => {
    expect(stripLocalePrefix('/french-press', 'fr', 'en')).toBe('/french-press')
  })
})
