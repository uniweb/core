/**
 * Dynamic route patterns — the ONE home for how `/blog/:id` matches a path.
 *
 * Why this module exists. The rule was implemented twice and the two copies
 * disagreed. `Website#_matchDynamicRoute` built the pattern with `:(\w+)`;
 * `generate404Html` in `@uniweb/runtime`'s SSR renderer built it with
 * `:[^/]+` and allowed an optional trailing slash. For `:id` they agree, so
 * nothing failed — but for a param name carrying a non-word character
 * (`/blog/:post-id`) the first matched only `post` and left `-id` as a
 * literal, while the second consumed the whole name. Two answers to one
 * question, neither wrong on the routes anyone had tried.
 *
 * That is already bad inside one repo. It is worse across them, because the
 * matcher answers a question more than one lane asks: *which page does this
 * path name?* A consumer outside this repo routes with these patterns —
 * `hosting/framework-surface.json` declares `routePatternToRegex`,
 * `isDynamicRoute` and `normalizeRoute` read by its `src/routes.js`. Two copies
 * that disagree by a single route give two answers to page identity, silently,
 * and only on the paths that have a pattern — which are exactly the interesting
 * ones. So this is a cross-boundary contract, not an implementation detail, and
 * it is exported rather than merely shared.
 *
 * ⛔ This paragraph used to justify itself with a server-rendering story — "the
 * server renders page A and hydration replaces it with page B". That premise is
 * wrong (Diego, 2026-09-04: *the server does not render*) and the argument never
 * needed it: two answers to page identity are a defect wherever the second
 * answer is formed. Do not reintroduce a rendering narrative here; what this
 * module guarantees is that everyone matching a path agrees on the page.
 *
 * Zero-dependency leaf, like `./data-paths.js` and `./locale-config.js`, so a
 * consumer that must not pull core's graph — an edge worker, a build step —
 * can import the subpath `@uniweb/core/route-match` directly.
 *
 * ## The syntax, in full
 *
 * `:param` is the only construct. There are deliberately **no** catch-alls
 * (`*`), **no** optional segments (`?`), and **no** regex constraints — a
 * pattern is not a regular expression, and regex metacharacters in a route are
 * escaped to literals before any substitution happens. Matching is anchored,
 * case-sensitive, and a param captures exactly one non-empty path segment.
 *
 * ## What this module does NOT decide
 *
 * Matching a pattern means *the route exists*. It says nothing about whether
 * the record behind it exists — that is a data question the caller answers
 * later, and a matched pattern with no backing record is a rendered
 * not-found page rather than a route miss. Anything deciding a 404 purely from
 * this module can only answer the first question.
 */

/**
 * Characters allowed in a param NAME — word characters plus the hyphen, so a
 * `[post-id]` route folder round-trips.
 *
 * Deliberately not `[^/]+`: a greedy name would swallow a literal suffix in the
 * same segment, so `/files/:name.json` would capture `name.json` as the param
 * name and leave nothing to match the extension.
 */
const PARAM_NAME = '[A-Za-z0-9_-]+'

/** Regex metacharacters that must survive as literals. `-` is not one of them. */
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g

/**
 * Normalize a route for comparison: collapse a trailing slash, treat an empty
 * route as the root.
 *
 * `/about/` and `/about` are the same route; `/` stays `/`.
 *
 * @param {string} route
 * @returns {string}
 */
export function normalizeRoute(route) {
  if (typeof route !== 'string' || route === '') return '/'
  return route === '/' ? '/' : route.replace(/\/+$/, '') || '/'
}

/**
 * Whether a route is a dynamic template rather than a concrete path.
 *
 * @param {string} route
 * @returns {boolean}
 */
export function isDynamicRoute(route) {
  return typeof route === 'string' && route.includes(':')
}

/**
 * Compile a route pattern to an anchored regex plus its param names.
 *
 * Exported for callers that match one pattern against many paths and want to
 * compile once — an edge worker checking every request against a site's
 * patterns, for instance.
 *
 * @param {string} pattern - e.g. `/blog/:id`
 * @returns {{ regex: RegExp, paramNames: string[] }}
 */
export function routePatternToRegex(pattern) {
  const paramNames = []
  const source = normalizeRoute(pattern)
    // Escape first: a `.` in a route is a literal `.`, not "any character".
    .replace(REGEX_SPECIALS, '\\$&')
    // Then each `:name` becomes one non-empty segment capture.
    .replace(new RegExp(`:(${PARAM_NAME})`, 'g'), (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })

  return { regex: new RegExp(`^${source}$`), paramNames }
}

/**
 * Decode a value that arrived from a URL, falling back to the raw input.
 *
 * Guarded rather than bare, for two independent reasons:
 *
 * A `%` that is not an escape is legitimate content — `/100%-Guide` authored by
 * hand, or a value that has already been decoded once — and `decodeURIComponent`
 * throws `URIError` on those. Falling back to the input keeps such a route
 * matching exactly as well as it did before.
 *
 * And the input is attacker-controlled: `/blog/%zz` is a URL anyone can paste or
 * link. This module is called by hosts that resolve a path to a page *per
 * request*, where a throw out of the matcher is a visitor-triggerable 500 rather
 * than a client-side error. A malformed escape is not a reason to lose an
 * otherwise-good match, so the fallback is the raw capture rather than a miss —
 * a route miss would turn a typo'd escape into a 404 on a page that exists.
 *
 * @param {string} value
 * @returns {string}
 */
export function decodeRouteValue(value) {
  if (typeof value !== 'string' || !value.includes('%')) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Match a concrete path against a route pattern.
 *
 * ```js
 * matchDynamicRoute('/blog/:slug', '/blog/my-post')  // → { params: { slug: 'my-post' } }
 * matchDynamicRoute('/blog/:slug', '/blog/a/b')      // → null  (a param is one segment)
 * matchDynamicRoute('/blog/:slug', '/blog/')         // → null  (a param is non-empty)
 * ```
 *
 * Captured values are decoded, so a path carries percent encoding and the param
 * does not. A malformed escape falls back to the raw capture rather than
 * throwing — see `decodeRouteValue`. This function does not throw.
 *
 * @param {string} pattern - Route pattern with `:param` placeholders
 * @param {string} path - Concrete path to match
 * @returns {{ params: Record<string,string> } | null}
 */
export function matchDynamicRoute(pattern, path) {
  const { regex, paramNames } = routePatternToRegex(pattern)
  const match = normalizeRoute(path).match(regex)
  if (!match) return null

  const params = {}
  paramNames.forEach((name, i) => {
    params[name] = decodeRouteValue(match[i + 1])
  })
  return { params }
}

/**
 * Fill a route pattern's params from a record — the ONE encoder for a record's href.
 *
 * `/blog/:slug` + `{ slug: 'a post' }` → `/blog/a%20post`. Every value is
 * `encodeURIComponent`-ed, because the output is a URL: it is compared against
 * `location.pathname` (`isActive(item.route)`) and matched back through
 * `matchDynamicRoute`, which decodes what it captures. A raw interpolation and an
 * encoded one compare unequal on the first slug with a space — and they used to
 * both exist: the build baked `${base}/${item.slug}` raw into `/data/*.json` while
 * the runtime interpolated with encoding, and which one a site got was
 * lane-dependent (measured 2026-09-04). Two producers of one field now call this.
 *
 * ⛔ NOT for a file path. The SSG writes `dist/<route>/index.html` from the DECODED
 * value on purpose — a server decodes the request path before looking a file up,
 * so `Ada%20Lovelace` on disk would 404 for `/team/Ada%20Lovelace`. A URL and a
 * filesystem path are different jobs that are supposed to encode differently.
 *
 * Returns `null` — never a partial href — when a param has no value on the
 * record, so a caller degrades to "no link" rather than emitting a broken one.
 *
 * @param {string} pattern - a route pattern with `:param` placeholders
 * @param {Object} values - a record, read by param name
 * @returns {string|null}
 */
export function fillRoutePattern(pattern, values) {
  if (typeof pattern !== 'string' || !values || typeof values !== 'object') return null
  let missing = false
  const href = pattern.replace(new RegExp(`:(${PARAM_NAME})`, 'g'), (_, name) => {
    const value = values[name]
    if (value === undefined || value === null || value === '') {
      missing = true
      return ''
    }
    return encodeURIComponent(String(value))
  })
  return missing ? null : href
}

/**
 * Strip a locale prefix from a route.
 *
 * Pages are stored with unprefixed routes — the locale is a URL concern, not
 * part of a page's identity — so a lookup has to remove it first. The default
 * locale carries no prefix, which is why it is a no-op there.
 *
 * `/fr` and `/fr/` both mean the locale's home page.
 *
 * @param {string} route
 * @param {string|null} activeLocale
 * @param {string|null} defaultLocale
 * @returns {string}
 */
export function stripLocalePrefix(route, activeLocale, defaultLocale) {
  if (typeof route !== 'string') return '/'
  if (!activeLocale || activeLocale === defaultLocale) return route

  const prefix = `/${activeLocale}`
  if (route === prefix || route === `${prefix}/`) return '/'
  if (route.startsWith(`${prefix}/`)) return route.slice(prefix.length)
  return route
}
