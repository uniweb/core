/**
 * Sort — ONE evaluator for a query's `sort:`, and the wire spelling it becomes.
 *
 * ⛔ SINGLE-KEY, BY RULING [Diego, 2026-09-04]: "I don't think we need multi-key
 * sorting. We can drop that." Until this module existed `sort:` had THREE
 * evaluators — the build's `applySort`, the runtime fetcher's fallback, and the
 * entity store's refine-order sort — and two of them split on commas and honoured
 * several keys while the one shipped wire dialect documented the same, so a site
 * authoring `sort: order asc, title asc` worked on the static lane and would have
 * been refused by the records service, which takes one key. The language is the
 * INTERSECTION of what both lanes honour, so a comma is refused here rather than
 * half-honoured somewhere.
 *
 * Author spelling, unchanged: `date`, `date asc`, `date desc`. The records service's
 * spelling is `date` / `-date`; `-date` is accepted on the way in so a value that
 * came off the wire round-trips, and `sortToWire` produces it on the way out.
 *
 * Dotted paths descend into nested objects (`tenure.start`) — kept, like the
 * predicate evaluator's.
 *
 * Zero-dependency beyond the `field-path.js` leaf: `@uniweb/build` reads it to materialize `/data/<name>.json`
 * and `@uniweb/runtime` reads it as the fallback over a fetched array, so the two
 * lanes cannot drift on the one thing a conformance test would otherwise have to
 * catch by luck.
 */

import { fieldPathProblem } from './field-path.js'

/**
 * Parse an authored `sort:` into `{ field, desc }`.
 *
 * Throws on a comma (multi-key) and on a direction word that is neither `asc`
 * nor `desc`, because both were silently mis-honoured before: the extra keys
 * were sorted by on one lane and ignored on another, and an unknown direction
 * sorted ascending. A query with a wrong `sort:` should fail where it is written.
 *
 * @param {string|{field:string, desc?:boolean}|null|undefined} sort
 * @returns {{ field: string, desc: boolean } | null}
 */
export function parseSort(sort) {
  if (sort === undefined || sort === null || sort === '') return null
  if (typeof sort === 'object') {
    if (typeof sort.field !== 'string' || sort.field.length === 0) return null
    refuseFieldPath(sort.field, sort.field)
    return { field: sort.field, desc: sort.desc === true }
  }
  const text = String(sort).trim()
  if (!text) return null
  if (text.includes(',')) {
    throw new Error(
      `[uniweb] sort: "${text}" names more than one key. A query sorts by ONE key ` +
        `(\`sort: date desc\`); multi-key sorting is not supported on either lane.`
    )
  }
  if (text.startsWith('-')) {
    const field = text.slice(1).trim()
    if (!field || /\s/.test(field)) throw new Error(`[uniweb] sort: "${text}" is not a field name.`)
    refuseFieldPath(field, text)
    return { field, desc: true }
  }
  const parts = text.split(/\s+/)
  if (parts.length > 2) {
    throw new Error(`[uniweb] sort: "${text}" is not \`<field>\` or \`<field> asc|desc\`.`)
  }
  const [field, dir] = parts
  const lower = dir ? dir.toLowerCase() : 'asc'
  if (lower !== 'asc' && lower !== 'desc') {
    throw new Error(`[uniweb] sort: "${text}" — direction must be \`asc\` or \`desc\`, not "${dir}".`)
  }
  refuseFieldPath(field, text)
  return { field, desc: lower === 'desc' }
}

/** A sort field outside the language is refused where it is written (`field-path.js`). */
function refuseFieldPath(field, text) {
  const problem = fieldPathProblem(field)
  if (problem) throw new Error(`[uniweb] sort: "${text}" — ${problem}.`)
}

/**
 * The service's spelling of a sort: `date` ascending, `-date` descending.
 *
 * @param {string|{field:string, desc?:boolean}|null|undefined} sort
 * @returns {string|null}
 */
export function sortToWire(sort) {
  const spec = parseSort(sort)
  if (!spec) return null
  return spec.desc ? `-${spec.field}` : spec.field
}

/**
 * Sort records by one key. Returns a new array; the input is not mutated.
 *
 * ⭐ TEXT SORTS BY THE COLLATION OF THE PAGE'S LOCALE — ruled 2026-09-14 [Diego]: *"collation
 * in the page's locale is the correct answer."* So `apple` sorts before `Banana`, and
 * `Álvarez` before `Zamora` on a Spanish page, the way a reader of that language expects;
 * the records service collates in the question's locale. The collation is the locale's
 * default, with no options: no numeric ordering (`item 10` before `item 2`), and case and
 * accents only break ties between the same letters. ⛔ Until then a text compared with
 * `localeCompare` and no locale — the JavaScript runtime's own — so a browser and a host's
 * prerender could order one list differently. With no locale, or one the runtime cannot
 * collate, `en` stands in: the CLDR root order, which English does not tailor.
 * Numbers, ISO dates and booleans compare as values.
 *
 * ⭐ A RECORD WITH NO VALUE FOR THE KEY SORTS LAST, IN EITHER DIRECTION, and records
 * that compare equal keep their order — the language both lanes answer (as a host's
 * records service answers it since 2026-09-13). "No value" is what `exists: false` means: missing, `null`, `""` — and a
 * list, since nothing says which member orders the record (a dotted path that meets
 * a list reads no value). ⛔ Until 2026-09-14 a missing value sorted as the empty
 * string — first ascending, last descending — so a static site and a hosted one put
 * the same records in different places.
 *
 * @param {Array<Object>} items
 * @param {string|{field:string, desc?:boolean}|null|undefined} sort
 * @param {Object} [options]
 * @param {string|null} [options.locale] - the page's locale, which texts are collated in
 * @returns {Array<Object>}
 */
export function sortRecords(items, sort, { locale = null } = {}) {
  const spec = parseSort(sort)
  if (!spec || !Array.isArray(items) || items.length === 0) return items
  const { field, desc } = spec
  const collate = collatorFor(locale)
  const compareValues = (a, b) => compareValuesIn(a, b, collate)
  return [...items].sort((a, b) => {
    const av = readPath(a, field)
    const bv = readPath(b, field)
    const aNone = !hasSortValue(av)
    const bNone = !hasSortValue(bv)
    // Last in either direction — so this is decided before `desc` flips anything.
    if (aNone || bNone) return aNone === bNone ? 0 : (aNone ? 1 : -1)
    return desc ? -compareValues(av, bv) : compareValues(av, bv)
  })
}

/** A value a record can be ordered by: not missing, `null`, `""` or a list. */
function hasSortValue(v) {
  if (v === undefined || v === null || v === '') return false
  return !Array.isArray(v)
}

/**
 * ⭐ TWO KINDS IN ONE FIELD ARE ORDERED BY KIND, THEN WITHIN THE KIND — booleans,
 * numbers, texts, then anything else — the records service's comparator, stated by
 * backend on 2026-09-14. A total order, so a sort never fails; `where` still holds no
 * comparison across kinds. ⛔ Until then `<` / `>` coerced a number against a text.
 *
 * Two texts compare with `collate` — the page's locale (`sortRecords`).
 */
function compareValuesIn(a, b, collate) {
  const ka = kindRank(a)
  const kb = kindRank(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  if (typeof a === 'string') return collate(a, b)
  if (ka === KIND_OTHER) return 0
  return a > b ? 1 : a < b ? -1 : 0
}

/** One `Intl.Collator` per locale, made on first use. */
const collators = new Map()
const FALLBACK_LOCALE = 'en'

function collatorFor(locale) {
  const wanted = typeof locale === 'string' && locale ? locale : FALLBACK_LOCALE
  let compare = collators.get(wanted)
  if (!compare) {
    let collator
    try {
      collator = new Intl.Collator(wanted)
    } catch {
      // A tag the runtime cannot collate in (malformed, or unknown to its ICU data).
      collator = new Intl.Collator(FALLBACK_LOCALE)
    }
    compare = collator.compare
    collators.set(wanted, compare)
  }
  return compare
}

const KIND_OTHER = 3

function kindRank(v) {
  if (typeof v === 'boolean') return 0
  if (typeof v === 'number') return 1
  if (typeof v === 'string') return 2
  return KIND_OTHER
}

function readPath(record, path) {
  if (!record || typeof record !== 'object') return undefined
  if (path.indexOf('.') === -1) return record[path]
  let cursor = record
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = cursor[segment]
  }
  return cursor
}
