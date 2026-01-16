/**
 * Uniweb Core Runtime
 *
 * The main runtime instance that manages the website, foundation components,
 * and provides utilities to components.
 */

import Website from './website.js'

export default class Uniweb {
  constructor(configData) {
    this.activeWebsite = new Website(configData)
    this.childBlockRenderer = null // Function to render child blocks
    this.routingComponents = {} // Link, SafeHtml, useNavigate, etc.
    this.foundation = null // The loaded foundation module
    this.foundationConfig = {} // Configuration from foundation
    this.language = 'en'
  }

  /**
   * Set the foundation module after loading
   * @param {Object} foundation - The loaded ESM foundation module
   */
  setFoundation(foundation) {
    this.foundation = foundation
  }

  /**
   * Get a component from the foundation by name
   * @param {string} name - Component name
   * @returns {React.ComponentType|undefined}
   */
  getComponent(name) {
    if (!this.foundation) {
      console.warn('[Runtime] No foundation loaded')
      return undefined
    }

    // Use foundation's getComponent interface
    if (typeof this.foundation.getComponent === 'function') {
      return this.foundation.getComponent(name)
    }

    // Fallback: direct component access
    return this.foundation[name]
  }

  /**
   * List available components from the foundation
   * @returns {string[]}
   */
  listComponents() {
    if (!this.foundation) return []

    if (typeof this.foundation.listComponents === 'function') {
      return this.foundation.listComponents()
    }

    return []
  }

  /**
   * Get component schema
   * @param {string} name - Component name
   * @returns {Object|undefined}
   */
  getSchema(name) {
    if (!this.foundation) return undefined

    if (typeof this.foundation.getSchema === 'function') {
      return this.foundation.getSchema(name)
    }

    return undefined
  }

  /**
   * Set foundation configuration
   * @param {Object} config
   */
  setFoundationConfig(config) {
    this.foundationConfig = config
  }

  // Legacy compatibility - maps to new method names
  getRemoteComponent(name) {
    return this.getComponent(name)
  }

  setRemoteComponents(components) {
    // Legacy: components was an object map
    // Convert to foundation-like interface
    this.foundation = {
      getComponent: (name) => components[name],
      listComponents: () => Object.keys(components),
      components
    }
  }

  setRemoteConfig(config) {
    this.setFoundationConfig(config)
  }
}
