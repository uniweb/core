/**
 * strapi — Strapi v4 REST API query style.
 *
 * GET-only. Encodes a full where-object into Strapi's bracket-notation
 * filters:
 *
 *   where: { dept: 'biology' }
 *     → filters[dept][$eq]=biology
 *
 *   where: { age: { gte: 18 } }
 *     → filters[age][$gte]=18
 *
 *   where: { 'tenure.start': { gte: 2015 } }
 *     → filters[tenure][start][$gte]=2015
 *
 *   where: { or: [{ a: 1 }, { b: 2 }] }
 *     → filters[$or][0][a][$eq]=1 & filters[$or][1][b][$eq]=2
 *
 *   where: { not: { dept: 'emeritus' } }
 *     → filters[$not][dept][$eq]=emeritus
 *
 *   limit: 10
 *     → pagination[limit]=10
 *
 *   sort: 'date desc'
 *     → sort=date:desc
 *
 *   sort: 'date desc, title asc'
 *     → sort[0]=date:desc & sort[1]=title:asc
 *
 * Response envelope defaults to `{ collection: 'data', item: 'data' }` —
 * Strapi v4 wraps every response in `{ data, meta }`. Sites can override
 * via `envelope:` at the site or per-fetch level.
 *
 * Operators mapped (where-object → Strapi `$op`):
 *   eq, ne, gt, gte, lt, lte, in, nin → notIn, like → containsi,
 *   exists → notNull, and → $and, or → $or, not → $not.
 *
 * For operators the where-object supports but Strapi doesn't have a
 * clean equivalent for, the style leaves them untouched (the default
 * fetcher applies them as a runtime fallback).
 */

export const strapi = {
  name: 'strapi',
  canPush: new Set(['where', 'limit', 'sort']),
  defaultEnvelope: { collection: 'data', item: 'data' },

  encode(request, { method, pushCandidates, rename }) {
    const pushed = new Set()
    const queryParams = []

    if (method !== 'GET') {
      // Strapi v4 REST is GET-only for reads.
      return { queryParams, bodyMerge: null, pushed }
    }

    if (pushCandidates.has('where') && request.where !== undefined) {
      const filterKey = wireName('where', 'filters', rename)
      const pairs = encodeStrapiFilters(request.where, filterKey)
      if (pairs !== null) {
        for (const pair of pairs) queryParams.push(pair)
        pushed.add('where')
      }
    }

    if (pushCandidates.has('limit') && request.limit !== undefined) {
      const limitKey = wireName('limit', 'pagination[limit]', rename)
      queryParams.push([limitKey, String(request.limit)])
      pushed.add('limit')
    }

    if (pushCandidates.has('sort') && request.sort !== undefined) {
      const sortPairs = encodeStrapiSort(request.sort, wireName('sort', 'sort', rename))
      if (sortPairs !== null) {
        for (const pair of sortPairs) queryParams.push(pair)
        pushed.add('sort')
      }
    }

    return { queryParams, bodyMerge: null, pushed }
  },
}

// ─── where encoding ────────────────────────────────────────────────────────

// Values are the Strapi operator *with* bracket delimiters, so they
// concatenate cleanly into a bracketed path like `filters[field][$eq]`.
const OPERATOR_MAP = {
  eq: '[$eq]',
  ne: '[$ne]',
  gt: '[$gt]',
  gte: '[$gte]',
  lt: '[$lt]',
  lte: '[$lte]',
  in: '[$in]',
  nin: '[$notIn]',
  like: '[$containsi]',    // case-insensitive substring — closest Strapi analog
  exists: '[$notNull]',    // overridden below for exists:false → [$null]
}

/**
 * Walk a where-object and emit [paramName, paramValue] pairs encoding
 * Strapi's bracket syntax. Returns null if any branch is unencodable
 * (caller falls back to runtime evaluation for the whole predicate).
 */
function encodeStrapiFilters(where, rootKey) {
  const out = []
  try {
    walkPredicate(where, [rootKey], out)
  } catch (err) {
    if (err && err.unencodable) return null
    throw err
  }
  return out.length > 0 ? out : null
}

function walkPredicate(node, path, out) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throwUnencodable()
  }

  // Top-level each key is either composition ($and/$or/$not) or a field.
  for (const [key, value] of Object.entries(node)) {
    if (key === 'and' || key === 'or') {
      if (!Array.isArray(value)) throwUnencodable()
      value.forEach((sub, i) => {
        walkPredicate(sub, [...path, `[$${key}]`, `[${i}]`], out)
      })
    } else if (key === 'not') {
      walkPredicate(value, [...path, '[$not]'], out)
    } else {
      emitFieldPredicate(key, value, path, out)
    }
  }
}

function emitFieldPredicate(field, value, path, out) {
  // Dotted paths become nested bracket segments: `tenure.start` →
  // `[tenure][start]`.
  const fieldSegments = field.split('.').map((seg) => `[${seg}]`)
  const fieldPath = [...path, ...fieldSegments]

  // Bare primitive → implicit eq.
  if (isPrimitive(value)) {
    out.push([joinPath(fieldPath) + '[$eq]', stringifyPrimitive(value)])
    return
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [opName, opValue] of Object.entries(value)) {
      const strapiOp = OPERATOR_MAP[opName]
      if (!strapiOp) throwUnencodable()

      if (opName === 'in' || opName === 'nin') {
        if (!Array.isArray(opValue)) throwUnencodable()
        opValue.forEach((item, i) => {
          if (!isPrimitive(item)) throwUnencodable()
          out.push([joinPath(fieldPath) + strapiOp + `[${i}]`, stringifyPrimitive(item)])
        })
        continue
      }

      if (opName === 'exists') {
        // { exists: true }  → field IS NOT NULL  → [field][$notNull]=true
        // { exists: false } → field IS NULL      → [field][$null]=true
        const wantsPresent = !!opValue
        out.push([joinPath(fieldPath) + (wantsPresent ? '[$notNull]' : '[$null]'), 'true'])
        continue
      }

      if (!isPrimitive(opValue)) throwUnencodable()
      out.push([joinPath(fieldPath) + strapiOp, stringifyPrimitive(opValue)])
    }
    return
  }

  throwUnencodable()
}

function joinPath(segments) {
  return segments.join('')
}

function throwUnencodable() {
  const err = new Error('unencodable predicate')
  err.unencodable = true
  throw err
}

// ─── sort encoding ─────────────────────────────────────────────────────────

function encodeStrapiSort(sortExpr, baseKey) {
  if (typeof sortExpr !== 'string' || sortExpr.length === 0) return null
  const parts = sortExpr.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const encoded = []
  for (const part of parts) {
    const [field, dirRaw] = part.split(/\s+/)
    if (!field) return null
    const dir = (dirRaw || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
    encoded.push(`${field}:${dir}`)
  }

  if (encoded.length === 1) {
    return [[baseKey, encoded[0]]]
  }
  return encoded.map((v, i) => [`${baseKey}[${i}]`, v])
}

// ─── helpers ───────────────────────────────────────────────────────────────

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

export default strapi
