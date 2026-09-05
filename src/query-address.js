/**
 * Resolve a query request to the one address a host can declare for it.
 *
 * ## The one idea
 *
 * A site names a query; it never names where its records live. Where they live
 * is a **deployment** fact, and the two possible answers have different owners:
 *
 *   1. **A host that answers questions** declares a QUESTION DOOR at
 *      `config.records.query` — a POST address with a `{locale}` slot. It owns
 *      every segment of it; the runtime substitutes the one slot and sends the
 *      whole query. ⛔ The question is composed elsewhere (`fetch-config.js`);
 *      this file only says where it goes.
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
 * ## ⛔ The ADDRESS door is retired (2026-09-04) — do not bring it back
 *
 * Until that day this file also read two URL PATTERNS off the same stamp —
 * `list` (`{path}`) and `record` (`{param}`) — for a GET lane the runtime
 * evaluated the query over locally. It went by ruling, with no hosted site to
 * protect: two lanes on one host answered one query two ways (an operator the
 * door refuses was honoured locally on the GET lane), the precedence between
 * them was where the failure lived, and the address was composed from the
 * query's NAME, which is not a folder path. A query is a question; a host that
 * cannot answer one is a host with no records lane, and its site reads the
 * compiled file. A host's `list` / `record` / `envelope` stamps are not read.
 *
 * ## ⛔ A pattern, not a base — and the reason is a deleted function
 *
 * A base assumes the layout is "root plus one segment". A pattern assumes
 * nothing, so a host can carry a site id, a locale segment, a different root
 * for the door than for the site, or none of those, and move any of it
 * without a framework release. This is the `config.assets.url` rule applied to
 * records: the CLI once composed `{assetBase}dist/{id}/base.{ext}` — a backend's
 * path layout, inside a published CLI — and it was deleted rather than
 * parameterized. Substituting `{locale}` is the WHOLE of what this does.
 *
 * Zero-dependency beyond one sibling leaf, so the SSR pipeline and a Worker
 * isolate can both import it.
 */

import { substitutePlaceholders } from './substitute-placeholders.js'


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
 * The QUESTION door a host declares — a POST address with a `{locale}` slot —
 * substituted for one locale, or `null` when the lane declares none.
 *
 * The stamp key is `config.records.query` — read here as a provisional spelling
 * on 2026-09-04 and NAMED THE SAME DAY by the door's owner (their site-records
 * contract, §11.4: stamped since 2026-09-04; the value is the host's — `/_query/{locale}`
 * since their 417cdf7b, `/_records/_query/{locale}` for one day before — and nothing here
 * assumes either: the whole value is read and only `{locale}` is filled).
 * One constant, changed in one place should it ever move. Everything downstream
 * wakes only when a host stamps it AND the payload carries the query's Model ref
 * (`config.queries`), and stays dark otherwise. The locale is a ROUTE SEGMENT
 * there, never a query param: a request that cannot name one does not address
 * this door at all.
 *
 * @param {Object|null} lane - `config.records`
 * @param {string|null} locale - the locale being rendered; required
 * @returns {string|null}
 */
export const QUERY_DOOR_KEY = 'query'

export function resolveQueryDoor(lane, locale) {
  const pattern = readPattern(lane, QUERY_DOOR_KEY)
  if (!pattern) return null
  if (typeof locale !== 'string' || locale.length === 0) return null
  if (!pattern.includes('{locale}')) {
    warnOnce(
      `query:${pattern}`,
      `config.records.${QUERY_DOOR_KEY} carries no {locale} placeholder; the door takes the ` +
        `locale as a route segment. Ignoring it.`
    )
    return null
  }
  return substitutePlaceholders(pattern, { locale })
}

