/**
 * Uniweb Core Runtime
 *
 * Singleton that holds the Website, routing components, icon resolver, and
 * foundation declaration references. Kit hooks, the icon resolver, and the
 * prepare-props pipeline read from here via `globalThis.uniweb`.
 *
 * The foundation and extensions are passed at construction time — the Website
 * constructs its FetcherDispatcher from them, and the Uniweb singleton caches
 * the same references so the kit can still do `globalThis.uniweb.getComponent(name)`
 * and similar lookups without touching the Website.
 */

import Website from './website.js'
import Analytics from './analytics.js'

export default class Uniweb {
  /**
   * @param {Object} options
   * @param {Object} options.content - Site content payload (pages, theme, config, layouts, ...).
   * @param {Object|null} [options.foundation] - Loaded primary foundation module.
   * @param {Array<Object>} [options.extensions] - Loaded extension modules.
   * @param {{ resolve: Function }} [options.defaultFetcher] - Framework default fetcher
   *   used by the dispatcher's fallback when no foundation route matches.
   * @param {{ resolve: Function, cacheKey?: Function }} [options.transport] -
   *   Runtime-level transport override. When set, every Layer-1 request is
   *   routed through this transport, bypassing foundation routes and the
   *   framework default. Used only by the editor's preview iframe; normal
   *   sites never pass this option.
   */
  constructor({ content = {}, foundation = null, extensions = [], defaultFetcher = null, transport = null, dev = false } = {}) {
    this.activeWebsite = new Website({ content, foundation, extensions, defaultFetcher, transport, dev })

    this.foundation = foundation
    this.foundationConfig = {}
    this.meta = foundation?.default?.meta || {}
    this.extensions = []

    if (foundation?.default?.capabilities) {
      this.foundationConfig = { ...foundation.default.capabilities }
    }
    if (foundation?.default?.layoutMeta) {
      this.foundationConfig.layoutMeta = foundation.default.layoutMeta
    }
    if (foundation?.default?.handlers) {
      this.foundationConfig.handlers = foundation.default.handlers
    }
    if (foundation?.default?.viewTransitions !== undefined) {
      this.foundationConfig.viewTransitions = foundation.default.viewTransitions
    }

    for (const ext of extensions) {
      this._wireExtension(ext)
    }

    this.childBlockRenderer = null
    this.routingComponents = {}
    this.language = 'en'

    // Framework-level inset components — every foundation gets these
    // for free. Currently `<Ref>` for cross-references; future
    // additions land here too. The runtime's setup wires the actual
    // component instance after createUniweb returns; the slot is
    // declared here so Object.seal lets us assign to it.
    this.defaultInsets = null

    // Icon resolver: (library, name) => Promise<string|null>
    // Set by the runtime from site config.
    this.iconResolver = null

    // Pre-populated icon cache for SSR: Map<"family:name", svgString>
    // Populated by prerender before rendering, read synchronously by Icon.
    this.iconCache = new Map()

    this.analytics = new Analytics(content?.analytics || content?.config?.analytics || {})

    Object.seal(this)
  }

  /**
   * Wire an extension into the singleton. Kit's getComponent falls through
   * from the primary foundation to each extension in declared order; meta
   * lookups do the same.
   *
   * @private
   */
  _wireExtension(foundation) {
    const meta = foundation?.default?.meta || {}
    this.extensions.push({ foundation, meta })
  }

  /**
   * Resolve an icon by library and name.
   * @param {string} library
   * @param {string} name
   * @returns {Promise<string|null>}
   */
  async resolveIcon(library, name) {
    if (!this.iconResolver) {
      console.warn('[Uniweb] No icon resolver configured')
      return null
    }
    return this.iconResolver(library, name)
  }

  /**
   * Synchronous icon lookup for SSR.
   */
  getIconSync(library, name) {
    return this.iconCache.get(`${library}:${name}`) || null
  }

  /**
   * Get per-component runtime metadata — primary first, then extensions in
   * declared order.
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

  getComponentDefaults(componentName) {
    return this.getComponentMeta(componentName)?.defaults || {}
  }

  getComponent(name) {
    if (!this.foundation) {
      console.warn('[Runtime] No foundation loaded')
      return undefined
    }
    const primary = this.foundation[name]
    if (primary) return primary
    for (const ext of this.extensions) {
      const component = ext.foundation[name]
      if (component) return component
    }
    // Final fallback: framework-level default insets (e.g. <Ref> for
    // cross-references). Foundations don't need to register these
    // explicitly; the framework provides them.
    if (this.defaultInsets && this.defaultInsets[name]) {
      return this.defaultInsets[name]
    }
    return undefined
  }

  listComponents() {
    const names = new Set()
    if (this.foundation) {
      for (const name of Object.keys(this.foundation)) {
        if (name !== 'default') names.add(name)
      }
    }
    for (const ext of this.extensions) {
      for (const name of Object.keys(ext.foundation)) {
        if (name !== 'default') names.add(name)
      }
    }
    return [...names]
  }
}
