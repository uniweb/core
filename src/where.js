/**
 * Where-object evaluator.
 *
 * A where-object is a structured JSON predicate. The format is small,
 * additive, and YAML/JSON-native — there is no DSL or parser. The same
 * predicate travels from author YAML, through transports, to backends
 * (which translate to their native query language) or to this evaluator
 * (which walks the object against a record).
 *
 * Architecture: see kb/framework/architecture/data-fetching.md.
 *
 * Shape:
 *
 *   {
 *     // Top-level keys are field names; values are the values to match.
 *     // Implicit AND across keys.
 *     department: 'biology',
 *     tenured: true,
 *
 *     // For non-equality, the value is an operator object.
 *     start_year: { gte: 2010 },
 *     rank: { in: ['associate', 'full'] },
 *     title: { like: 'Origin*' },
 *
 *     // Explicit composition keys at any nesting level.
 *     and: [{ tenured: true }, { rank: 'full' }],
 *     or:  [{ rank: 'full' }, { years_in_role: { gte: 10 } }],
 *     not: { department: 'emeritus' },
 *   }
 *
 * Operators (in operator-object form):
 *
 *   eq      Equal (also implicit when the value is bare, non-object, non-null).
 *   ne      Not equal.
 *   gt/gte  Greater than / greater than or equal.
 *   lt/lte  Less than / less than or equal.
 *   in      Value is in the listed array.
 *   nin     Value is not in the listed array.
 *   like    Glob match (`*` any run, `?` one char). String fields only.
 *   exists  Field is truthy (boolean toggle).
 *
 * Composition keys:
 *
 *   and     Array of sub-predicates; all must match.
 *   or      Array of sub-predicates; at least one must match.
 *   not     Single sub-predicate; must not match.
 *
 * Dotted paths descend into nested objects: `tenure.start: { gte: 2015 }`.
 *
 * Type safety: type mismatches return `false` rather than throwing
 * (e.g., comparing a string to a number with `gt`). Missing fields
 * return `false` for equality and most operators; `exists: false` matches
 * missing/falsy fields.
 */

const COMPOSITION_KEYS = new Set(['and', 'or', 'not'])
const OPERATORS = new Set([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'like', 'exists',
])

/**
 * Evaluate a where-object against a single record.
 *
 * @param {Object} where - The where-object predicate.
 * @param {Object} record - The record to test.
 * @returns {boolean} true if the record matches.
 */
export function evaluate(where, record) {
  if (where == null) return true
  if (typeof where !== 'object' || Array.isArray(where)) return false
  if (record == null || typeof record !== 'object') return false

  // Implicit AND across all top-level keys.
  for (const key of Object.keys(where)) {
    if (!evaluateClause(key, where[key], record)) return false
  }
  return true
}

/**
 * Filter an array of records by a where-object predicate.
 *
 * @param {Object} where - The where-object predicate.
 * @param {Array<Object>} records - The records to filter.
 * @returns {Array<Object>} Records in source order for which the predicate is true.
 */
export function match(where, records) {
  if (!Array.isArray(records)) return []
  if (where == null) return records.slice()
  return records.filter((r) => evaluate(where, r))
}

// ─── Internals ────────────────────────────────────────────────────

function evaluateClause(key, value, record) {
  // Composition keys.
  if (key === 'and') {
    if (!Array.isArray(value)) return false
    return value.every((sub) => evaluate(sub, record))
  }
  if (key === 'or') {
    if (!Array.isArray(value)) return false
    return value.some((sub) => evaluate(sub, record))
  }
  if (key === 'not') {
    return !evaluate(value, record)
  }

  // Field clause: key is a (possibly dotted) field name; value is either
  // a bare value (implicit eq) or an operator-object.
  const fieldValue = getPath(record, key)

  if (value === null) {
    return fieldValue === null || fieldValue === undefined
  }

  if (typeof value === 'object' && !Array.isArray(value) && isOperatorObject(value)) {
    return evaluateOperatorObject(value, fieldValue)
  }

  // Bare value (string, number, boolean, array): implicit equality.
  return matchEqual(fieldValue, value)
}

function isOperatorObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  // An operator-object's keys are all in OPERATORS. If even one key isn't
  // an operator, it's not an operator-object — it might be a nested
  // sub-predicate or a structured equality target. The latter is rare;
  // we treat any object whose keys are all known operators as an
  // operator-object, otherwise fall back to deep-equality matching.
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  return keys.every((k) => OPERATORS.has(k))
}

function evaluateOperatorObject(opObject, fieldValue) {
  for (const op of Object.keys(opObject)) {
    if (!evaluateOperator(op, opObject[op], fieldValue)) return false
  }
  return true
}

function evaluateOperator(op, opValue, fieldValue) {
  switch (op) {
    case 'eq':
      return matchEqual(fieldValue, opValue)
    case 'ne':
      return !matchEqual(fieldValue, opValue)
    case 'gt':
      return compareCanRun(fieldValue, opValue) && fieldValue > opValue
    case 'gte':
      return compareCanRun(fieldValue, opValue) && fieldValue >= opValue
    case 'lt':
      return compareCanRun(fieldValue, opValue) && fieldValue < opValue
    case 'lte':
      return compareCanRun(fieldValue, opValue) && fieldValue <= opValue
    case 'in':
      if (!Array.isArray(opValue)) return false
      return opValue.some((v) => matchEqual(fieldValue, v))
    case 'nin':
      if (!Array.isArray(opValue)) return false
      return !opValue.some((v) => matchEqual(fieldValue, v))
    case 'like':
      if (typeof fieldValue !== 'string' || typeof opValue !== 'string') return false
      return globMatch(opValue, fieldValue)
    case 'exists':
      return Boolean(fieldValue) === Boolean(opValue)
    default:
      // Unknown operator → fail closed.
      return false
  }
}

function matchEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  // Array-on-either-side: if `a` is an array (record's field), match if
  // any element equals b. This makes `tags: 'featured'` match a record
  // with `tags: ['featured', 'sale']`.
  if (Array.isArray(a) && !Array.isArray(b)) {
    return a.some((v) => v === b)
  }
  if (typeof a === 'object' || typeof b === 'object') {
    // No deep equality for objects in v1 — keep the surface narrow.
    return false
  }
  return false
}

function compareCanRun(a, b) {
  if (a == null || b == null) return false
  // Numbers and ISO-date strings (which compare correctly with </>=) are fine.
  // Mixed types (string vs number) are a mismatch — return false rather
  // than coerce.
  return typeof a === typeof b
}

function getPath(record, path) {
  if (typeof path !== 'string') return undefined
  if (path.indexOf('.') === -1) return record[path]
  let cursor = record
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/**
 * Shell-glob match: `*` matches any run of characters, `?` matches one char.
 * Anchored — the pattern must match the whole string.
 */
function globMatch(pattern, value) {
  // Translate to a RegExp with anchors. Escape regex metacharacters
  // except for our wildcards.
  const re = '^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    + '$'
  return new RegExp(re).test(value)
}
