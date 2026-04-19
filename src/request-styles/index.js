/**
 * Request-style registry.
 *
 * A "style" describes how the default fetcher reshapes a normalized
 * request into wire format — which operators become URL params, which
 * go into a body, what envelope the response carries. Sites pick a
 * style on `site.yml fetcher.request.style`; when unset, the ambient
 * default is `json-body`.
 *
 * Styles are shipped by the framework. There is no `registerStyle()`
 * API for foundations or sites — custom wire shapes are expressed via
 * foundation-level named transports. Styles are specifically for
 * reshapings of the framework's own fetcher behavior.
 *
 * Internal to @uniweb/core. Consumed by @uniweb/runtime's default-fetcher.
 */

import { jsonBody } from './json-body.js'
import { flatQuery } from './flat-query.js'
import { strapi } from './strapi.js'

const STYLES = new Map([
  [jsonBody.name, jsonBody],
  [flatQuery.name, flatQuery],
  [strapi.name, strapi],
])

/**
 * Resolve a style by name. Returns the requested style if registered,
 * otherwise the ambient default (`json-body`). Unknown names trigger a
 * one-time dev warning; production silently falls back.
 *
 * @param {string|undefined|null} name
 * @param {{ dev?: boolean }} [options]
 * @returns {Object} A style module.
 */
export function resolveStyle(name, { dev = false } = {}) {
  if (!name) return jsonBody
  const style = STYLES.get(name)
  if (style) return style
  if (dev && !warnedUnknownStyles.has(name)) {
    warnedUnknownStyles.add(name)
    console.warn(
      `[default-fetcher] unknown request style "${name}"; falling back to "json-body". ` +
        `Known styles: ${[...STYLES.keys()].join(', ')}.`,
    )
  }
  return jsonBody
}

const warnedUnknownStyles = new Set()

/**
 * Sentinel list of names registered at the registry level. Used by tests
 * and by dev-mode diagnostics; not part of the site-facing contract.
 */
export function listStyleNames() {
  return [...STYLES.keys()]
}

export { jsonBody, flatQuery, strapi }
