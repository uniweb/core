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
