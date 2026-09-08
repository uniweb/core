/**
 * Base-path joining — a zero-dependency leaf.
 *
 * A site deployed under a subdirectory (`base: /docs/` in site.yml) serves
 * every root-relative path under that prefix. This is the one function that
 * applies it, and it is idempotent: an already-based path is not based twice.
 *
 * WHY IT LIVES IN CORE
 * It began in `@uniweb/kit/utils/href`, which is where most callers are. But
 * `@uniweb/core/services` needs it too, and **`@uniweb/runtime` does not depend
 * on kit** — so a service address resolved in the runtime could not reach it.
 * Rather than grow a second copy (the failure `@uniweb/core/route-match` was
 * created to end, after one matcher was implemented twice and the copies
 * diverged), it moved down to the layer both sides already depend on. Kit
 * re-exports it, so no existing call site moved.
 *
 * ## ⛔ WHO MAY IMPORT THIS SUBPATH — the leaf is not for everyone
 *
 * ⭐ **The leaf exists for consumers that must NOT pull core's index**: the
 * runtime (`wire-foundation.js`, `script-loader.js`), which resolves a service
 * address and cannot reach kit at all, and anything keeping its import graph
 * small on purpose — `@uniweb/projections` imports leaves to stay Worker-safe.
 *
 * ⛔ **A package that a foundation BUNDLES must import the bare `@uniweb/core`
 * instead — kit and api.** A foundation build externalizes `@uniweb/core`, and
 * Rollup's `external` list is matched by **string equality**: the bare specifier
 * is dropped from the bundle and `@uniweb/core/services` is not. So a leaf import
 * from kit compiles a second copy of this file into every foundation that uses
 * it, beside the real core the runtime loads — the same class of trap that put
 * `react-dom/server` on that list separately.
 *
 * ⚠️ **Measured 2026-09-07 and now guarded:** `services.js` (9,898 B) and this file (2,316 B) were inside a built foundation with `@uniweb/core`
 * externalized the whole time, because kit re-exported from the subpath. Both are
 * pure functions, so the symptom was weight — `@uniweb/core/datastore` is not.
 *
 * ⇒ **Foundations import from `@uniweb/kit`; kit imports the bare `@uniweb/core`.**
 * Anything kit needs belongs on core's index, not only behind a subpath.
 *
 * Kept separate from `resolveRoute` deliberately: React Router supplies the
 * base itself through its `basename`, so a Router-rendered link must not have
 * it applied twice.
 *
 * @module @uniweb/core/base-path
 */

/**
 * Prefix a site-root-relative href with the deployment base path.
 *
 * The invariant this encodes — a base is only ever joined to a path that
 * starts at the site root — is the whole point of routing every caller
 * through here. A bare `basePath + href` concatenation produces garbage the
 * moment href turns out to be absolute (`/basehttps://example.com/x`), and
 * whether it is absolute depends on a classification that has been wrong
 * before. Guarding at the join makes the failure impossible rather than
 * unlikely.
 *
 * Passed through untouched when: there is no base, the href is empty, the href
 * is not root-relative (a bare relative path, or any absolute/scheme URL), the
 * href is protocol-relative (`//host/…`), or the base is already applied.
 *
 * @param {string} href - Href to prefix
 * @param {string} basePath - Deployment base (no trailing slash), '' for root
 * @returns {string} Href with the base applied, or unchanged if not applicable
 */
export function applyBasePath(href, basePath) {
  if (!href || typeof href !== 'string' || !basePath) return href
  if (!href.startsWith('/') || href.startsWith('//')) return href
  if (href === basePath || href.startsWith(basePath + '/')) return href // already based
  return basePath + href
}
