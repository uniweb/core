/**
 * flat-query — plain URL query-string style.
 *
 * GET-only. Operators become bare query params:
 *
 *   ?limit=10
 *   ?sort=-date                  (single-key, "-" prefix for desc)
 *   ?sort=-date,title            (multi-key, comma-separated)
 *   ?dept=biology&tenured=true   (where, flat AND of equalities only)
 *
 * The `where:` operator is pushed **only** when the predicate is a flat
 * AND of equalities on top-level fields. Nested operator objects
 * (`{ age: { gte: 18 } }`), composition (`and` / `or` / `not`), and
 * dotted field paths disqualify pushdown — the wire format can't
 * express them. In those cases flat-query silently skips `where`, and
 * the default fetcher applies it as a runtime fallback after the
 * response arrives. This is the documented trade-off for the style's
 * simplicity: flat-query fits simple REST APIs; richer queries either
 * evaluate client-side or pick a different style.
 *
 * POST requests encode nothing — flat-query is a URL-params shape and
 * has no meaningful POST representation.
 *
 * Use case: public REST APIs like `?dept=biology&limit=10&sort=-date`.
 * For GraphQL or body-shaped backends, use json-body. For Strapi v4,
 * use the strapi style.
 */

export const flatQuery = {
  name: 'flat-query',
  canPush: new Set(['where', 'limit', 'sort']),
  defaultEnvelope: null,

  encode(request, { method, pushCandidates, rename }) {
    const pushed = new Set()
    const queryParams = []

    if (method !== 'GET') {
      // POST has no flat-query representation; silent no-op.
      return { queryParams, bodyMerge: null, pushed }
    }

    // where — only flat AND of equalities.
    if (pushCandidates.has('where') && request.where !== undefined) {
      const pairs = encodeFlatEqualities(request.where)
      if (pairs !== null) {
        for (const [k, v] of pairs) queryParams.push([applyRename(k, rename), v])
        pushed.add('where')
      }
    }

    if (pushCandidates.has('limit') && request.limit !== undefined) {
      queryParams.push([wireName('limit', 'limit', rename), String(request.limit)])
      pushed.add('limit')
    }

    if (pushCandidates.has('sort') && request.sort !== undefined) {
      const encoded = encodeSort(request.sort)
      if (encoded !== null) {
        queryParams.push([wireName('sort', 'sort', rename), encoded])
        pushed.add('sort')
      }
    }

    return { queryParams, bodyMerge: null, pushed }
  },
}

/**
 * Encode a where-object as flat [field, value] pairs. Returns null when
 * the predicate doesn't fit the flat-AND-equalities shape — caller
 * falls back to runtime evaluation.
 */
function encodeFlatEqualities(where) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return null
  const out = []
  for (const [key, raw] of Object.entries(where)) {
    // Composition and operator shorthand disqualify the whole predicate.
    if (key === 'and' || key === 'or' || key === 'not') return null
    if (key.includes('.')) return null // dotted path — flat-query can't express nesting

    // Bare primitive → implicit equality.
    if (isPrimitive(raw)) {
      out.push([key, stringifyPrimitive(raw)])
      continue
    }

    // { eq: primitive } → equality. Anything else disqualifies.
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const opKeys = Object.keys(raw)
      if (opKeys.length === 1 && opKeys[0] === 'eq' && isPrimitive(raw.eq)) {
        out.push([key, stringifyPrimitive(raw.eq)])
        continue
      }
    }

    return null
  }
  return out
}

/**
 * Encode `sort: 'date desc'` → `-date`; `sort: 'date desc, title asc'` →
 * `-date,title`. Returns null on malformed input (caller falls back).
 */
function encodeSort(sortExpr) {
  if (typeof sortExpr !== 'string' || sortExpr.length === 0) return null
  const parts = sortExpr.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const encoded = []
  for (const part of parts) {
    const [field, dirRaw] = part.split(/\s+/)
    if (!field) return null
    const desc = (dirRaw || 'asc').toLowerCase() === 'desc'
    encoded.push(desc ? `-${field}` : field)
  }
  return encoded.join(',')
}

function isPrimitive(value) {
  if (value === null) return true
  const t = typeof value
  return t === 'string' || t === 'number' || t === 'boolean'
}

function stringifyPrimitive(value) {
  if (value === null) return ''
  return String(value)
}

function wireName(operator, defaultWire, rename) {
  if (rename && typeof rename[operator] === 'string' && rename[operator].length > 0) {
    return rename[operator]
  }
  return defaultWire
}

// `rename` on flat-query's where pushdown doesn't apply to individual
// field names — authors who need `dept → department` should write
// their where-objects with the backend's field name directly. rename
// remains available for `limit` and `sort` wire names.
function applyRename(fieldName, _rename) {
  return fieldName
}

export default flatQuery
