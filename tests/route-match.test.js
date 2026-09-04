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
  decodeRouteValue,
  fillRoutePattern,
  splitPathCapture,
  joinPathCapture,
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

  // A path segment is attacker-controlled, and this runs inside the request
  // path on hosts that resolve routes server-side — so an unguarded decode is
  // a visitor-triggerable 500 on any site with a dynamic route. Keeping the raw
  // capture rather than returning null is deliberate: a malformed escape must
  // not turn into a 404 on a page that exists.
  it('does not throw on a malformed escape — keeps the raw capture', () => {
    expect(matchDynamicRoute('/blog/:slug', '/blog/%zz')).toEqual({
      params: { slug: '%zz' },
    })
    expect(matchDynamicRoute('/blog/:slug', '/blog/100%-guide')).toEqual({
      params: { slug: '100%-guide' },
    })
  })

  it('decodes what it can even when another param is malformed', () => {
    expect(matchDynamicRoute('/:a/:b', '/caf%C3%A9/%zz')).toEqual({
      params: { a: 'café', b: '%zz' },
    })
  })

  it('matches a literal suffix in the same segment', () => {
    expect(matchDynamicRoute('/files/:name.json', '/files/data.json')).toEqual({
      params: { name: 'data' },
    })
  })
})

describe('matchDynamicRoute — what the syntax deliberately is NOT', () => {
  it('a bare `*` is not a catch-all — it is the literal it always was', () => {
    expect(matchDynamicRoute('/docs/*', '/docs/a/b')).toBeNull()
    // `*` is escaped to a literal asterisk, not treated as a wildcard.
    expect(matchDynamicRoute('/docs/*', '/docs/*')).toEqual({ params: {} })
  })

  it('`:name*` anywhere but the final segment is literal too', () => {
    expect(matchDynamicRoute('/:path*/tail', '/a/b/tail')).toBeNull()
    expect(matchDynamicRoute('/:path*/tail', '/x*/tail')).toEqual({ params: { path: 'x' } })
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

describe('decodeRouteValue', () => {
  it('decodes a well-formed escape', () => {
    expect(decodeRouteValue('caf%C3%A9')).toBe('café')
    expect(decodeRouteValue('/Sites-Web/Th%C3%A8me')).toBe('/Sites-Web/Thème')
  })

  it('returns the input for a malformed escape instead of throwing', () => {
    expect(decodeRouteValue('%zz')).toBe('%zz')
    expect(decodeRouteValue('/100%-Guide')).toBe('/100%-Guide')
    expect(decodeRouteValue('%')).toBe('%')
  })

  it('passes through anything without a percent, including non-strings', () => {
    expect(decodeRouteValue('/about')).toBe('/about')
    expect(decodeRouteValue(undefined)).toBeUndefined()
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

describe('fillRoutePattern — the one encoder for a record\'s href', () => {
  it('fills each param from the record, percent-encoding the value', () => {
    expect(fillRoutePattern('/blog/:slug', { slug: 'a-post' })).toBe('/blog/a-post')
    expect(fillRoutePattern('/blog/:slug', { slug: 'b post' })).toBe('/blog/b%20post')
    expect(fillRoutePattern('/:year/:slug', { year: 2026, slug: 'x' })).toBe('/2026/x')
  })

  // A `/` in a value is the destructive case: raw, it makes a different route.
  it('encodes a slash, so a value never becomes an extra segment', () => {
    expect(fillRoutePattern('/team/:slug', { slug: 'members/ada' })).toBe('/team/members%2Fada')
  })

  it('reads a hyphenated param name — the same name class the matcher accepts', () => {
    expect(fillRoutePattern('/blog/:post-id', { 'post-id': 'abc' })).toBe('/blog/abc')
  })

  it('keeps a literal suffix in the same segment', () => {
    expect(fillRoutePattern('/files/:name.json', { name: 'data' })).toBe('/files/data.json')
  })

  it('returns null — never a partial href — when a param has no value', () => {
    expect(fillRoutePattern('/blog/:slug', { title: 'no slug' })).toBeNull()
    expect(fillRoutePattern('/blog/:slug', { slug: '' })).toBeNull()
    expect(fillRoutePattern('/blog/:slug', { slug: null })).toBeNull()
  })

  it('returns null on bad input rather than throwing', () => {
    expect(fillRoutePattern(undefined, { slug: 'x' })).toBeNull()
    expect(fillRoutePattern('/blog/:slug', null)).toBeNull()
  })

  it('round-trips through the matcher — what it emits, matchDynamicRoute captures back', () => {
    const href = fillRoutePattern('/team/:slug', { slug: 'Ada Lovelace' })
    expect(matchDynamicRoute('/team/:slug', href)).toEqual({ params: { slug: 'Ada Lovelace' } })
  })
})

describe('`:name*` — the ONE multi-segment construct (the [...path] route folder)', () => {
  // Admitted 2026-09-04 by ruling; announced to the consumer that imports this
  // leaf before it landed. Final segment only; the build emits `:path*` and no
  // other name.
  it('captures one or more segments, slashes intact', () => {
    expect(matchDynamicRoute('/blog/:path*', '/blog/my-post')).toEqual({ params: { path: 'my-post' } })
    expect(matchDynamicRoute('/blog/:path*', '/blog/rust/2025/my-post')).toEqual({ params: { path: 'rust/2025/my-post' } })
  })

  it('captures nothing empty — the bare parent is not a match, nor is an empty segment', () => {
    expect(matchDynamicRoute('/blog/:path*', '/blog')).toBeNull()
    expect(matchDynamicRoute('/blog/:path*', '/blog/')).toBeNull()
    expect(matchDynamicRoute('/blog/:path*', '/blog/a//b')).toBeNull()
  })

  it('decodes PER SEGMENT — an encoded slash inside a segment stays a value', () => {
    expect(matchDynamicRoute('/team/:path*', '/team/research/members%2Fada')).toEqual({
      params: { path: 'research/members/ada' },
    })
    expect(matchDynamicRoute('/team/:path*', '/team/caf%C3%A9/a%20b')).toEqual({ params: { path: 'café/a b' } })
  })

  it('composes with ordinary params before it', () => {
    expect(matchDynamicRoute('/:lang/docs/:path*', '/en/docs/a/b')).toEqual({ params: { lang: 'en', path: 'a/b' } })
  })

  it('routePatternToRegex names the catch-all and lists it among the params', () => {
    const { paramNames, catchAll, regex } = routePatternToRegex('/blog/:path*')
    expect(paramNames).toEqual(['path'])
    expect(catchAll).toBe('path')
    expect(regex.test('/blog/a/b')).toBe(true)
    expect(routePatternToRegex('/blog/:slug').catchAll).toBeNull()
  })

  it('CONTROL — every pattern without the construct compiles to exactly the regex it did before', () => {
    expect(routePatternToRegex('/blog/:slug').regex.source).toBe('^\\/blog\\/([^/]+)$')
    expect(routePatternToRegex('/files/:name.json').regex.source).toBe('^\\/files\\/([^/]+)\\.json$')
    expect(routePatternToRegex('/docs/*').regex.source).toBe('^\\/docs\\/\\*$')
  })

  it('isDynamicRoute is unchanged by it', () => {
    expect(isDynamicRoute('/blog/:path*')).toBe(true)
  })
})

describe('splitPathCapture — the split rule', () => {
  it('yields the whole capture, the leading directory and the last segment', () => {
    expect(splitPathCapture('rust/2025/my-post')).toEqual({ path: 'rust/2025/my-post', dir: 'rust/2025', slug: 'my-post' })
  })

  it('a single segment has an empty dir, so `:slug` means the same in both route kinds', () => {
    expect(splitPathCapture('my-post')).toEqual({ path: 'my-post', dir: '', slug: 'my-post' })
  })

  it('tolerates stray slashes and non-strings', () => {
    expect(splitPathCapture('/a/b/')).toEqual({ path: 'a/b', dir: 'a', slug: 'b' })
    expect(splitPathCapture(undefined)).toEqual({ path: '', dir: '', slug: '' })
  })
})

describe('joinPathCapture — the split rule in reverse', () => {
  it('composes a record\'s path from its placement and its handle', () => {
    expect(joinPathCapture({ dir: 'rust/2025', slug: 'my-post' })).toBe('rust/2025/my-post')
    expect(joinPathCapture({ dir: '', slug: 'my-post' })).toBe('my-post')
    expect(joinPathCapture({ slug: 'my-post' })).toBe('my-post')
  })

  it('is null with no handle — no partial path', () => {
    expect(joinPathCapture({ dir: 'a' })).toBeNull()
    expect(joinPathCapture({})).toBeNull()
  })

  it('round-trips through the split', () => {
    const parts = splitPathCapture('a/b/c')
    expect(joinPathCapture(parts)).toBe('a/b/c')
  })
})

describe('fillRoutePattern — a catch-all is filled from placement + handle, each segment encoded', () => {
  it('fills `:path*` from `path` (the placement dir) and `slug`', () => {
    expect(fillRoutePattern('/blog/:path*', { path: 'rust/2025', slug: 'my post' })).toBe('/blog/rust/2025/my%20post')
    expect(fillRoutePattern('/blog/:path*', { path: '', slug: 'my-post' })).toBe('/blog/my-post')
    expect(fillRoutePattern('/blog/:path*', { dir: 'a', slug: 'b' })).toBe('/blog/a/b')
  })

  it('a slash inside a SEGMENT is encoded, the slashes between segments are structure', () => {
    expect(fillRoutePattern('/team/:path*', { path: 'research', slug: 'members/ada' })).toBe('/team/research/members%2Fada')
  })

  it('returns null without a handle', () => {
    expect(fillRoutePattern('/blog/:path*', { path: 'a' })).toBeNull()
  })

  it('round-trips through the matcher', () => {
    const href = fillRoutePattern('/blog/:path*', { path: 'rust/2025', slug: 'my post' })
    expect(matchDynamicRoute('/blog/:path*', href)).toEqual({ params: { path: 'rust/2025/my post' } })
  })
})
