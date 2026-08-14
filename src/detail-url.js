/**
 * Detail-record resolution — the ONE home for turning a collection's `detail:`
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
 * Build a detail-URL fetch config from a collection config + dynamic context.
 *
 * Four forms of `detail:`:
 *   - `'rest'`                — append paramValue as a path segment.
 *   - `'query'`               — append `?paramName=paramValue`.
 *   - `'/articles/{slug}'`    — custom URL pattern with {paramName} placeholders.
 *   - `{ body, envelope }`    — object form. Reuses the collection's url /
 *                               method / headers / auth; adds per-detail
 *                               body (with placeholder substitution) and
 *                               per-detail envelope.
 *
 * Returns `null` — never throws — when the collection declares no `detail:`,
 * when the dynamic context carries no param, or when the collection has
 * neither `url:` nor `path:` to build from. A caller treats `null` as "this
 * collection has no separate detail fetch", which is the common case.
 *
 * @param {Object} collectionConfig - A resolved fetch config for the collection
 *   (post-`resolveFetchConfigs`, so `detail` may have been auto-injected for a
 *   `deferred:` collection — see `./fetch-config.js`).
 * @param {{ paramName: string, paramValue: string }} dynamicContext
 * @returns {Object|null} A fetch config carrying `url` or `path`, or null.
 */
export function buildDetailConfig(collectionConfig, dynamicContext) {
  const { detail } = collectionConfig
  if (!detail) return null
  const { paramName, paramValue } = dynamicContext
  if (!paramName || paramValue === undefined) return null

  const baseUrl = collectionConfig.url || collectionConfig.path
  if (!baseUrl) return null
  const isLocalPath = !!collectionConfig.path && !collectionConfig.url

  // Object form: `detail: { body, envelope }`. Reuses collection's URL +
  // method + headers + auth. The body is placeholder-substituted against
  // the dynamic context so `body: { variables: { slug: "{slug}" } }` works.
  if (detail && typeof detail === 'object') {
    const out = {
      ...(isLocalPath ? { path: baseUrl } : { url: baseUrl }),
      schema: collectionConfig.schema,
      transform: collectionConfig.transform,
    }
    if (collectionConfig.method) out.method = collectionConfig.method
    if (detail.body !== undefined) {
      out.body = substitutePlaceholders(detail.body, { [paramName]: paramValue }, { encode: false })
    } else if (collectionConfig.body !== undefined) {
      out.body = substitutePlaceholders(collectionConfig.body, { [paramName]: paramValue }, { encode: false })
    }
    if (detail.envelope) out.envelope = detail.envelope
    return out
  }

  // String-form: URL-based conventions.
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
    detailUrl = substitutePlaceholders(detail, { [paramName]: paramValue })
  }

  return {
    ...(isLocalPath ? { path: detailUrl } : { url: detailUrl }),
    schema: collectionConfig.schema,
    transform: collectionConfig.transform,
  }
}
