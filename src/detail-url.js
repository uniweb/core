/**
 * Detail-record resolution — the ONE home for turning a resolved query config plus
 * a parametric page's route value into the request for its record.
 *
 * Why this is a subpath rather than an EntityStore internal. A host that
 * renders a detail page server-side has to fetch *the same record* the browser
 * will fetch when it hydrates over that render. If the two build the request even
 * slightly differently, a host prerenders record A and the browser hydrates
 * record B — silently, and only on parametric pages. That is the same failure
 * `./route-match.js` was extracted to end, on the fetch side instead of the
 * routing side.
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

import { recordHandle, routeRecordKey } from './route-match.js'
import { substitutePlaceholders } from './substitute-placeholders.js'

/**
 * The substitution context for a record request: the route's own param name,
 * plus a generic `param` alias bound to the same value.
 *
 * ⭐ Why the alias exists. An AUTHOR writing a record address knows their route
 * and writes `{slug}` or `{id}` — that convention is unchanged and must stay. A
 * HOST declaring a record address cannot know it: `param_name` is the site's
 * routing choice. So the host writes `{param}`. `substitutePlaceholders` only
 * resolves keys present in the context, so an unrelated `{name}` still passes
 * through literally.
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
  // kit's `useWholeRecord` — its slug fills the name the FILE was written under. A
  // caller with no record in hand leaves `{slug}` literal rather than guessing
  // the capture is one: a visibly unresolved address beats a plausible wrong one.
  const handle = recordHandle(record)
  if (paramName !== 'slug' && handle != null && handle !== '') {
    context.slug = handle
  }
  return context
}

/**
 * The record key a `[slug]` (or `[...path]`) route matches — the entry's own
 * handle, which the records service guarantees unique among siblings (the
 * records contract §1b: `$name`). Kept as the export it has been; the map from
 * every folder name to its key is `routeRecordKey` (`./route-match.js`), whose
 * `slug` entry this is.
 */
export const ROUTE_HANDLE_KEY = routeRecordKey('slug')

/**
 * Build the request for a parametric page's record from its route query's resolved
 * config (post-`resolveFetchConfigs`, which set `detail` — see `./fetch-config.js`).
 * Three sources, and no others:
 *
 *   - **the records service** — the route query's set, plus `narrow.match`;
 *   - **an external query's `record:`** — its `url` (the query's when it names none),
 *     `method` (likewise), `body` and `transform` — ⛔ never the list's `body` or
 *     `transform`, since a record response is rarely wrapped the way the list is;
 *   - **a `deferred:` query's per-record file** — the `/data/<query>/{slug}.json`
 *     pattern the resolver injected.
 *
 * ⛔ The `detail:` forms an author wrote until 2026-09-13 — `rest`, `query`, a URL
 * pattern and `{ body, envelope }` — are gone with inline `url:` fetches [Diego]: an
 * external query's `record:` says the same thing, on the query. The record request
 * reused the list's `transform` until then, so a list under `results` and a bare
 * record endpoint delivered `[]` (measured).
 *
 * Returns `null` — never throws — when the config has no per-record source or the
 * route carries no value. A caller treats `null` as "find the record in the list".
 *
 * @param {Object} queryConfig - a resolved config
 * @param {{ paramName: string, paramValue: string, record?: Object|null }} dynamicContext -
 *   the route's param and its value; `record`, when the caller already holds the
 *   matched record, lets `{slug}` resolve to the record's own slug (`paramContext`).
 * @returns {Object|null} a request, or null
 */
export function buildDetailConfig(queryConfig, dynamicContext) {
  const { detail } = queryConfig
  if (!detail) return null
  const { paramName, paramValue, record = null } = dynamicContext
  if (!paramName || paramValue === undefined) return null

  // ⭐ THE RECORDS SERVICE: the record is the route query's SET — the query as saved,
  // its `scope`, `where`, `sort` and `limit` all kept — narrowed by `match`, the one
  // key the page's folder names and the URL's value for it (`routeRecordKey`: `[slug]`
  // → `$name`, `[uuid]` → `$uuid`, `[id]` → `id`), asked in full. So the one question
  // answers the record if it is in the set and `[]` (not found) if it is not: a
  // record outside the query's `limit` has no page, and a query's conditions cannot
  // be escaped through the URL (ruled 2026-09-14 [Diego]).
  //
  // ⭐ The fetch's own narrowing drops: which pages exist is the query's to decide,
  // never a list's (`routeSelection`). So every section of the page that asks its
  // record asks this one question.
  //
  // ⛔ Until 2026-09-14 the record question dropped the query's `sort` and `limit` and
  // sent `match` at the top level, so "this field note, if it is among the 100" was
  // asked as "this field note". ⛔ And `where` is never touched: until 2026-09-11 the
  // handle was merged into it, which replaced any condition the author had on the same
  // key; `where` is the author's and `match` is the visitor's [Diego]. The value is a
  // string — it is a URL segment — and the service compares it as one, as the local
  // match does.
  if (queryConfig.ask) {
    const { narrow: _narrow, detail: _detail, match: _match, ...set } = queryConfig
    return {
      ...set,
      narrow: { match: { [routeRecordKey(paramName)]: String(paramValue) } },
      whole: true,
      dynamicContext: { paramName, paramValue },
    }
  }

  // What every other record request carries beside its address:
  //   `as`             — the binding key, so the record lands where the list did;
  //   `query`          — the query it is one record of;
  //   `whole: true`    — what it asks for, and what the record index files it as;
  //   `dynamicContext` — the route param, which the default fetcher substitutes
  //                      into a POST body;
  //   `locale`         — carried from the list, so the two share a locale.
  const common = { as: queryConfig.as, whole: true, dynamicContext: { paramName, paramValue } }
  if (typeof queryConfig.query === 'string') common.query = queryConfig.query
  if (queryConfig.locale !== undefined) common.locale = queryConfig.locale
  const context = paramContext(paramName, paramValue, record)

  // ⭐ AN EXTERNAL QUERY'S `record:`.
  const spec = queryConfig.record
  if (spec && typeof spec === 'object' && typeof queryConfig.url === 'string') {
    const out = {
      url: typeof spec.url === 'string' && spec.url ? substitutePlaceholders(spec.url, context) : queryConfig.url,
      ...common,
    }
    const method = typeof spec.method === 'string' && spec.method ? spec.method : queryConfig.method
    if (method) out.method = method
    if (spec.body !== undefined && spec.body !== null) out.body = substitutePlaceholders(spec.body, context, { encode: false })
    if (typeof spec.transform === 'string' && spec.transform) out.transform = spec.transform
    return out
  }

  // ⭐ A `deferred:` QUERY'S PER-RECORD FILE — the pattern `applyDeferredDetail` injected.
  if (typeof detail === 'string' && typeof queryConfig.path === 'string') {
    return { path: substitutePlaceholders(detail, context), ...common }
  }

  return null
}
