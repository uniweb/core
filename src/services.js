import { applyBasePath } from './base-path.js'

/**
 * Site services — where a site's search, form submissions, assistant, tracking,
 * or anything else of that shape actually go.
 *
 * ## The one idea
 *
 * A component must never name a host. Whether this site's search is answered by
 * a prebuilt index, a server endpoint, or a vendor API is a *deployment* fact,
 * and a foundation that hardcodes it is coupled to one deployment. So the
 * address comes from configuration, and there are exactly two places it can
 * come from:
 *
 *   1. **The site**, authored — `search:`, `submit:`, `assistant:`, `tracking:`
 *      in site.yml. The operator's own declaration, and it wins.
 *   2. **The host**, served — `config.services.<name>` in the payload. What the
 *      deployment offers, which the site never had to know about.
 *
 * Absent from both means the site has no such service, and the caller acts on
 * that rather than guessing an address. That is the same rule for every service,
 * and it is why this module exists: it was previously implemented three times —
 * the search provider, the submit resolver, and a hand-rolled copy inside a
 * foundation — with three slightly different base-joining rules between them.
 *
 * ## The registry is open, not an enum
 *
 * `resolveService(website, name)` takes a *name*, and the framework has no list
 * of permitted ones. It ships **clients** only for what it already implements
 * (search, form submission, tracking); it ships **resolution** for anything. A
 * foundation that invents `booking` or `translate` gets the same precedence, the
 * same base handling and the same absent-means-absent behaviour, and a host can
 * fill the slot without a framework change.
 *
 * This is deliberate and it is the same shape as `fetcher.transports`: the
 * framework owns the seam, not the catalogue.
 *
 * ## ⛔ WHY THIS IS IN CORE AND NOT IN KIT
 *
 * It began in `@uniweb/kit/utils/services.js`, and every foundation still
 * reaches it there — kit re-exports this module unchanged, so no call site
 * moved. It had to come down one layer because **`@uniweb/runtime` does not
 * depend on `@uniweb/kit`** (only on core and theming), and the runtime resolves
 * a service address itself for `tracking`. The alternative was a second resolver
 * with the same job, which is the defect `@uniweb/core/route-match` exists to
 * prevent.
 *
 * ⇒ **Foundations import from `@uniweb/kit`.** This path is the framework's own.
 *
 * ## What this deliberately does not model
 *
 * **Entitlement.** A host that will not serve a service omits it, or declares
 * the name with no address. The framework never learns why — no plan names, no
 * tiers, no "paid" anywhere. That is not squeamishness: this package is public,
 * and a framework that encodes which capabilities cost money ships the business
 * model into open source.
 *
 * ⛔ **There is deliberately no explanatory string, and there was one — it was
 * a mistake.** Until 2026-08-13 a declining host could supply a `reason` that
 * this module relayed "to the UI verbatim", with an English default when nothing
 * did. Removed, on two counts:
 *
 *   1. **Wrong audience.** A visitor has no stake in which services an operator
 *      provisioned. "Submissions are not enabled for this site" reports someone's
 *      billing state to the public and reads like a breakage. It is neither — it
 *      is a service that was not bought, and **a generic component is supposed to
 *      be smart about that.**
 *   2. **Wrong language, unfixably.** Sites here are multilingual, or unilingual
 *      and not English. A host-supplied sentence bypasses the site's entire
 *      localization pipeline, and a canned constant in a public package cannot
 *      be translated at all. Any text a visitor should read is *site content*,
 *      which is authored and localized — never a string a service layer invents.
 *
 * ⇒ **`url` is the whole answer, and absence is a behavioural decision rather
 * than a message.** No submit endpoint → render no form, or degrade to something
 * that still serves the visitor. No tracking endpoint → report nothing, silently.
 *
 * **The site's own base.** `config.base` is where the site *lives*, not a
 * service it consumes — it is load-bearing for routing and asset URLs too. It
 * stays where it is and is an input here, not an entry.
 *
 * @module @uniweb/core/services
 */

/** Anything with a scheme, or protocol-relative — never joined to a base. */
const ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/**
 * Read an endpoint out of either declaration form.
 *
 * A site may write the shorthand (`submit: /forms`) or the object
 * (`submit: { endpoint: /forms }`); a host emits JSON and normally writes the
 * object. Both are accepted from both sides — one reader, no per-side rules to
 * remember.
 *
 * @param {*} declaration
 * @returns {string} the endpoint, or '' when there is none
 */
function readEndpoint(declaration) {
  if (typeof declaration === 'string') return declaration.trim()
  if (typeof declaration?.endpoint === 'string') return declaration.endpoint.trim()
  return ''
}

/**
 * Join a service endpoint to the site's base path.
 *
 * Three cases, and the middle one is why this is not simply `applyBasePath`:
 *
 *   - **Absolute** (`https://…`, `//host/…`, any scheme) — passed through. A
 *     service on another origin is not the site's to relocate.
 *   - **Bare relative** (`_search`) — rooted first. This spelling is documented
 *     and in use, and `applyBasePath` alone would leave it untouched, silently
 *     producing a request relative to whatever page the visitor is on.
 *   - **Root-relative** (`/forms`) — the ordinary case.
 *
 * The join itself goes through `applyBasePath` rather than concatenation,
 * because that is where the invariant "a base is only ever joined to a path that
 * starts at the site root" is enforced, and it is idempotent — an
 * already-based path is not based twice.
 *
 * @param {string} endpoint
 * @param {string} [basePath] - `website.basePath`
 * @returns {string}
 */
export function resolveServiceUrl(endpoint, basePath = '') {
  if (!endpoint) return ''
  if (ABSOLUTE_URL_RE.test(endpoint)) return endpoint

  const rooted = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  // `applyBasePath` concatenates and documents its input as carrying no
  // trailing slash, so normalizing is the caller's job — skip it and
  // `base: /docs/` yields `/docs//forms`.
  const base = (basePath || '').replace(/\/+$/, '')
  return applyBasePath(rooted, base)
}

/**
 * Resolve where a named service lives for this site.
 *
 * ```js
 * const { url } = resolveService(website, 'submit')
 * if (!url) return null          // no endpoint — render no form, or degrade
 * ```
 *
 * @param {object} website - the active Website
 * @param {string} name - service name, e.g. 'submit' · 'search' · 'tracking'
 * @returns {{ url: string|null, source: 'site'|'host'|null }}
 *   `url` is the whole answer for acting. `source` says which declaration
 *   answered — a diagnostic, and the thing to check when a host's value appears
 *   not to be taking effect. `'host'` with a null `url` means the host answered
 *   and offered no address; `null` means nothing declared the service at all.
 */
export function resolveService(website, name) {
  const config = website?.config
  const basePath = website?.basePath

  // 1 — the site's own declaration wins. An operator who named an endpoint
  // means it, including on a host that offers one.
  const authored = readEndpoint(config?.[name])
  if (authored) {
    return { url: resolveServiceUrl(authored, basePath), source: 'site' }
  }

  // 2 — what the host says it offers.
  const hostDeclaration = config?.services?.[name]
  const hostEndpoint = readEndpoint(hostDeclaration)
  if (hostEndpoint) {
    return { url: resolveServiceUrl(hostEndpoint, basePath), source: 'host' }
  }

  // A host may declare the name while offering no address — a decline. It is
  // still the host answering, which is all a caller can use: any *wording* for
  // that state would be ours to invent, in one language, for a visitor who has
  // no stake in it. See the entitlement note above.
  if (hostDeclaration !== undefined) return { url: null, source: 'host' }

  // 3 — nobody supplied one.
  return { url: null, source: null }
}

/**
 * Read a service's declaration object, whichever tier supplied it.
 *
 * `resolveService` answers *where*; this answers *with what options*. Only the
 * object form carries any — a shorthand string is an address and nothing else.
 * Used by `tracking:` for `consent:`; a future service with its own options
 * reads them the same way rather than inventing a second lookup.
 *
 * The tiers are checked in the same order and for the same reason, so a site
 * that authors the object form is not silently merged with a host's.
 *
 * @param {object} website
 * @param {string} name
 * @returns {object} the declaration object, or `{}` when there is none
 */
export function readServiceOptions(website, name) {
  const config = website?.config
  const authored = config?.[name]
  if (authored !== undefined) {
    return authored && typeof authored === 'object' ? authored : {}
  }
  const hosted = config?.services?.[name]
  return hosted && typeof hosted === 'object' ? hosted : {}
}
