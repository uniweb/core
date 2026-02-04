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
    this.foundationConfig = {} // Configuration from foundation (capabilities)
    this.meta = {} // Per-component runtime metadata (from meta.js)
    this.extensions = [] // Array of { foundation, meta } objects
    this.language = 'en'

    // Icon resolver: (library, name) => Promise<string|null>
    // Set by runtime based on site config
    this.iconResolver = null

    // Pre-populated icon cache for SSR: Map<"family:name", svgString>
    // Populated by prerender before rendering, read synchronously by Icon component
    this.iconCache = new Map()

    // Initialize analytics (disabled by default, configure via site config)
    this.analytics = new Analytics(configData.analytics || {})
  }

  /**
   * Resolve an icon by library and name
   * @param {string} library - Icon family (lucide, heroicons, etc.)
   * @param {string} name - Icon name (check, arrow-right, etc.)
   * @returns {Promise<string|null>} SVG string or null
   */
  async resolveIcon(library, name) {
    if (!this.iconResolver) {
      console.warn('[Uniweb] No icon resolver configured')
      return null
    }
    return this.iconResolver(library, name)
  }

  /**
   * Get a cached icon synchronously (for SSR/prerender)
   * @param {string} library - Icon family code
   * @param {string} name - Icon name
   * @returns {string|null} SVG string or null if not cached
   */
  getIconSync(library, name) {
    return this.iconCache.get(`${library}:${name}`) || null
  }

  /**
   * Set the foundation module after loading
   * @param {Object} foundation - The loaded ESM foundation module
   */
  setFoundation(foundation) {
    this.foundation = foundation

    // Store per-component metadata if present
    if (foundation.meta) {
      this.meta = foundation.meta
    }
  }

  /**
   * Register an extension (secondary foundation)
   * @param {Object} foundation - The loaded ESM extension module
   */
  registerExtension(foundation) {
    const meta = foundation.meta || {}
    this.extensions.push({ foundation, meta })
  }

  /**
   * Get runtime metadata for a component
   * @param {string} componentName
   * @returns {Object|null} Meta with defaults, context, initialState, background, data
   */
  getComponentMeta(componentName) {
    const primary = this.meta[componentName]
    if (primary) return primary

    for (const ext of this.extensions) {
      const meta = ext.meta[componentName]
      if (meta) return meta
    }

    return null
  }

  /**
   * Get default param values for a component
   * @param {string} componentName
   * @returns {Object} Default values (empty object if none)
   */
  getComponentDefaults(componentName) {
    return this.getComponentMeta(componentName)?.defaults || {}
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

    // Primary foundation first
    const primary = this.foundation.components?.[name] || this.foundation[name]
    if (primary) return primary

    // Fall through to extensions (declared order)
    for (const ext of this.extensions) {
      const component = ext.foundation.components?.[name] || ext.foundation[name]
      if (component) return component
    }

    return undefined
  }

  /**
   * List available components from the foundation
   * @returns {string[]}
   */
  listComponents() {
    const names = new Set()

    if (this.foundation?.components) {
      for (const name of Object.keys(this.foundation.components)) {
        names.add(name)
      }
    }

    for (const ext of this.extensions) {
      if (ext.foundation.components) {
        for (const name of Object.keys(ext.foundation.components)) {
          names.add(name)
        }
      }
    }

    return [...names]
  }

  /**
   * Set foundation configuration
   * @param {Object} config
   */
  setFoundationConfig(config) {
    this.foundationConfig = config
  }
}
