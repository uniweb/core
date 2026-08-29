/**
 * Resolve a query request to an address the fetcher can call.
 *
 * ## The one idea
 *
 * A site names a query; it never names where its records live. Where
 * it lives is a **deployment** fact, and the two possible answers have different
 * owners:
 *
 *   1. **A host that serves records live** declares a pair of URL *patterns*
 *      at `config.records`. It owns every segment of them.
 *   2. **Nobody** — and the answer is the artifact the build itself emitted,
 *      `/data/<name>.json`, which is not an address at all but a path in the
 *      site's own URL space.
 *
 * Absence of (1) is therefore not an error and not a decline: it falls THROUGH
 * to (2). That is what makes a site with no backend the default rather than a
 * special case, and it is why this does not go through `resolveService` — a
 * service's absence means the site has no such feature and the caller draws
 * nothing, which is right for `submit` and wrong here, where the fallback is a
 * file the build knows it wrote.
 *
 * ## ⛔ Patterns, not a base — and the reason is a deleted function
 *
 * A base assumes the layout is "root plus one segment". A pattern assumes
 * nothing, so a host can carry a site id, a locale segment, a different root
 * for records than for the list, or none of those, and move any of it
 * without a framework release.
 *
 * This is the `config.assets.url` rule applied to records. That pattern exists
 * because the CLI once composed `{assetBase}dist/{id}/base.{ext}` — a backend's
 * path layout, inside a published CLI, on a release cadence the backend could
 * not move. It was deleted rather than parameterized. Composing a segment of
 * our own here would rebuild exactly that coupling, on a lane where the wrong
 * answer is *stale or missing content* rather than a visible 404.
 *
 * ⇒ Substituting `{path}` and `{param}` is the WHOLE of what this does.
 *
 * Zero-dependency beyond two sibling leaves, so the SSR pipeline and a Worker
 * isolate can both import it.
 */

import { substitutePlaceholders } from './substitute-placeholders.js'

/**
 * The placeholder a list pattern must carry.
 *
 * ⛔ IT IS `{path}`, NOT `{query}`, AND THAT IS NOT COSMETIC. A *query* is
 * framework's own build concept — a named set our build compiles to one file. A host
 * serving records has no such thing: it has content organised somewhere, and what we
 * substitute is a **path** to it. Naming the slot for our file vocabulary put that
 * vocabulary into a string a HOST writes, which makes them reason in our shape.
 * See `kb/framework/architecture/backend-boundary.md` §2.
 */
const PATH_SLOT = '{path}'
/** The placeholder a record pattern must carry to address a specific record. */
const PARAM_SLOT = '{param}'

const warnedPatterns = new Set()

function warnOnce(key, message) {
  if (warnedPatterns.has(key)) return
  warnedPatterns.add(key)
  console.warn(`[query-address] ${message}`)
}

/** Test seam — reset the once-per-pattern memo so suites do not leak. */
export function _resetQueryAddressWarnings() {
  warnedPatterns.clear()
}

/**
 * Is this a usable lane declaration?
 *
 * A declaration present with no pattern is a host saying "not for this site" —
 * indistinguishable, for a caller, from no declaration at all. Both fall
 * through to the artifact.
 */
function readPattern(lane, key) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return null
  const pattern = lane[key]
  return typeof pattern === 'string' && pattern.length > 0 ? pattern : null
}

/**
 * The address for a whole query's records, or `null` to fall through to the artifact.
 *
 * ⚠️ A pattern that does not carry `{path}` is REFUSED rather than used.
 * Substituting nothing would yield one identical URL for every query on the
 * site — every schema reading the same records, with a 200 on each request. That
 * is the failure this check exists for; an unusable pattern must degrade to the
 * artifact, which is at least correct.
 *
 * @param {string} query - the query's authored name (the wiring key).
 * @param {Object|null} lane - `config.records`.
 * @returns {string|null} the address, or null when nothing usable is declared.
 */
export function resolveQueryAddress(query, lane) {
  if (typeof query !== 'string' || query.length === 0) return null
  const pattern = readPattern(lane, 'list')
  if (!pattern) return null
  if (!pattern.includes(PATH_SLOT)) {
    warnOnce(
      `list:${pattern}`,
      `config.records.list carries no ${PATH_SLOT} placeholder, so every ` +
        `query would resolve to the same address. Ignoring it and reading the ` +
        `compiled file instead.`
    )
    return null
  }
  return substitutePlaceholders(pattern, { path: query })
}

/**
 * The address pattern for ONE record of a query, with `{param}` left in
 * place for the dynamic-route substitution that happens later.
 *
 * Returning a pattern rather than a finished URL is deliberate: the route param
 * is not known here, and the framework already has one place that resolves it
 * (`buildDetailConfig` / `substitutePlaceholders` at fetch time). Resolving it
 * twice, in two places, is how the two copies drift.
 *
 * @param {string} query
 * @param {Object|null} lane - `config.records`.
 * @returns {string|null} a pattern still containing `{param}`, or null.
 */
export function resolveRecordAddressPattern(query, lane) {
  if (typeof query !== 'string' || query.length === 0) return null
  const pattern = readPattern(lane, 'record')
  if (!pattern) return null
  if (!pattern.includes(PARAM_SLOT)) {
    warnOnce(
      `record:${pattern}`,
      `config.records.record carries no ${PARAM_SLOT} placeholder, so every record ` +
        `would resolve to the same address. Ignoring it and reading the per-record ` +
        `file instead.`
    )
    return null
  }
  // Only `{path}` is substituted here — `{param}` survives for the
  // dynamic-route resolution that owns it.
  return substitutePlaceholders(pattern, { path: query })
}
