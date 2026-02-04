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
 * Called by @uniweb/runtime during site initialization.
 *
 * @param {Object} configData - Website configuration (pages, theme, config)
 * @returns {Uniweb} The created instance
 */
export function createUniweb(configData) {
  const instance = new Uniweb(configData)
  globalThis.uniweb = instance
  return instance
}
