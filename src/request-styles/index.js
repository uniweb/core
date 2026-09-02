/**
 * Request style — how the default fetcher reshapes a normalized request
 * into wire format: which operators become URL params, which go into a
 * body, what envelope the response carries.
 *
 * One style ships: `json-body`, the framework's own conventions, and it
 * is the only wire the default fetcher speaks. A backend with another
 * dialect is reached through a named transport — shipped by the
 * foundation, or by an extension the site selects per schema in
 * `site.yml fetcher.transports` — never through a second built-in style.
 * Two vendor dialects, `flat-query` and `strapi`, shipped here from
 * `@uniweb/core` 0.7.0 and were removed: a third party's wire is not a
 * framework concern, and core is loaded by every site and never
 * tree-shaken.
 *
 * `site.yml fetcher.request.style` is still read, for one reason: a site
 * that names a style the framework does not ship must be told. Falling
 * back silently would send the default wire to a backend that does not
 * speak it — the request succeeds and the data is wrong.
 *
 * Internal to @uniweb/core. Consumed by @uniweb/runtime's default-fetcher.
 */

import { jsonBody } from './json-body.js'

const unknownStyleMessage = (name) =>
  `[default-fetcher] unknown request style "${name}". The framework ships one wire, ` +
  `"json-body"; a backend with a different dialect is reached through a named transport ` +
  `(site.yml fetcher.transports), shipped by the foundation or by an extension.`

/**
 * Resolve the request style. No name, or `json-body`, returns the one
 * shipped style. Any other name is a site declaring a wire dialect the
 * framework does not ship: in dev this throws, so the site does not boot
 * on the wrong wire; in production it logs an error once and falls back
 * to `json-body`, so the site still renders.
 *
 * @param {string|undefined|null} name
 * @param {{ dev?: boolean }} [options]
 * @returns {Object} A style module.
 * @throws {Error} in dev, on a name that is not `json-body`.
 */
export function resolveStyle(name, { dev = false } = {}) {
  if (!name || name === jsonBody.name) return jsonBody
  if (dev) {
    const err = new Error(unknownStyleMessage(name))
    err.code = 'UNKNOWN_REQUEST_STYLE'
    throw err
  }
  if (!erroredUnknownStyles.has(name)) {
    erroredUnknownStyles.add(name)
    console.error(unknownStyleMessage(name) + ' Falling back to "json-body".')
  }
  return jsonBody
}

const erroredUnknownStyles = new Set()

export { jsonBody }
