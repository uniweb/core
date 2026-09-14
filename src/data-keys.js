/**
 * ⭐ WHAT A SECTION RECEIVES — the keys its component declares, and which fetch fills each.
 * Ruled 2026-09-14 [Diego]:
 *
 *   - **`content.data` holds every key the component declares — in its `meta.js` `data:`,
 *     and in its foundation's `main.js` `data:` — and nothing else.** A component with no
 *     `data:` receives none of its own; a foundation's keys reach every section, since its
 *     handlers run for every section.
 *   - **Which fetch fills a declared key** — automatic `as`: the fetches reaching a section
 *     are taken one level at a time, most specific first; within a level, a fetch fills
 *     its own key when the component declares it, and the fetches whose keys it does not
 *     declare fill its still-empty keys of their query's schema, in order.
 *
 * ⛔ Until then `content.data` held every key that reached a section — every fetch of the
 * section, its page, its parent and the site, and every tagged block — and a key reached
 * a component only under the name the fetch was given (`as`), so a component naming its
 * key differently received nothing.
 *
 * Plain data in and out, like `routeQuery`, so the entity store, the editor and anything
 * else that shows what a section receives call these and keep no copy.
 *
 * @module
 */

import { fetchEntries } from './fetch-config.js'

/**
 * A declared key's schema ref, as `data:` spells it: a ref string (`'@std/article'`), an
 * entry naming one (`{ schema: '@/member' }`), or null for an inline shape — a field map
 * or a form — which names no schema.
 *
 * @param {*} value - one `data:` entry's value, authored or leaned
 * @returns {string|null}
 */
function refOf(value) {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && typeof value.schema === 'string') return value.schema || null
  return null
}

/**
 * The keys a section's component receives, in order, each with its schema ref — its
 * component's `data:` first, then its foundation's. A key both declare is the
 * component's.
 *
 * `data: false`, a missing `data:` or anything that is not a map declares nothing. Each
 * value may be as authored or as the build leans it (`{ key: ref|null }`).
 *
 * @param {Object|false|null|undefined} componentData - the component's `data:`
 * @param {Object|false|null|undefined} [foundationData] - its foundation's `main.js` `data:`
 * @returns {Array<[string, string|null]>}
 */
export function declaredKeys(componentData, foundationData = null) {
  const out = []
  const seen = new Set()
  for (const data of [componentData, foundationData]) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue
    for (const [key, value] of Object.entries(data)) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push([key, refOf(value)])
    }
  }
  return out
}

/**
 * Do two schema refs name the same schema?
 *
 * ⭐ `@/<name>` is "this project's own `<name>`", and what that project is differs by who
 * wrote it: in a foundation's `meta.js` it is the foundation's schema, in a site's
 * `queries.yml` the site's — and a site synced to a host has its queries' `@/` refs
 * qualified with its org (`@acme/member`). So a local ref matches a ref of ANY scope with
 * the same name; two scoped refs match only when their scopes agree. Decided 2026-09-14
 * (the plan's §7 left it to framework): `@/member` and `@acme/member` match,
 * `@std/person` and `@acme/person` do not.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {boolean}
 */
export function sameSchema(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  if (a === b) return true
  const pa = parseRef(a)
  const pb = parseRef(b)
  if (!pa || !pb || pa.name !== pb.name) return false
  return pa.scope === pb.scope || pa.scope === '' || pb.scope === ''
}

/** `@scope/name` → `{ scope, name }`, `''` for a local `@/name`; null for anything else. */
function parseRef(ref) {
  const m = /^@([^/]*)\/([^/]+)$/.exec(ref)
  return m ? { scope: m[1], name: m[2] } : null
}

/**
 * ⭐ WHICH FETCH FILLS EACH DECLARED KEY — automatic `as`, ruled 2026-09-14 [Diego].
 *
 * The levels are the fetches reaching a section, most specific first — its own, its
 * page's, its parent page's, a nested page's route binding, the site's (the sources
 * `resolveFetchConfigs` takes). Within a level each fetch's key is its `as`, which is its
 * query's name unless the author wrote another, and:
 *
 *   1. **a fetch fills its key**, if the component declares it;
 *   2. **the fetches whose keys the component does not declare fill its still-empty keys
 *      of their query's schema, in order** — the first such fetch, in the order written,
 *      fills the first such key, in the order `data:` lists them, and the next fetch the
 *      next key (`sameSchema`).
 *
 * A key filled at one level is not refilled by a less specific one, and a key the section
 * already holds — a tagged data block in it (`held`) — is filled before any fetch. Where
 * two fetches could fill one key, the first does. A fetch that fills nothing is not in
 * the answer, and so is not asked for.
 *
 * The mapping says where an answer lands; it renames no fetch. A fetch keeps its `as`
 * for its question, its cache key and its prefetch.
 *
 * @param {Array<[string, string|null]>} declared - `declaredKeys`
 * @param {Array<*>} levels - each level's `fetch`, most specific first; falsy levels skipped
 * @param {Object} [options]
 * @param {Object|null} [options.queries] - the site's `config.queries`, for each fetch's
 *   query's schema
 * @param {Iterable<string>} [options.held] - declared keys the section already fills
 * @returns {Map<string, { fetch: Object, level: number, index: number }>} declared key →
 *   the fetch that fills it, as the level spells it (with its `as`), the level it came
 *   from and its place in that level; in the order `declared` lists the keys
 */
export function fillDeclaredKeys(declared, levels, { queries = null, held = [] } = {}) {
  const refs = new Map(declared)
  const filled = new Map()
  const done = new Set(held)
  for (let level = 0; level < levels.length; level++) {
    const entries = fetchEntries(levels[level])
    // 1. a fetch fills its own key, if declared
    entries.forEach((fetch, index) => {
      const key = fetch.as
      if (refs.has(key) && !done.has(key)) {
        done.add(key)
        filled.set(key, { fetch, level, index })
      }
    })
    // 2. a fetch under an undeclared key fills the next still-empty key of its schema
    entries.forEach((fetch, index) => {
      if (refs.has(fetch.as)) return
      const schema = typeof fetch.query === 'string' ? queries?.[fetch.query]?.schema : null
      if (!schema) return
      const key = declared.find(([k, ref]) => !done.has(k) && sameSchema(ref, schema))?.[0]
      if (key === undefined) return
      done.add(key)
      filled.set(key, { fetch, level, index })
    })
  }
  return new Map(declared.filter(([key]) => filled.has(key)).map(([key]) => [key, filled.get(key)]))
}
