/**
 * A query's `scope:` — the folder branch it reads — evaluated over records that
 * carry their placement.
 *
 * A record's `path` is the folder `records.yml` placed it in (`build/src/site/
 * query-processor.js`). A scope contains that folder and every folder below it, at
 * SEGMENT boundaries: `field` holds `field` and `field/2025`, never `fieldwork`.
 * The root (`''`) holds everything.
 *
 * ⭐ Why this is its own field and not a `where` operator: a branch is a scope,
 * and `where` stays the author's predicate over the records' own fields. Ruled
 * 2026-09-11 [Diego], retiring `where: { path: { under } }` — written before a
 * query had `scope:` — together with the `under` operator. The records service
 * takes `scope` natively; this is the same question on the lane that has no
 * service: the compiled file, evaluated by the runtime's default fetcher and by
 * the build that writes the file.
 *
 * Zero-dependency leaf.
 */

function trimSlashes(s) {
  return s.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Is a placement inside a scope?
 *
 * ⛔ The `+ '/'` is the whole point: a plain `startsWith` would put `2024b` inside
 * `2024`, the classic prefix bug, which silently returns records from a sibling
 * folder the author never named.
 *
 * @param {*} placement - a record's `path`
 * @param {string} scope
 * @returns {boolean}
 */
export function withinScope(placement, scope) {
  if (typeof scope !== 'string') return true
  const s = trimSlashes(scope)
  if (s === '') return true
  if (typeof placement !== 'string') return false
  const p = trimSlashes(placement)
  return p === s || p.startsWith(s + '/')
}

/**
 * The records inside a scope, in source order. No scope (or the root) keeps all.
 *
 * @param {Array<Object>} records
 * @param {string|null|undefined} scope
 * @returns {Array<Object>}
 */
export function applyScope(records, scope) {
  if (!Array.isArray(records)) return records
  if (typeof scope !== 'string' || trimSlashes(scope) === '') return records
  return records.filter((r) => r && typeof r === 'object' && withinScope(r.path, scope))
}
