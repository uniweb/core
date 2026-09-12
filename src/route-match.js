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
 * `:param` captures exactly one non-empty path segment. `:param*` — the ONE
 * multi-segment construct, admitted 2026-09-04 by ruling [Diego] for the
 * `[...path]` route folder — captures one or more segments, slashes intact, and
 * only as the FINAL segment of a pattern; anywhere else the `*` is the literal it
 * always was. There are still **no** optional segments (`?`) and **no** regex
 * constraints — a pattern is not a regular expression, and regex metacharacters in
 * a route are escaped to literals before any substitution happens. Matching is
 * anchored and case-sensitive.
 *
 * ⚖️ This module said "deliberately no catch-alls" until 2026-09-04. The reversal
 * is considered, announced to the consumer that imports this leaf before it
 * landed, and narrow: one construct, final segment only, nothing author-named —
 * the build emits `:path*` and nothing else.
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

/** The catch-all token, only as a pattern's final segment: `/:path*`. */
const CATCH_ALL = new RegExp(`/:(${PARAM_NAME})\\*$`)
/** A route whose LAST segment is a parameter — the page that addresses one record. */
const RECORD_ROUTE = new RegExp(`/:(${PARAM_NAME})\\*?$`)

/**
 * Compile a route pattern to an anchored regex plus its param names.
 *
 * Exported for callers that match one pattern against many paths and want to
 * compile once — an edge worker checking every request against a site's
 * patterns, for instance.
 *
 * `catchAll` names the `:name*` param when the pattern ends in one, else null —
 * a caller decoding captures needs to know which one may hold slashes.
 *
 * @param {string} pattern - e.g. `/blog/:id`, `/docs/:path*`
 * @returns {{ regex: RegExp, paramNames: string[], catchAll: string|null }}
 */
export function routePatternToRegex(pattern) {
  const paramNames = []
  let head = normalizeRoute(pattern)
  let catchAll = null
  const tail = head.match(CATCH_ALL)
  if (tail) {
    catchAll = tail[1]
    head = head.slice(0, tail.index)
  }
  let source = head
    // Escape first: a `.` in a route is a literal `.`, not "any character".
    .replace(REGEX_SPECIALS, '\\$&')
    // Then each `:name` becomes one non-empty segment capture.
    .replace(new RegExp(`:(${PARAM_NAME})`, 'g'), (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })
  if (catchAll) {
    paramNames.push(catchAll)
    // One or more segments; the segments are separated by literal slashes, and
    // an empty segment (`//`) is not a segment.
    source += '/([^/]+(?:/[^/]+)*)'
  }

  return { regex: new RegExp(`^${source}$`), paramNames, catchAll }
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
  const { regex, paramNames, catchAll } = routePatternToRegex(pattern)
  const match = normalizeRoute(path).match(regex)
  if (!match) return null

  const params = {}
  paramNames.forEach((name, i) => {
    const raw = match[i + 1]
    // A catch-all is decoded PER SEGMENT: an encoded slash inside one segment
    // (`members%2Fada`) stays a value, while the slashes between segments stay
    // structure. Decoding the whole capture at once would conflate the two.
    params[name] = name === catchAll
      ? raw.split('/').map(decodeRouteValue).join('/')
      : decodeRouteValue(raw)
  })
  return { params }
}

/**
 * The three standard variables a multi-segment capture yields — the split rule,
 * ruled 2026-09-04 [Diego]:
 *
 *     /blog/rust/2025/my-post  →  path = rust/2025/my-post   the whole capture
 *                                 dir  = rust/2025           everything before the last segment
 *                                 slug = my-post             the last segment — the record's handle
 *
 * `slug` means the same thing in both route kinds — in `[slug]` it is the whole
 * segment — and `dir` is empty for a single segment, so a query written against
 * one behaves the same under the other.
 *
 * @param {string} capture - a decoded `:path*` value
 * @returns {{ path: string, dir: string, slug: string }}
 */
export function splitPathCapture(capture) {
  const path = typeof capture === 'string' ? capture.replace(/^\/+|\/+$/g, '') : ''
  const segments = path ? path.split('/') : []
  return {
    path,
    dir: segments.slice(0, -1).join('/'),
    slug: segments.length ? segments[segments.length - 1] : '',
  }
}

/**
 * The inverse of `splitPathCapture` — a record's own URL path under a
 * `[...path]` template, from its placement and its handle. `dir` may be empty.
 *
 * @param {{ dir?: string|null, slug?: string|null }} parts
 * @returns {string|null} null when there is no slug to name the record by
 */
export function joinPathCapture({ dir, slug } = {}) {
  if (slug === undefined || slug === null || slug === '') return null
  const d = typeof dir === 'string' ? dir.replace(/^\/+|\/+$/g, '') : ''
  return d ? `${d}/${slug}` : String(slug)
}

/**
 * A record's PLACEMENT HANDLE — the segment its folder entry is named by, which is
 * what a `[slug]` route (or the last segment of a `[...path]` one) matches.
 *
 * ⭐ Two lanes spell it differently and mean one thing. A host's records service
 * serves the entry's handle as `$name` — `$`-namespaced because a Model may
 * declare its own `name` or `slug` field (five of eight seeded briefs do), and
 * the placement must not be shadowed by one. The file lane derives it from the
 * source filename and calls it `slug`. `$name` wins when present: on a live
 * record a Model field named `slug` is the author's data, not the placement.
 *
 * @param {Object} record
 * @returns {string|undefined}
 */
export function recordHandle(record) {
  if (!record || typeof record !== 'object') return undefined
  const name = record.$name
  if (typeof name === 'string' && name.length) return name
  return record.slug
}

/**
 * The record field a route param is matched on — ONE MAP, read by the local match
 * (`routeParamValue`, below) and by the records service's record question (`match`,
 * `./detail-url.js`), so the two lanes cannot disagree about what a folder's name
 * means. Ruled 2026-09-11 [Diego]:
 *
 *     [slug], [...path]  →  $name   the record's handle (a `[...path]` page's param is `slug`)
 *     [uuid]             →  $uuid   the record's identity
 *     [anything]         →  anything, the record's own field of that name
 *
 * @param {string} paramName
 * @returns {string}
 */
export function routeRecordKey(paramName) {
  if (paramName === 'slug') return '$name'
  if (paramName === 'uuid') return '$uuid'
  return paramName
}

/**
 * The value a record carries for a route param, by `routeRecordKey`'s map. The two
 * built-in keys fall back to the plain field a source without them carries: the
 * handle to `slug` (`recordHandle`), the identity to `uuid` — so a remote API that
 * routes `[uuid]` on its own `uuid` field keeps matching (ruled 2026-09-11).
 *
 * ⛔ Every reader that matches a delivered record to a route param goes through
 * this — the entity store, the website's parametric page, the static build's
 * expansion, the kit's detail hook, the href encoder below. Until 2026-09-04 each
 * read `item[paramName]` directly, so a record served with `$name` and no `slug`
 * matched nothing: a template page on a live lane rendered `[]` and a list linked
 * to no record.
 *
 * @param {Object} record
 * @param {string} paramName
 * @returns {*}
 */
export function routeParamValue(record, paramName) {
  if (!record || typeof record !== 'object') return undefined
  if (paramName === 'slug') return recordHandle(record)
  if (paramName === 'uuid') {
    const id = record.$uuid
    return typeof id === 'string' && id.length ? id : record.uuid
  }
  return record[paramName]
}

/**
 * Every value a record offers for a route's param, as strings — one for a scalar,
 * one per member for a `multi` field.
 *
 * ⭐ A `multi` FIELD MATCHES MEMBER-WISE (ruled 2026-09-12 [Diego]: *"if the code is
 * natural for backend, I think it can be useful to match member-wise"*), and the
 * case it is for is not tag pages: it is a Model field TYPED `multi` that holds one
 * value — `department: ['biology']` — which an author routes as `[department]` and
 * thinks of as a scalar. Matched whole, that page silently renders not-found.
 *
 * ⛔ A ROUTE FIELD THAT IS NOT UNIQUE MAKES TIES NORMAL. Two records holding `'a'`
 * both claim `/tags/a`; the first wins, and *which* is first is this lane's order —
 * the build's record order here, the service's storage order on a hosted site. They
 * can differ, with no error on either. The static build warns when two records claim
 * one route; `docs/reference/dynamic-routes.md` says it plainly.
 *
 * Empty and duplicate members drop, so a record can never claim `/tags/` or the same
 * route twice. ⚠️ `undefined` drops too — it used to stringify to `'undefined'` and
 * match a URL segment spelled that way.
 *
 * @param {Object} record
 * @param {string} paramName
 * @returns {string[]} the values, in the record's own order
 */
export function routeParamValues(record, paramName) {
  const raw = routeParamValue(record, paramName)
  const out = []
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    if (value === undefined || value === null || value === '') continue
    const text = String(value)
    if (text === '' || out.includes(text)) continue
    out.push(text)
  }
  return out
}

/**
 * Does this record answer to this value for the route's param? The one comparison
 * every lane makes — the SPA, the prefetch, the static build — so a URL that finds a
 * record in one cannot miss it in another. Compared as STRINGS: a URL segment is
 * text, so `'42'` matches a field holding `42`.
 *
 * @param {Object} record
 * @param {string} paramName
 * @param {string|number} value - the URL segment
 * @returns {boolean}
 */
export function matchesRouteParam(record, paramName, value) {
  const target = String(value)
  return routeParamValues(record, paramName).some((held) => held === target)
}

/**
 * A parametric page's route binding — the param the record is matched on, its
 * value, and the route VARIABLES a query may reference. ONE implementation, for
 * the SPA (`Website._createDynamicPage`), the prefetch and the static build.
 *
 * The variables are always the three standard names (ruled 2026-09-04 and
 * 2026-09-11 [Diego]; no others):
 *
 *   - `[...path]` splits its capture — `:path` the whole of it, `:dir` all but the
 *     last segment, `:slug` the last (`splitPathCapture`);
 *   - any other param is ONE segment used as is: `:slug` holds it, `:path` equals
 *     it, and `:dir` is empty — which drops a clause that binds it.
 *
 * The raw params ride along under their own names, for a component reading
 * `block.dynamicContext.params`; a query cannot reference them.
 *
 * `paramName` is the page's declared one when it has it. A page nested inside a
 * parametric page (`/members/:slug/cv`) has no bracket of its own and binds the
 * DEEPEST param of its route — its nearest parametric ancestor's.
 *
 * @param {string} pattern - the page's route pattern (`/members/:slug`, `/docs/:path*`)
 * @param {Record<string,string>} params - what `matchDynamicRoute` captured
 * @param {string|null} [paramName] - the page's declared param
 * @returns {{ paramName: string|null, paramValue: string|undefined, variables: Object }}
 */
export function routeBinding(pattern, params = {}, paramName = null) {
  const { catchAll } = routePatternToRegex(pattern)
  const name = routeParamName(pattern, paramName)
  if (catchAll && params[catchAll] !== undefined) {
    const parts = splitPathCapture(params[catchAll])
    return { paramName: name, paramValue: parts.slug, variables: { ...params, ...parts } }
  }
  const value = name ? params[name] : undefined
  if (value === undefined) return { paramName: name, paramValue: undefined, variables: { ...params } }
  return { paramName: name, paramValue: value, variables: { ...params, path: value, dir: '', slug: value } }
}

/**
 * The param a parametric page's record is matched on: the page's declared one;
 * else `slug` under `[...path]` (the record is its handle, the capture's last
 * segment); else the route's DEEPEST param — a page nested inside a parametric
 * page binds its nearest parametric ancestor's.
 *
 * @param {string} pattern
 * @param {string|null} [declared]
 * @returns {string|null}
 */
export function routeParamName(pattern, declared = null) {
  const { paramNames, catchAll } = routePatternToRegex(pattern)
  if (declared && paramNames.includes(declared)) return declared
  if (catchAll) return declared || 'slug'
  if (declared && !paramNames.length) return declared
  return paramNames.length ? paramNames[paramNames.length - 1] : (declared || null)
}

/**
 * The page a page's data inherits from — THE ONE RULE for a page's parent, used by
 * the object graph (`Website.buildPageHierarchy`), the prefetch and the static
 * build, so what a section inherits and what a parametric page's URL narrows are
 * read off the same parent in every lane.
 *
 * The declared parent (`pages[].parent`, which our collector writes) when it names
 * a page; otherwise the route minus its last segment — a `:param` or `:path*` token
 * included — when a page holds that route. A top-level page has none: the homepage
 * is not everyone's parent.
 *
 * ⛔ Measured 2026-09-11, before this existed: the prefetch read the declared field
 * only, so on a payload without it `/members/alice` resolved no configs at all,
 * while the SPA inferred `/members` and fetched the list and the record itself.
 *
 * @param {string} route
 * @param {Object} options
 * @param {string|null} [options.declared] - the parent route the payload declares
 * @param {(route: string) => boolean} options.has - whether a page holds a route
 * @returns {string|null} the parent's route, or null
 */
export function parentRouteOf(route, { declared = null, has } = {}) {
  if (typeof has !== 'function' || typeof route !== 'string') return null
  if (typeof declared === 'string' && declared && declared !== route && has(declared)) return declared
  const r = normalizeRoute(route)
  const cut = r.lastIndexOf('/')
  if (cut <= 0) return null
  const up = r.slice(0, cut)
  return has(up) ? up : null
}

/**
 * The base route a record's URL composes onto, for a page that ADDRESSES ONE RECORD —
 * or null when the page is not one.
 *
 * `/blog/:slug` → `/blog` · `/docs/:path*` → `/docs` · `/:slug` → `/`.
 *
 * ⭐ **The selection is the point, not the slicing.** A page addresses a record only
 * when its route ENDS in a parameter. ⛔ A page nested inside a parametric one —
 * `/members/:slug/cv` — does not, and returns null: composing a record onto it would
 * produce `/members/:slug/alice`, a URL that ranks in an index and 404s on click
 * (the failure hosting measured in their own fixture, 2026-09-12). A static page
 * returns null too, so a page that merely fetches to render itself contributes
 * nothing to a record index.
 *
 * Written for `@uniweb/projections`' `recordRoutes`, which pairs it with
 * `routeQuery` to answer *which of a site's queries become detail pages, and at what
 * base URL* — one mapping a consumer can call instead of re-deriving from page data.
 *
 * @param {string} route - a page's route, parametric or not
 * @returns {string|null} the base route, or null when the page addresses no record
 */
export function recordRouteBase(route) {
  if (typeof route !== 'string') return null
  const r = normalizeRoute(route)
  if (!RECORD_ROUTE.test(r)) return null
  const cut = r.lastIndexOf('/')
  return cut <= 0 ? '/' : r.slice(0, cut)
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
  let head = pattern
  let tailHref = ''
  const tail = pattern.match(CATCH_ALL)
  if (tail) {
    // A catch-all is filled from the record's placement and handle — the split
    // rule in reverse (`joinPathCapture`) — with each SEGMENT encoded and the
    // slashes between them kept as structure. `dir` is the placement; a record
    // carries it as `path` (the folder `records.yml` put it in), which is why
    // `path` here is read as the DIRECTORY and never as a composed capture.
    const handle = recordHandle(values)
    if (joinPathCapture({ dir: values.dir ?? values.path, slug: handle }) === null) return null
    const dir = String(values.dir ?? values.path ?? '')
    const segments = dir.split('/').filter(Boolean).map((seg) => encodeURIComponent(seg))
    // The handle is ONE segment whatever it contains: a `/` inside it is a value.
    segments.push(encodeURIComponent(String(handle)))
    tailHref = '/' + segments.join('/')
    head = pattern.slice(0, tail.index)
  }
  const href = head.replace(new RegExp(`:(${PARAM_NAME})`, 'g'), (_, name) => {
    // ⭐ THE FIRST MEMBER of a `multi` field — a record has ONE canonical href, and
    // every member routes to it (`routeParamValues`). Baked whole, a `['a','b']`
    // field produced `/tags/a%2Cb`, a URL no lane matches.
    const [value] = routeParamValues(values, name)
    if (value === undefined) {
      missing = true
      return ''
    }
    return encodeURIComponent(value)
  })
  return missing ? null : href + tailHref
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

/**
 * ⭐ **THE PAGE A ROUTE NAMES — one rule, for every lane that asks the question.**
 *
 * Exact match first, then the parametric pages in page order, which is the order
 * `Website#getPage` uses in the SPA. Captured params are decoded by
 * `matchDynamicRoute` (a catch-all per segment), so the values are what a site's
 * query binds against.
 *
 * ⛔ **Why this is a leaf rather than a thing each lane composes.** More than one
 * lane asks *which page does this path name* — the SPA, the runtime's server-side
 * prefetch, and a host's router. Our leaves (`normalizeRoute`, `isDynamicRoute`,
 * `routePatternToRegex`) were importable and the RULE was not, so a consumer
 * imported the parts and wrote the composition itself. **A renamed export breaks
 * loudly; a re-implemented rule drifts silently.** A hand-written matcher spelled
 * `:(\w+)` accepts a different param alphabet than our `[A-Za-z0-9_-]+`, so a
 * hyphenated slug resolves in one copy and 404s in the other, with nothing failing
 * anywhere. Import this; do not rebuild it.
 *
 * ⚠️ **A trailing slash is the same route, on BOTH branches** (`normalizeRoute`),
 * which is what `Website#getPage` has always done. The runtime's own prefetch copy
 * compared raw strings until 2026-09-12 and so disagreed with the SPA about
 * `/about/` — the exact class of split this function exists to end.
 *
 * ⚖️ Matching is not resolving: a hit means the ROUTE exists. Whether the record
 * behind a parametric page exists is a data question answered later.
 *
 * @param {Array<Object>|{pages?: Array<Object>}} source - the pages, or a payload holding them
 * @param {string} route - the concrete path
 * @returns {{ page: Object|null, params: Record<string,string> }} `page` is null when nothing matches
 */
export function findPageForRoute(source, route) {
  const pages = Array.isArray(source) ? source : source?.pages
  const list = Array.isArray(pages) ? pages : []
  const wanted = normalizeRoute(route)

  for (const page of list) {
    if (typeof page?.route === 'string' && normalizeRoute(page.route) === wanted) return { page, params: {} }
  }
  for (const page of list) {
    if (typeof page?.route !== 'string' || !isDynamicRoute(page.route)) continue
    const hit = matchDynamicRoute(page.route, wanted)
    if (hit) return { page, params: hit.params }
  }
  return { page: null, params: {} }
}
