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
function paramContext(paramName, paramValue, record) {
  const context = { [paramName]: paramValue, param: paramValue }
  // ⭐ `{slug}` is the RECORD'S slug, whatever the route calls its param. The
  // file lane keys a query's per-record files by `item.slug` (`writeQueryFiles`)
  // and injects `/data/<name>/{slug}.json` — so on a site routing `[id]`, the
  // route's context carried `id` and `param` and `{slug}` stayed literal: the
  // detail URL was `/data/articles/{slug}.json`, a guaranteed 404, on every
  // template page with `deferred:` fields (measured 2026-09-04). When the caller
  // holds the record — the entity store does (it matched it), and so does
  // `useEntityDetail` — its slug fills the name the FILE was written under. A
  // caller with no record in hand leaves `{slug}` literal rather than guessing
  // the capture is one: a visibly unresolved address beats a plausible wrong one.
  if (paramName !== 'slug' && record && typeof record === 'object' && record.slug != null && record.slug !== '') {
    context.slug = record.slug
  }
  return context
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
 * @param {{ paramName: string, paramValue: string, record?: Object|null }} dynamicContext -
 *   the route's param and its value; `record`, when the caller already holds the
 *   matched record, lets `{slug}` resolve to the record's own slug (see
 *   `paramContext`).
 * @returns {Object|null} A fetch config carrying `url` or `path`, or null.
 */
/**
 * The key a route param narrows a QUESTION by — the entry's own handle, which
 * a records door guarantees unique among siblings (the records door's contract
 * §1b: `$name`, "addressed AND filtered"). ⚠️ One constant, because the spelling
 * moved four times in one day (`path_segment` → `$slug` → `$name` → `meta::name`
 * → `$name`); the door is dark until a host stamps it, so this is the one place
 * to change if it moves again. Not read by the file lane or the address door,
 * which narrow by the route's own param (`item[paramName]`).
 */
export const ROUTE_HANDLE_KEY = '$name'

export function buildDetailConfig(queryConfig, dynamicContext) {
  const { detail } = queryConfig
  if (!detail) return null
  const { paramName, paramValue, record = null } = dynamicContext
  if (!paramName || paramValue === undefined) return null

  // ⭐ A QUESTION DOOR: the record is the list's own question, narrowed to one
  // entry by its handle and asked in full — the list page and the detail page
  // are the same query, differing only by whether the parameter is bound
  // (the records door's contract, §1a). `sort` and `limit` are the
  // list's and drop; `scope` and the authored `where` stay, so a scoped query
  // cannot be escaped through the URL.
  if (queryConfig.door) {
    const { sort, limit, detail: _detail, ...rest } = queryConfig
    return {
      ...rest,
      where: { ...(queryConfig.where && typeof queryConfig.where === 'object' ? queryConfig.where : {}), [ROUTE_HANDLE_KEY]: String(paramValue) },
      depth: 'full',
      dynamicContext: { paramName, paramValue },
    }
  }

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

  // What every detail config carries beside its address:
  //   `as`             — the binding key, so the record lands where the list did;
  //   `query`          — the query it is one record of (identity on a door);
  //   `depth: 'full'`  — what it asks for, and what the record index files it as;
  //   `dynamicContext` — the route param, which the default fetcher already keys
  //                      a SINGLE-RECORD response on (`envelope.item`, body
  //                      placeholders). ⛔ The entity store never passed it, so
  //                      a live lane's bare record response was unwrapped with
  //                      the LIST key and read as `[]` (found 2026-09-04).
  //   `locale`         — carried from the list, so the two share a locale.
  const common = {
    as: queryConfig.as,
    transform: queryConfig.transform,
    depth: 'full',
    dynamicContext: { paramName, paramValue },
  }
  if (typeof queryConfig.query === 'string') common.query = queryConfig.query
  if (queryConfig.locale !== undefined) common.locale = queryConfig.locale

  // Object form: `detail: { body, envelope }`. Reuses the query's URL +
  // method + headers + auth. The body is placeholder-substituted against
  // the dynamic context so `body: { variables: { slug: "{slug}" } }` works.
  if (detail && typeof detail === 'object') {
    const out = {
      [addressKey]: baseUrl,
      ...common,
    }
    if (queryConfig.method) out.method = queryConfig.method
    if (detail.body !== undefined) {
      out.body = substitutePlaceholders(detail.body, paramContext(paramName, paramValue, record), { encode: false })
    } else if (queryConfig.body !== undefined) {
      out.body = substitutePlaceholders(queryConfig.body, paramContext(paramName, paramValue, record), { encode: false })
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
    detailUrl = substitutePlaceholders(detail, paramContext(paramName, paramValue, record))
  }

  return {
    [addressKey]: detailUrl,
    ...common,
  }
}
