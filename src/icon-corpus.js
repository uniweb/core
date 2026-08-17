/**
 * The icon corpus — its default origin and its filename rule.
 *
 * ## Why this is one module and not five constants
 *
 * An icon referenced by `library` + `name` is **our own asset**, not the site's.
 * We publish the families, we document them, and `@uniweb/icons`'
 * `scripts/build-cdn.js` writes the files. So unlike a site asset — whose URL
 * pattern the HOST declares because the bytes are in the host's store — the
 * layout here is ours to name, and a default origin is the correct answer
 * rather than a guessed one.
 *
 * That makes this a **writer/reader pair**, which is the part that needs a
 * single definition:
 *
 *   writer   @uniweb/icons scripts/build-cdn.js   emits cdn/{family}/{family}-{name}.svg
 *   readers  @uniweb/runtime setup.js             browser resolution
 *            @uniweb/runtime ssr-renderer.js      prerender + Worker isolate prefetch
 *            @uniweb/icons  src/resolver.js       local-then-CDN resolution
 *
 * Before 2026-08-17 the origin was spelled out in three of those and the
 * filename rule in all four. A writer and its readers drifting is the exact
 * defect `@uniweb/core/route-match` exists to prevent, and the one the runtime
 * channel's bridge-filename helper prevents by construction. Same treatment
 * here: one helper, no second spelling.
 *
 * ## ⛔ Keep this a LEAF — zero imports
 *
 * `ssr-renderer.js` is bundled into the SSR isolate that runs in a Cloudflare
 * Worker, so anything it reaches must import nothing: no `node:*`, no DOM, no
 * `@uniweb/core` root (which pulls semantic-parser and theming). That is the
 * same constraint `route-match` and `locale-config` carry, and the reason this
 * lives in core rather than in `@uniweb/icons` — a Worker cannot take a package
 * whose value is ~3,200 icon modules behind a dynamic import, and `@uniweb/runtime`
 * depends on core already.
 *
 * A host may override the ORIGIN — a mirror of this corpus is a legitimate
 * deployment choice, and on a hosted site the base comes from the payload the
 * host serves. It may not override the LAYOUT: a mirror mirrors. Re-deriving
 * filenames instead of copying them is what produced two incompatible spellings
 * of the same corpus once already.
 *
 * @module @uniweb/core/icon-corpus
 */

/**
 * Where the framework publishes its own icon corpus.
 *
 * Not a fallback for a missing host address — it is the address of OUR artifact,
 * and it is what makes `![](lu-house)` work in a project with no backend at all.
 * A host that mirrors the corpus supplies its own origin on the payload.
 */
export const DEFAULT_ICON_BASE = 'https://uniweb.github.io/icons'

/**
 * The corpus path for one icon, relative to any origin serving it.
 *
 * `{family}/{family}-{name}.svg` — the family repeats deliberately: the
 * directory groups, and the filename prefix keeps ids unique across families so
 * a name alone is never ambiguous.
 *
 * @param {string} family - short family code (`lu`, `hi2`, `fa6`)
 * @param {string} name - icon id within that family (`house`, `a-arrow-down`)
 * @returns {string} e.g. `lu/lu-house.svg`
 */
export function iconPath(family, name) {
  return `${family}/${family}-${name}.svg`
}

/**
 * The full URL for one icon against a serving origin.
 *
 * @param {string} family - short family code
 * @param {string} name - icon id within that family
 * @param {string} [base] - serving origin; defaults to the framework's own
 * @returns {string}
 */
export function iconUrl(family, name, base = DEFAULT_ICON_BASE) {
  return `${String(base).replace(/\/+$/, '')}/${iconPath(family, name)}`
}
