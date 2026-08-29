/**
 * Detail-record resolution — the ONE home for turning a query's `detail:`
 * declaration plus a dynamic route's params into a fetch config.
 *
 * Why this is a subpath rather than an EntityStore internal. A host that
 * renders a detail page server-side has to fetch *the same record* the browser
 * will fetch when it hydrates over that render. The four `detail:` forms below
 * each decide a different URL, so a host that resolves them even slightly
 * differently prerenders record A and hydrates record B — silently, and only on
 * the routes that have a pattern. That is the same failure `./route-match.js`
 * was extracted to end, on the fetch side instead of the routing side.
 *
 * Zero-dependency leaf, like `./route-match.js`, `./data-paths.js` and
 * `./fetch-config.js`: it imports one sibling that itself imports nothing, so a
 * consumer that must not pull core's object graph — an edge worker, a build
 * step — can import `@uniweb/core/detail-url` directly. No `node:*`, no DOM.
 *
 * ## What this module does NOT decide
 *
 * It builds a *request*, not a result. Whether the record exists, whether the
 * fetch is cached, and what happens when it 404s are the caller's, exactly as
 * a matched route pattern says nothing about the record behind it.
 */

import { substitutePlaceholders } from './substitute-placeholders.js'

/**
 * The substitution context for a detail pattern: the route's own param name,
 * plus a generic `param` alias bound to the same value.
 *
 * ⭐ Why the alias exists. An AUTHOR writing a detail pattern knows their route
 * and writes `{slug}` or `{id}` — that convention is unchanged and must stay,
 * because it is what every existing site and the auto-injected per-record
 * pattern use. A HOST declaring a record address cannot know it: `param_name`
 * is the site's routing choice, and the host is publishing one pattern for
 * every site it serves. So the host writes `{param}`.
 *
 * Binding both names to one value is what lets the two conventions coexist
 * without a translation step between them — and a translation step is exactly
 * where the framework has twice grown a second copy of a rule that then drifted
 * (`route-match`, `data-paths`). `substitutePlaceholders` only resolves keys
 * present in the context, so an unrelated `{name}` still passes through
 * literally, as it always has.
 */
function paramContext(paramName, paramValue) {
  return { [paramName]: paramValue, param: paramValue }
}

/**
 * Build a detail-URL fetch config from a query config + dynamic context.
 *
 * Four forms of `detail:`:
 *   - `'rest'`                — append paramValue as a path segment.
 *   - `'query'`               — append `?paramName=paramValue`.
 *   - `'/articles/{slug}'`    — custom URL pattern with {paramName} placeholders,
 *                               or the generic `{param}` alias (see below).
 *   - `{ body, envelope }`    — object form. Reuses the query's url /
 *                               method / headers / auth; adds per-detail
 *                               body (with placeholder substitution) and
 *                               per-detail envelope.
 *
 * Returns `null` — never throws — when the query declares no `detail:`,
 * when the dynamic context carries no param, or when the query has
 * neither `url:` nor `path:` to build from. A caller treats `null` as "this
 * query has no separate detail fetch", which is the common case.
 *
 * @param {Object} queryConfig - A resolved fetch config for the query
 *   (post-`resolveFetchConfigs`, so `detail` may have been auto-injected for a
 *   `deferred:` query — see `./fetch-config.js`).
 * @param {{ paramName: string, paramValue: string }} dynamicContext
 * @returns {Object|null} A fetch config carrying `url` or `path`, or null.
 */
export function buildDetailConfig(queryConfig, dynamicContext) {
  const { detail } = queryConfig
  if (!detail) return null
  const { paramName, paramValue } = dynamicContext
  if (!paramName || paramValue === undefined) return null

  // Three address kinds now, and the detail request must come back as the SAME
  // kind: an `endpoint` carries remote semantics the fetcher decides on, so
  // returning a detail as `path` would silently drop operator pushdown and the
  // site's static headers for exactly the request that is one record.
  const baseUrl = queryConfig.endpoint || queryConfig.url || queryConfig.path
  if (!baseUrl) return null
  const addressKey = queryConfig.endpoint
    ? 'endpoint'
    : queryConfig.url
      ? 'url'
      : 'path'

  // Object form: `detail: { body, envelope }`. Reuses the query's URL +
  // method + headers + auth. The body is placeholder-substituted against
  // the dynamic context so `body: { variables: { slug: "{slug}" } }` works.
  if (detail && typeof detail === 'object') {
    const out = {
      [addressKey]: baseUrl,
      schema: queryConfig.schema,
      transform: queryConfig.transform,
    }
    if (queryConfig.method) out.method = queryConfig.method
    if (detail.body !== undefined) {
      out.body = substitutePlaceholders(detail.body, paramContext(paramName, paramValue), { encode: false })
    } else if (queryConfig.body !== undefined) {
      out.body = substitutePlaceholders(queryConfig.body, paramContext(paramName, paramValue), { encode: false })
    }
    if (detail.envelope) out.envelope = detail.envelope
    return out
  }

  // String-form: URL-based conventions.
  //
  // ⭐ `rest` and `query` BUILD FROM THE LIST URL, so its query string survives onto
  // the detail request. That is deliberate and it is the safe default: the params
  // that matter most to a single-record read are exactly the ones a list carries —
  // `?lang=`, an API key, a tenancy id. Dropping them would 401 the detail request
  // or return the wrong language, on every detail page.
  //
  // ⚠️ The cost is real and lands on ONE category: a PROJECTION param (`?fields=`,
  // `?select=`) asks the API for a summary, and carrying it truncates the very
  // record the detail fetch exists to get in full. The request still succeeds and
  // only some fields are missing, so it reads as a component or API fault rather
  // than a URL one.
  //
  // ⛔ Framework cannot tell the categories apart — they are the host's vocabulary,
  // not ours. So the default keeps everything and the CUSTOM PATTERN form is the
  // way out: it is used verbatim, so nothing carries over unless the author writes
  // it. Documented for authors in `docs/reference/dynamic-routes.md` § *The list's
  // query string carries over*.
  let detailUrl
  if (detail === 'rest') {
    const [basePath, queryString] = baseUrl.split('?')
    const cleanBase = basePath.replace(/\/$/, '')
    detailUrl = queryString
      ? `${cleanBase}/${encodeURIComponent(paramValue)}?${queryString}`
      : `${cleanBase}/${encodeURIComponent(paramValue)}`
  } else if (detail === 'query') {
    const sep = baseUrl.includes('?') ? '&' : '?'
    detailUrl = `${baseUrl}${sep}${paramName}=${encodeURIComponent(paramValue)}`
  } else {
    // Custom pattern like '/articles/{slug}' — substitute placeholders
    // from the dynamic-route context. Only placeholders matching the
    // active paramName resolve; others pass through as literal `{name}`.
    detailUrl = substitutePlaceholders(detail, paramContext(paramName, paramValue))
  }

  return {
    [addressKey]: detailUrl,
    schema: queryConfig.schema,
    transform: queryConfig.transform,
  }
}
