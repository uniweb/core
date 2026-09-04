/**
 * Sort — ONE evaluator for a query's `sort:`, and the wire spelling it becomes.
 *
 * ⛔ SINGLE-KEY, BY RULING [Diego, 2026-09-04]: "I don't think we need multi-key
 * sorting. We can drop that." Until this module existed `sort:` had THREE
 * evaluators — the build's `applySort`, the runtime fetcher's fallback, and the
 * entity store's refine-order sort — and two of them split on commas and honoured
 * several keys while the one shipped wire dialect documented the same, so a site
 * authoring `sort: order asc, title asc` worked on the static lane and would have
 * been refused by the records door, which takes one key. The language is the
 * INTERSECTION of what both lanes honour (`kb/framework/plans/records-query-verdict.md`
 * §5), so a comma is refused here rather than half-honoured somewhere.
 *
 * Author spelling, unchanged: `date`, `date asc`, `date desc`. The records door's
 * spelling is `date` / `-date`; `-date` is accepted on the way in so a value that
 * came off the wire round-trips, and `sortToWire` produces it on the way out.
 *
 * Dotted paths descend into nested objects (`tenure.start`) — kept, like the
 * predicate evaluator's (`kb/framework/open-work.md` P1).
 *
 * Zero-dependency leaf: `@uniweb/build` reads it to materialize `/data/<name>.json`
 * and `@uniweb/runtime` reads it as the fallback over a fetched array, so the two
 * lanes cannot drift on the one thing a conformance test would otherwise have to
 * catch by luck.
 */

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
  return { field, desc: lower === 'desc' }
}

/**
 * The door's spelling of a sort: `date` ascending, `-date` descending.
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
 * Strings compare with `localeCompare` so `apple` sorts before `Banana`; anything
 * else compares with `<`/`>`, which is right for numbers and ISO date strings. A
 * record with no value for the key sorts as the empty string — first ascending,
 * last descending — which is what every previous evaluator did.
 *
 * @param {Array<Object>} items
 * @param {string|{field:string, desc?:boolean}|null|undefined} sort
 * @returns {Array<Object>}
 */
export function sortRecords(items, sort) {
  const spec = parseSort(sort)
  if (!spec || !Array.isArray(items) || items.length === 0) return items
  const { field, desc } = spec
  return [...items].sort((a, b) => {
    const av = readPath(a, field) ?? ''
    const bv = readPath(b, field) ?? ''
    const cmp = typeof av === 'string' && typeof bv === 'string'
      ? av.localeCompare(bv)
      : (av > bv ? 1 : av < bv ? -1 : 0)
    return desc ? -cmp : cmp
  })
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
