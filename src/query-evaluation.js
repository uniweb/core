/**
 * ⭐ A QUERY'S SET, THEN WHAT A FETCH TAKES OF IT — evaluated over the records a
 * source returned. The ONE order of work for every lane that evaluates locally: the
 * runtime's default fetcher over a compiled file or an external query's response,
 * and the build when it runs a page's fetch.
 *
 * A resolved config has two levels (ruled 2026-09-14 [Diego],
 * `@uniweb/core/fetch-config`):
 *
 *   1. **the set** — the query as saved: `scope`, then `where`, ordered by `sort`,
 *      cut by `limit`;
 *   2. **`narrow`** — the fetch's narrowing of that set: `where` and `match` filter
 *      what the set holds, `sort` re-orders what is left (the set's order when there
 *      is none), and `limit` cuts the rest.
 *
 * So a narrowing never reaches past the set: its `limit` can cut the set and never
 * extend it. A host's records service evaluates the same two levels at the source.
 *
 * ⚠️ `narrow.cursor` is not evaluated here: a cursor resumes a service's answer, and
 * no local source issues one.
 *
 * INTENTIONALLY A LEAF — pure JS, no `node:*`, no DOM, no package-root import — so
 * the build and a browser runtime evaluate with the same code.
 */

import { match as matchWhere } from './where.js'
import { applyScope } from './scope.js'
import { sortRecords, parseSort } from './sort.js'
import { recordKeyValues } from './route-match.js'

/**
 * Evaluate a resolved config's set and its narrowing over records.
 *
 * @param {Array<Object>|*} records - what the source returned; anything but an array
 *   is returned as it is (a single record is not filtered, sorted or cut)
 * @param {Object} config - a resolved fetch config
 * @param {Object} [options]
 * @param {string|null} [options.locale] - the page's locale, which texts sort in
 * @param {(items: Array, sort: *, options: { locale: string|null }) => Array} [options.sort] -
 *   the sort to apply, `sortRecords` by default. A lane that answers a bad `sort:`
 *   differently — the runtime delivers the records unsorted in production — passes its own.
 * @returns {Array<Object>|*} the records the config selects, in its order
 */
export function evaluateQuery(records, config, { locale = null, sort = sortRecords } = {}) {
  if (!Array.isArray(records) || !config || typeof config !== 'object') return records
  const order = (items, expr) => sort(items, expr, { locale })

  let out = records
  if (typeof config.scope === 'string' && config.scope) out = applyScope(out, config.scope)
  if (config.where) out = matchWhere(config.where, out)
  if (config.sort) out = order(out, config.sort)
  if (isLimit(config.limit)) out = out.slice(0, config.limit)

  const narrow = config.narrow
  if (!narrow || typeof narrow !== 'object') return out
  if (narrow.where) out = matchWhere(narrow.where, out)
  if (narrow.match && typeof narrow.match === 'object') out = out.filter(matching(narrow.match))
  if (narrow.sort) out = order(out, narrow.sort)
  if (isLimit(narrow.limit)) out = out.slice(0, narrow.limit)
  return out
}

/**
 * A resolved config with every FIELD PATH it names mapped — the `where` keys and the `sort` field of
 * its set and of its narrowing — so it can be evaluated over records held in another shape. A static
 * build maps each path to where the record AS STORED holds it (`@uniweb/schemas/conform`'s
 * `storedPath`), which is how the records service reads a path (ruled 2026-09-27
 * [Diego]). A `$` key, and `narrow.match` — which names the record, not a
 * field of it — are kept as they are.
 *
 * @param {Object} config - a resolved config, or a question
 * @param {(path: string) => string} mapPath
 * @returns {Object} a new config; the input is not mutated
 */
export function mapQueryPaths(config, mapPath) {
  if (!config || typeof config !== 'object' || typeof mapPath !== 'function') return config
  const level = (at) => {
    const out = { ...at }
    if (at.where && typeof at.where === 'object') out.where = mapWherePaths(at.where, mapPath)
    const spec = at.sort ? parseSort(at.sort) : null
    if (spec) out.sort = { field: mapPath(spec.field), desc: spec.desc }
    return out
  }
  const out = level(config)
  if (config.narrow && typeof config.narrow === 'object') out.narrow = level(config.narrow)
  return out
}

function mapWherePaths(where, mapPath) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return where
  const out = {}
  for (const [key, value] of Object.entries(where)) {
    if (key === 'and' || key === 'or') out[key] = Array.isArray(value) ? value.map((sub) => mapWherePaths(sub, mapPath)) : value
    else if (key === 'not') out[key] = mapWherePaths(value, mapPath)
    else out[key.startsWith('$') ? key : mapPath(key)] = value
  }
  return out
}

/** A count that cuts: a whole number above 0. Absent, `0` or anything else is every record. */
function isLimit(limit) {
  return typeof limit === 'number' && limit > 0
}

/**
 * A `match` — the record a parametric page's URL names — as a filter: the key is the
 * record field `routeRecordKey` maps a route param to (`$name`, `$uuid`, or the field
 * itself), and its value is compared as a STRING, member-wise on a list
 * (`recordKeyValues`). ⛔ Until 2026-09-27 a key was mapped back to a param name, so a field
 * called `slug` read the record's `$name`.
 */
function matching(match) {
  const entries = Object.entries(match)
  return (record) => entries.every(([key, value]) => {
    const target = String(value)
    return recordKeyValues(record, key).some((held) => held === target)
  })
}
