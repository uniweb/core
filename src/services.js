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

  // ⭐ A HOST THAT EMITTED A SERVICES BLOCK IS ANSWERING — for every service,
  // not only the ones it named. The block is the host's statement of what it
  // offers, so a name ABSENT from it carries the same answer as a name present
  // with no address: this host does not offer that service.
  //
  // Without this, "the host offers tracking and not search" and "there is no
  // host at all" are the same value, and a caller with a fallback takes it. A
  // caller with no fallback cannot tell the difference and never could, which
  // is why this was invisible until search — the one service with a legacy
  // zero-config default to fall through to — started 404ing on hosted sites.
  //
  // ⇒ The rule this implements: **a control for a service the site does not
  // have must not be drawn** — uniformly, for every service, and without any
  // explanation offered to a visitor. Not-provisioned is not an error and not a
  // thing to apologise for; it is simply a feature the site does not have, the
  // same way it has no contact form when `submit` is absent.
  //
  // ⚠️ This deliberately reads the SITE CONFIG the runtime already holds rather
  // than asking a host for a new signal. The payload states what is on and what
  // is off; the renderer's job is to not draw what cannot be used.
  if (config?.services && typeof config.services === 'object' && !Array.isArray(config.services)) {
    return { url: null, source: 'host' }
  }

  // 3 — nobody supplied one. No host is speaking, so a caller's own default
  // (search's local index, say) is still correct — that is the static-host path.
  return { url: null, source: null }
}

/**
 * Read a service's options, filling each key from the first tier that declares
 * it — **the site's value wins per key, and the host fills the gaps.**
 *
 * `resolveService` answers *where*; this answers *with what options*. Only the
 * object form carries any — a shorthand string is an address and nothing else.
 *
 * ## ⛔ Why per-key rather than all-or-nothing
 *
 * This used to return the site's object whole whenever the site declared
 * *anything*, so a single authored key hid every option the host offered. That
 * put the two readers in this file on different rules, and the disagreement was
 * not cosmetic:
 *
 *   - `resolveService` already falls through **per key** — a site declaration
 *     carrying no `endpoint` lets the host's endpoint answer.
 *   - `readServiceOptions` fell through **not at all**.
 *
 * ⇒ A site declaring only `tracking: { tags: [...] }` therefore kept sending to
 * the **host's** endpoint while discarding the **host's** `consent` setting —
 * using someone's collector while ignoring their gate. Not a corner case: it is
 * what an operator gets by turning on a third-party tag while their host
 * supplies the collector.
 *
 * One rule now covers both readers, and it is the one a reader of two-tier
 * config already expects: the more specific tier wins where it speaks, and says
 * nothing where it is silent.
 *
 * ⚖️ **Consequence worth stating, because it decides a question that would
 * otherwise need its own rule:** a host's `consent` applies only when the site
 * declared none. That is the host *filling a gap*, never overriding an
 * operator's decision — so there is no "most restrictive wins" special case,
 * and an operator who wants no gate on a host that asks for one writes
 * `consent: none` and is done.
 *
 * ⚠️ **The merge is shallow and deliberately so.** Keys replace, they do not
 * combine: a site's `tags` replaces a host's rather than concatenating with it.
 * Combining would make the result depend on what a host happens to offer, which
 * is precisely the unpredictability a site's own config should not have.
 *
 * @param {object} website
 * @param {string} name
 * @returns {object} the effective options, or `{}` when no tier declares any
 */
export function readServiceOptions(website, name) {
  const config = website?.config
  return { ...asOptions(config?.services?.[name]), ...asOptions(config?.[name]) }
}

/**
 * A declaration contributes options only in its object form. A string is an
 * address, an array is malformed, and neither carries a key worth spreading.
 *
 * @param {*} declaration
 * @returns {object}
 */
function asOptions(declaration) {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) return {}
  return declaration
}
