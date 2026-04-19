/**
 * json-body — the framework's general-purpose request style.
 *
 * Ambient default when the site doesn't pick a style. Speaks the
 * framework's own conventions:
 *
 *   GET   — operators travel as URL params prefixed with underscore:
 *             ?_where=<JSON.stringify(predicate)>
 *             ?_limit=N
 *             ?_sort=field:dir       (comma-separated for multi-key)
 *           The leading underscore avoids collision with backend-
 *           specific query params the author may have included in `url:`.
 *
 *   POST  — operators merge as top-level keys into an object body,
 *           alongside any author-supplied body. Content-Type defaults
 *           to `application/json` unless the site set a different one.
 *           String POST bodies (rare; typically GraphQL-only) don't
 *           receive operator merge — the string is sent as-is.
 *
 * Operator name renames are applied from the `rename:` map passed in
 * context. Shallow substitutions only — `rename: { limit: pageSize }`
 * swaps the wire name `_limit` → `pageSize` on GET, or the body key
 * `limit` → `pageSize` on POST. The operator identity (what `limit`
 * means in the query) does not change.
 *
 * Internal module. Accessed by `default-fetcher.js` via the registry;
 * never imported directly from outside `@uniweb/runtime`.
 */

export const jsonBody = {
  name: 'json-body',

  // Which operators this style knows how to push. The effective push set
  // is the intersection of this and the site's `supports:` list.
  canPush: new Set(['where', 'limit', 'sort']),

  // Default response envelope. null = no wrapper (a plain JSON payload).
  defaultEnvelope: null,

  /**
   * Encode a request against the json-body conventions.
   *
   * @param {Object} request - The normalized fetch request.
   * @param {Object} ctx
   * @param {'GET'|'POST'} ctx.method - The method the fetcher chose.
   * @param {Set<string>} ctx.pushCandidates - Operators present on the
   *   request AND listed in the site's `supports:`. Style may choose to
   *   push all, some, or none of these based on what it knows how to
   *   express on the wire.
   * @param {Object|null} ctx.rename - Optional { operator → wireName } map.
   * @returns {{
   *   queryParams: Array<[string, string]>,
   *   bodyMerge: Object|null,
   *   pushed: Set<string>,
   * }}
   *   queryParams — pairs appended to the URL's query string.
   *   bodyMerge   — object merged into the POST body, or null.
   *   pushed      — the operators that actually rode on the wire.
   *                 Feeds the fetcher's cache-key derivation and
   *                 runtime-fallback skip.
   */
  encode(request, { method, pushCandidates, rename }) {
    const pushed = new Set()
    const queryParams = []
    let bodyMerge = null

    if (method === 'GET') {
      if (pushCandidates.has('where') && request.where !== undefined) {
        queryParams.push([
          wireName('where', '_where', rename),
          JSON.stringify(request.where),
        ])
        pushed.add('where')
      }
      if (pushCandidates.has('limit') && request.limit !== undefined) {
        queryParams.push([
          wireName('limit', '_limit', rename),
          String(request.limit),
        ])
        pushed.add('limit')
      }
      if (pushCandidates.has('sort') && request.sort !== undefined) {
        queryParams.push([
          wireName('sort', '_sort', rename),
          String(request.sort),
        ])
        pushed.add('sort')
      }
    } else if (method === 'POST') {
      const merged = {}
      if (pushCandidates.has('where') && request.where !== undefined) {
        merged[wireName('where', 'where', rename)] = request.where
        pushed.add('where')
      }
      if (pushCandidates.has('limit') && request.limit !== undefined) {
        merged[wireName('limit', 'limit', rename)] = request.limit
        pushed.add('limit')
      }
      if (pushCandidates.has('sort') && request.sort !== undefined) {
        merged[wireName('sort', 'sort', rename)] = request.sort
        pushed.add('sort')
      }
      if (Object.keys(merged).length > 0) bodyMerge = merged
    }

    return { queryParams, bodyMerge, pushed }
  },
}

function wireName(operator, defaultWire, rename) {
  if (rename && typeof rename[operator] === 'string' && rename[operator].length > 0) {
    return rename[operator]
  }
  return defaultWire
}

export default jsonBody
