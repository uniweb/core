/**
 * @uniweb/core
 *
 * Core classes for the Uniweb platform.
 * Pure JavaScript - no React or framework dependencies.
 */

import Uniweb from './uniweb.js'

// Core classes
export { Uniweb }
export { default as Website } from './website.js'
export { default as Page } from './page.js'
export { default as Block } from './block.js'
export { default as Theme, hasDarkScheme } from './theme.js'
export { default as DataStore, deriveCacheKey } from './datastore.js'
export { default as EntityStore } from './entity-store.js'
export { default as FetcherDispatcher } from './fetcher-dispatcher.js'
export { default as ObservableState } from './observable-state.js'

// Utilities
export { substitutePlaceholders } from './substitute-placeholders.js'
// ⛔ `resolveQueryAddress` / `resolveRecordAddressPattern` are NOT re-exported
// here. They are read by `./fetch-config.js` and by nothing else in any repo
// (measured 2026-09-01 over every .js/.jsx/.mjs/.ts/.tsx file in the
// workspace). A consumer that needs them imports `@uniweb/core/query-address`,
// which is a declared subpath and a zero-dependency leaf — the same reach
// `route-match` and `section-id` already have. Re-exporting an internal from
// the package entry is not free: the import-map bridge enumerates this file's
// surface and emits a live named re-export for every one, so nothing here can
// ever be tree-shaken on the hosted lane.
export { resolveFetchConfigs } from './fetch-config.js'
export { buildDetailConfig } from './detail-url.js'
// `isWildcardLanguages` is likewise internal — `./locale-config.js` reads it
// and nothing else does. Same subpath escape hatch: `@uniweb/core/locale-config`.
export {
  normalizeLanguageList,
  resolveDefaultLocale,
  resolvePublishableLocales,
  validateLanguageConfig
} from './locale-config.js'
export {
  DATA_DIR,
  DATA_URL_PREFIX,
  queryDataUrl,
  recordDataUrl,
  queryNameFromUrl,
  isDataUrl
} from './data-paths.js'
export { evaluate as evaluateWhere, match as matchWhere } from './where.js'
export { isRichSchema } from './schemas.js'
// ⛔ `Tracker` is NOT on the package entry. It is a FEATURE, not part of the
// object graph this package exists to define, and putting it here made every
// consumer of core carry 1,576 gzip of it -- press, unipress, `@uniweb/api`
// and every SSR isolate included -- for a class only the browser runtime ever
// wires. Its one importer already reaches it correctly, through the
// `@uniweb/core/tracker` subpath (`runtime/src/wire-foundation.js`).
// Also available as the zero-dependency leaves `@uniweb/core/services` and
// `@uniweb/core/base-path` — which is how `@uniweb/runtime` reaches them,
// since it must not pull the package root into an SSR/Worker bundle.
export { resolveService, resolveServiceUrl, readServiceOptions } from './services.js'
export { applyBasePath } from './base-path.js'
export {
  resolveStyle as resolveRequestStyle,
  listStyleNames as listRequestStyleNames
} from './request-styles/index.js'

/**
 * The singleton Uniweb instance.
 * Created by the runtime during initialization.
 * Access via globalThis.uniweb or import { getUniweb } from '@uniweb/core'
 */
export function getUniweb() {
  return globalThis.uniweb
}

/**
 * Create and register the Uniweb singleton.
 *
 * @param {Object} content - Site content payload (pages, theme, config, layouts, ...).
 * @param {Object} [foundation] - Loaded primary foundation module.
 * @param {Array<Object>} [extensions] - Loaded extension modules.
 * @param {Object} [options]
 * @param {{ resolve: Function }} [options.defaultFetcher] - Framework default fetcher.
 * @param {{ resolve: Function, cacheKey?: Function }} [options.transport] -
 *   Runtime-level transport override — routes every Layer-1 request through
 *   this transport. Used only by the editor's preview iframe.
 * @returns {Uniweb} The created instance (also assigned to globalThis.uniweb).
 */
export function createUniweb(
  content,
  foundation = null,
  extensions = [],
  { defaultFetcher = null, transport = null, dev = false } = {}
) {
  const instance = new Uniweb({
    content,
    foundation,
    extensions,
    defaultFetcher,
    transport,
    dev
  })
  globalThis.uniweb = instance
  return instance
}
