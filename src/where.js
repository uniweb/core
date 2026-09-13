/**
 * Where-object evaluator.
 *
 * A where-object is a structured JSON predicate. The format is small,
 * additive, and YAML/JSON-native — there is no DSL or parser. The same
 * predicate travels from author YAML, through transports, to backends
 * (which translate to their native query language) or to this evaluator
 * (which walks the object against a record).
 *
 * ⭐ ONE LANGUAGE, ONE MEANING PER OPERATOR, on every lane. A compiled site
 * evaluates a query here; a host that answers queries evaluates the same
 * language at the source. The set below is the language ruled on 2026-09-13
 * [Diego] for a stored query and a question alike, so a query answers the same
 * wherever it is asked. ⛔ Until then this evaluator had `like` and `nin` and none
 * of `contains`, `starts_with`, `ends_with`, and it read `exists`, comparisons on
 * a list and an empty `and` differently (measured).
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
 *     title: { starts_with: 'the' },
 *
 *     // Explicit composition keys at any nesting level.
 *     and: [{ tenured: true }, { rank: 'full' }],
 *     or:  [{ rank: 'full' }, { years_in_role: { gte: 10 } }],
 *     not: { department: 'emeritus' },
 *   }
 *
 * Operators (in operator-object form):
 *
 *   eq            Equal (also implicit when the value is bare).
 *   ne            Not equal.
 *   gt/gte        Greater than / greater than or equal.
 *   lt/lte        Less than / less than or equal.
 *   in            Equal to one of the listed values.
 *   not_in        Equal to none of the listed values.
 *   exists        `true`: the field has a value — not missing, null, "" or [].
 *                 `false`: it has none.
 *   contains      On a list, holds an item equal to the value; on a text, holds
 *                 the value as a piece of it (plain text, case-insensitive).
 *   starts_with   A text that starts with the value (plain text, case-insensitive).
 *   ends_with     A text that ends with the value (plain text, case-insensitive).
 *
 * Composition keys:
 *
 *   and     A non-empty list of sub-predicates; all must match.
 *   or      A non-empty list of sub-predicates; at least one must match.
 *   not     One sub-predicate; must not match.
 *
 * ⭐ A LIST FIELD (`tags: ['news', 'rust']`) holds a condition when ANY member
 * satisfies it: `tags: news` has `news`, `ne: news` does not have it, `not_in`
 * has none of the values, a comparison holds for some member. Values stay typed:
 * `'3'` does not equal `3`. A field a record has no value for satisfies `ne`,
 * `not_in` and `exists: false`, and nothing else.
 *
 * ⛔ A WHERE OUTSIDE THE LANGUAGE SELECTS NO RECORDS — an unknown or retired
 * operator (`like`, `nin`, `under`), an empty `and` / `or`, a text operator with an
 * empty argument. It never falls back to a wider answer. `whereOutsideLanguage`
 * says why, so a producer can refuse the declaration where the author wrote it.
 *
 * Dotted paths descend into nested objects: `tenure.start: { gte: 2015 }`. ⭐ A
 * path that meets a list descends into each item, and the values it reaches are
 * read as a list field — so `education.degree: PhD` matches a record any of whose
 * `education` entries has that degree. (Kept on this lane by ruling 2026-09-13
 * [Diego]; a host's records service may not answer them.)
 */

const OPERATORS = new Set([
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'exists', 'contains', 'starts_with', 'ends_with',
])

/** Retired spellings, each with the sentence that names its replacement. */
const RETIRED_OPERATORS = {
  nin: '`nin` is spelled `not_in`',
  like: '`like` is retired — use `starts_with`, `ends_with` or `contains`',
  under: '`under` is retired — a folder branch is `scope:`',
}

/**
 * Why a where-object is outside the language, or null when it is inside.
 *
 * @param {*} where
 * @returns {string|null} the first problem found, as a sentence
 */
export function whereOutsideLanguage(where) {
  if (where == null) return null
  if (typeof where !== 'object' || Array.isArray(where)) return 'a where is an object of conditions'
  for (const [key, value] of Object.entries(where)) {
    const problem = clauseProblem(key, value)
    if (problem) return problem
  }
  return null
}

/**
 * Evaluate a where-object against a single record.
 *
 * @param {Object} where - The where-object predicate.
 * @param {Object} record - The record to test.
 * @returns {boolean} true if the record matches; false for a where outside the language.
 */
export function evaluate(where, record) {
  if (where == null) return true
  if (whereOutsideLanguage(where)) return false
  return test(where, record)
}

/**
 * Filter an array of records by a where-object predicate.
 *
 * @param {Object} where - The where-object predicate.
 * @param {Array<Object>} records - The records to filter.
 * @returns {Array<Object>} Records in source order for which the predicate is true;
 *   none for a where outside the language.
 */
export function match(where, records) {
  if (!Array.isArray(records)) return []
  if (where == null) return records.slice()
  if (whereOutsideLanguage(where)) return []
  return records.filter((r) => test(where, r))
}

// ─── Internals ────────────────────────────────────────────────────

function clauseProblem(key, value) {
  if (key === 'and' || key === 'or') {
    if (!Array.isArray(value) || value.length === 0) return `\`${key}\` takes a non-empty list of conditions`
    for (const sub of value) {
      const problem = sub && typeof sub === 'object' && !Array.isArray(sub)
        ? whereOutsideLanguage(sub)
        : `each item of \`${key}\` is an object of conditions`
      if (problem) return problem
    }
    return null
  }
  if (key === 'not') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '`not` takes one object of conditions'
    return whereOutsideLanguage(value)
  }
  // A field clause: a bare value, null, or an operator object.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const ops = Object.keys(value)
  if (ops.length === 0) return `the condition on \`${key}\` is empty`
  for (const op of ops) {
    if (RETIRED_OPERATORS[op]) return RETIRED_OPERATORS[op]
    if (!OPERATORS.has(op)) return `\`${op}\` (on \`${key}\`) is not an operator`
    const arg = value[op]
    if ((op === 'in' || op === 'not_in') && !Array.isArray(arg)) return `\`${op}\` takes a list of values`
    if (op === 'exists' && typeof arg !== 'boolean') return '`exists` takes true or false'
    if ((op === 'starts_with' || op === 'ends_with') && (typeof arg !== 'string' || arg === '')) {
      return `\`${op}\` takes non-empty text`
    }
    if (op === 'contains' && arg === '') return '`contains` takes a value that is not empty text'
  }
  return null
}

function test(where, record) {
  if (record == null || typeof record !== 'object') return false
  for (const key of Object.keys(where)) {
    if (!testClause(key, where[key], record)) return false
  }
  return true
}

function testClause(key, value, record) {
  if (key === 'and') return value.every((sub) => test(sub, record))
  if (key === 'or') return value.some((sub) => test(sub, record))
  if (key === 'not') return !test(value, record)

  const fieldValue = getPath(record, key)
  if (value === null) return fieldValue === null || fieldValue === undefined
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const op of Object.keys(value)) {
      if (!testOperator(op, value[op], fieldValue)) return false
    }
    return true
  }
  // Bare value: implicit equality.
  return equals(fieldValue, value)
}

function testOperator(op, arg, fieldValue) {
  switch (op) {
    case 'eq':
      return equals(fieldValue, arg)
    case 'ne':
      return !equals(fieldValue, arg)
    case 'gt':
      return someMember(fieldValue, (v) => comparable(v, arg) && v > arg)
    case 'gte':
      return someMember(fieldValue, (v) => comparable(v, arg) && v >= arg)
    case 'lt':
      return someMember(fieldValue, (v) => comparable(v, arg) && v < arg)
    case 'lte':
      return someMember(fieldValue, (v) => comparable(v, arg) && v <= arg)
    case 'in':
      return arg.some((a) => equals(fieldValue, a))
    case 'not_in':
      return !arg.some((a) => equals(fieldValue, a))
    case 'exists':
      return hasValue(fieldValue) === arg
    case 'contains':
      if (Array.isArray(fieldValue)) return fieldValue.some((v) => v === arg)
      if (typeof fieldValue === 'string' && typeof arg === 'string') {
        return fieldValue.toLowerCase().includes(arg.toLowerCase())
      }
      return false
    case 'starts_with':
      return someMember(fieldValue, (v) => typeof v === 'string' && v.toLowerCase().startsWith(arg.toLowerCase()))
    case 'ends_with':
      return someMember(fieldValue, (v) => typeof v === 'string' && v.toLowerCase().endsWith(arg.toLowerCase()))
    default:
      return false
  }
}

/** Equality, typed; a list field equals a value when any member does. */
function equals(fieldValue, arg) {
  if (Array.isArray(fieldValue)) return fieldValue.some((v) => v === arg)
  return fieldValue === arg
}

/** A condition on a value, or on any member when the field holds a list. */
function someMember(fieldValue, predicate) {
  if (Array.isArray(fieldValue)) return fieldValue.some(predicate)
  return predicate(fieldValue)
}

/** Numbers with numbers, text with text (ISO dates compare as text); nothing else. */
function comparable(a, b) {
  if (a == null || b == null) return false
  return typeof a === typeof b && typeof a !== 'object'
}

/** Not missing, null, "" or []. `0` and `false` are values. */
function hasValue(v) {
  if (v === undefined || v === null || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

/**
 * The value at a (possibly dotted) path. A path that meets a list before it ends
 * descends into each item, and returns the values it reached as one list.
 */
function getPath(record, path) {
  if (typeof path !== 'string') return undefined
  if (path.indexOf('.') === -1) return record[path]
  let current = [record]
  let throughList = false
  for (const segment of path.split('.')) {
    const next = []
    for (const node of current) {
      if (node == null || typeof node !== 'object') continue
      if (Array.isArray(node)) {
        throughList = true
        for (const item of node) {
          if (item != null && typeof item === 'object' && !Array.isArray(item)) next.push(item[segment])
        }
      } else {
        next.push(node[segment])
      }
    }
    current = next
  }
  if (!throughList) return current[0]
  const reached = []
  for (const v of current) {
    if (v === undefined) continue
    if (Array.isArray(v)) reached.push(...v)
    else reached.push(v)
  }
  return reached
}
