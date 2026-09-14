/**
 * Where a site's queries are answered — the `records` service.
 *
 * ## The one idea
 *
 * A site names a query; it never names where its records live. Where they live
 * is a **deployment** fact, and the two possible answers have different owners:
 *
 *   1. **A host that answers questions** offers the `records` service — an
 *      address with a `{locale}` slot, which takes a POST carrying the whole
 *      query. It owns every segment of it; the runtime substitutes the one slot
 *      and sends the question. ⛔ The question is composed elsewhere
 *      (`fetch-config.js`); this file only says where it goes.
 *   2. **Nobody** — and the answer is the artifact the build itself emitted,
 *      `/data/<name>.json`, which is not an address at all but a path in the
 *      site's own URL space.
 *
 * Absence of (1) is therefore not an error and not a decline: it falls THROUGH
 * to (2). That is what makes a site with no backend the default rather than a
 * special case.
 *
 * ## ⭐ It is a SERVICE, and that is the whole of its shape
 *
 * *[Diego, 2026-09-06: "`records` does sound like a service. It is the service
 * of having a dynamic record provider."]* So it sits in `config.services`
 * beside `search`, `submit` and `assistant`, is read with the same
 * `readEndpoint` rule (string shorthand or `{ endpoint }`), and follows the
 * same law: **presence is the switch.** A host that offers a records lane
 * stamps the row; one that does not, does not.
 *
 * ⛔ **It did NOT used to be.** Until 2026-09-06 it was `config.records`, an
 * object of its own whose only surviving key was `query` — a wrapper left over
 * from the day there were two lanes to choose between. One host-stamped address
 * read by two mechanisms was the accident; a service row is the shape it always
 * had.
 *
 * ## ⛔ The HOST tier only — and the reason is mechanical, not a policy
 *
 * `resolveService` reads the site's authored tier first and the host's second.
 * This does not, because it cannot: its caller `resolveFetchConfigs` is a leaf
 * that runs in an SSR isolate over a plain content object with no `Website` to
 * hand. It reads `config.services` directly, so the authored tier is not
 * available here. ⇒ **A site does not declare its own record provider**, which
 * is also the standing ruling — a third-party source is a foundation transport,
 * not site-level config *(2026-09-04, the retired `fetcher:` vocabulary)*.
 *
 * ## ⛔ A pattern, not a base — and the reason is a deleted function
 *
 * A base assumes the layout is "root plus one segment". A pattern assumes
 * nothing, so a host can carry a site id, a locale segment, a different root
 * for records than for the site, or none of those, and move any of it without a
 * framework release. This is the `config.assets.url` rule applied to records:
 * the CLI once composed `{assetBase}dist/{id}/base.{ext}` — a backend's path
 * layout, inside a published CLI — and it was deleted rather than
 * parameterized. Substituting `{locale}` is the WHOLE of what this does.
 *
 * Zero-dependency beyond two sibling leaves, so the SSR pipeline and a Worker
 * isolate can both import it.
 */

import { substitutePlaceholders } from './substitute-placeholders.js'
import { readEndpoint } from './services.js'

const warnedPatterns = new Set()

function warnOnce(key, message) {
  if (warnedPatterns.has(key)) return
  warnedPatterns.add(key)
  console.warn(`[records-service] ${message}`)
}

/** Test seam — reset the once-per-pattern memo so suites do not leak. */
export function _resetRecordsServiceWarnings() {
  warnedPatterns.clear()
}

/**
 * The service name a host stamps to say it answers queries.
 *
 * One constant, changed in one place should it ever move.
 */
export const RECORDS_SERVICE = 'records'

/**
 * The address a query is asked at, substituted for one locale, or `null` when
 * no host offers the service.
 *
 * A row present with no address is a host saying "not for this site" —
 * indistinguishable, for a caller, from no row at all. Both fall through to the
 * compiled artifact.
 *
 * The locale is a ROUTE SEGMENT there, never a query param: a request that
 * cannot name one does not address the service at all.
 *
 * @param {Object|null} services - `config.services`
 * @param {string|null} locale - the locale being rendered; required
 * @returns {string|null}
 */
export function resolveRecordsService(services, locale) {
  if (!services || typeof services !== 'object' || Array.isArray(services)) return null
  const endpoint = readEndpoint(services[RECORDS_SERVICE])
  if (!endpoint) return null
  if (typeof locale !== 'string' || locale.length === 0) return null
  if (!endpoint.includes('{locale}')) {
    warnOnce(
      `records:${endpoint}`,
      `config.services.${RECORDS_SERVICE} carries no {locale} placeholder; the service takes the ` +
        `locale as a route segment. Ignoring it.`
    )
    return null
  }
  return substitutePlaceholders(endpoint, { locale })
}
