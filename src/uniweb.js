/**
 * Uniweb Core Runtime
 *
 * The main runtime instance that manages the website, foundation components,
 * and provides utilities to components.
 */

import Website from './website.js'
import Analytics from './analytics.js'

export default class Uniweb {
  constructor(configData) {
    this.activeWebsite = new Website(configData)
    this.childBlockRenderer = null // Function to render child blocks
    this.routingComponents = {} // Link, SafeHtml, useNavigate, etc.
    this.foundation = null // The loaded foundation module
    this.foundationConfig = {} // Configuration from foundation
    this.language = 'en'

    // Initialize analytics (disabled by default, configure via site config)
    this.analytics = new Analytics(configData.analytics || {})
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

    // Look in components object first, then direct access (named export)
    return this.foundation.components?.[name] || this.foundation[name]
  }

  /**
   * List available components from the foundation
   * @returns {string[]}
   */
  listComponents() {
    if (!this.foundation) return []

    // Use components object if available
    if (this.foundation.components) {
      return Object.keys(this.foundation.components)
    }

    return []
  }

  /**
   * Set foundation configuration
   * @param {Object} config
   */
  setFoundationConfig(config) {
    this.foundationConfig = config
  }
}
