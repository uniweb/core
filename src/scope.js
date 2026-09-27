/**
 * A query's `scope:` — the folder branch it reads — evaluated over compiled records,
 * which hold their branch.
 *
 * A compiled record holds the folder `records/folder.yml` placed it in under
 * `$branch` (`BRANCH_KEY`, written by `build/src/site/query-processor.js`). A scope
 * contains that folder and every folder below it, at SEGMENT boundaries: `field`
 * holds `field` and `field/2025`, never `fieldwork`. The root (`''`) holds everything.
 *
 * ⛔ A RECORD DOES NOT CARRY ITS BRANCH (ruled 2026-09-27 [Diego]: *"branches are to
 * organize the content pool … queries can filter by branch using `scope`"*). `$branch`
 * is the compiled file's own key, there because the browser evaluates `scope` over that
 * file. `evaluateQuery` reads it and answers no record with it (`withoutBranch`), just as
 * a records service answers none. ⛔ Until then every compiled record carried `path`,
 * which reached components, overwrote an authored field named `path`, and made a
 * `[...path]` record's link `<branch>/<name>`.
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

/**
 * The key a compiled record holds its branch under. The static lane's store only; no
 * answer carries it.
 */
export const BRANCH_KEY = '$branch'

/**
 * Records as a query answers them: without the branch their compiled file holds. A list
 * in which no record holds one is returned as it is.
 *
 * @param {Array<Object>} records
 * @returns {Array<Object>}
 */
export function withoutBranch(records) {
  if (!Array.isArray(records)) return records
  if (!records.some((r) => r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, BRANCH_KEY))) {
    return records
  }
  return records.map((r) => {
    if (!r || typeof r !== 'object' || !Object.prototype.hasOwnProperty.call(r, BRANCH_KEY)) return r
    const { [BRANCH_KEY]: _branch, ...rest } = r
    return rest
  })
}

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
 * @param {*} placement - a compiled record's branch (`BRANCH_KEY`)
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
  return records.filter((r) => r && typeof r === 'object' && withinScope(r[BRANCH_KEY], scope))
}
