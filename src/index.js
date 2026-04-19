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
export { default as Theme } from './theme.js'
export { default as DataStore, deriveCacheKey } from './datastore.js'
export { default as EntityStore } from './entity-store.js'
export { default as FetcherDispatcher } from './fetcher-dispatcher.js'
export { default as ObservableState } from './observable-state.js'

// Utilities
export { default as singularize } from './singularize.js'
export { substitutePlaceholders } from './substitute-placeholders.js'
export { evaluate as evaluateWhere, match as matchWhere } from './where.js'

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
export function createUniweb(content, foundation = null, extensions = [], { defaultFetcher = null, transport = null, dev = false } = {}) {
  const instance = new Uniweb({ content, foundation, extensions, defaultFetcher, transport, dev })
  globalThis.uniweb = instance
  return instance
}
