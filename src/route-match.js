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
 * That is already bad inside one repo. It is worse across them: a host that
 * renders a page server-side has to decide *which* page a path names, and the
 * runtime then hydrates over that decision in the browser. If the two matchers
 * disagree by a single route, the server renders page A and hydration replaces
 * it with page B — silently, and only on the paths that have a pattern, which
 * are exactly the interesting ones. So this is a cross-boundary contract, not
 * an implementation detail, and it is exported rather than merely shared.
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
 * Match a concrete path against a route pattern.
 *
 * ```js
 * matchDynamicRoute('/blog/:slug', '/blog/my-post')  // → { params: { slug: 'my-post' } }
 * matchDynamicRoute('/blog/:slug', '/blog/a/b')      // → null  (a param is one segment)
 * matchDynamicRoute('/blog/:slug', '/blog/')         // → null  (a param is non-empty)
 * ```
 *
 * Captured values are `decodeURIComponent`-ed, so a path carries percent
 * encoding and the param does not.
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
    params[name] = decodeURIComponent(match[i + 1])
  })
  return { params }
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
