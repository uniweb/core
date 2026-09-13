/**
 * Layout names — the ONE rule for when two spellings name one layout.
 *
 * A layout is named in four places: a page's `layout:`, the foundation's
 * `defaultLayout`, the foundation's layout components (`src/layouts/<Name>/`) and a
 * site's `layout/<name>/` folder. ⭐ Two spellings name one layout when they match
 * regardless of case, and with or without a trailing `Layout` — so `layout/docs/`,
 * `layout: Docs` and a foundation's `DocsLayout` are one layout. Ruled 2026-09-13
 * [Diego]: case — *"case-insensitive matching makes more sense"*; the suffix — *"We
 * should not require the suffix."* ⛔ Until then a foundation layout named
 * `DocsLayout` needed the folder `layout/DocsLayout/`, and `layout/docs/` matched
 * nothing, silently.
 *
 * An exact key wins first, then one that differs in case, then one that differs by
 * the suffix — so a map holding both `Docs` and `DocsLayout` still answers each name
 * with its own entry.
 *
 * Zero-dependency leaf: the site's object graph, a host's prefetch and the build
 * import it, and none of them should pull more of core to agree on a name.
 */

const LAYOUT_SUFFIX = /^(.+?)[-_]?layout$/

/**
 * The key a layout name is compared by: lowercased, a trailing `layout` (after an
 * optional `-` or `_`) removed when something remains. `DocsLayout`, `docs-layout`
 * and `Docs` → `docs`; `Layout` → `layout`.
 *
 * @param {*} name
 * @returns {string|null} null for anything that is not a non-empty string
 */
export function layoutNameKey(name) {
  if (typeof name !== 'string') return null
  const lower = name.trim().toLowerCase()
  if (!lower) return null
  const match = lower.match(LAYOUT_SUFFIX)
  return match ? match[1] : lower
}

/**
 * The entry a layout name names in a map keyed by layout name — the site's layout
 * sets, the foundation's layout components, or their meta.
 *
 * @param {Object|null|undefined} map
 * @param {string|null|undefined} name
 * @returns {*} the entry, or undefined
 */
export function findLayoutEntry(map, name) {
  if (!map || typeof map !== 'object' || typeof name !== 'string' || !name) return undefined
  if (Object.prototype.hasOwnProperty.call(map, name)) return map[name]
  const keys = Object.keys(map)
  const lower = name.toLowerCase()
  for (const key of keys) {
    if (key.toLowerCase() === lower) return map[key]
  }
  const wanted = layoutNameKey(name)
  for (const key of keys) {
    if (layoutNameKey(key) === wanted) return map[key]
  }
  return undefined
}
