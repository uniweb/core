/**
 * EntityStore
 *
 * Resolves entity data for components by walking the page hierarchy.
 * Leverages DataStore for caching and deduplication.
 *
 * Two-method API:
 * - resolve(block, meta) — sync, reads cache only
 * - fetch(block, meta)   — async, fetches missing data via DataStore
 */

import singularize from './singularize.js'

export default class EntityStore {
  /**
   * @param {Object} options
   * @param {import('./datastore.js').default} options.dataStore
   */
  constructor({ dataStore }) {
    this.dataStore = dataStore
  }

  /**
   * Determine which schemas a component requests.
   *
   * @param {Object} meta - Component runtime metadata
   * @returns {string[]|null} Array of schema names, or null if none requested
   */
  _getRequestedSchemas(meta) {
    if (!meta) return null

    const inheritData = meta.inheritData
    if (!inheritData) return null

    // inheritData: true → inherit all (resolved from fetch configs)
    // inheritData: ['articles'] → specific schemas
    if (Array.isArray(inheritData)) return inheritData.length > 0 ? inheritData : null
    if (inheritData === true) return [] // empty = "all available"

    return null
  }

  /**
   * Walk the hierarchy to find fetch configs for requested schemas.
   * Order: block.fetch → page.fetch → parent.fetch → ... → site config.fetch
   * First match per schema wins.
   *
   * @param {import('./block.js').default} block
   * @param {string[]} requested - Schema names (empty = collect all)
   * @returns {Map<string, Object>} schema → fetch config
   */
  _findFetchConfigs(block, requested) {
    const configs = new Map()
    const collectAll = requested.length === 0

    const sources = []

    // 1. Block-level fetch
    if (block.fetch) {
      sources.push(block.fetch)
    }

    // 2. Page-level fetch, then walk parents
    let page = block.page
    while (page) {
      if (page.fetch) {
        sources.push(page.fetch)
      }
      page = page.parent
    }

    // 3. Site-level fetch
    const siteFetch = block.website?.config?.fetch
    if (siteFetch) {
      sources.push(siteFetch)
    }

    for (const source of sources) {
      // Normalize: single config or array of configs
      const configList = Array.isArray(source) ? source : [source]

      for (const cfg of configList) {
        if (!cfg.schema) continue
        if (configs.has(cfg.schema)) continue // first match wins

        if (collectAll || requested.includes(cfg.schema)) {
          configs.set(cfg.schema, cfg)
        }
      }
    }

    return configs
  }

  /**
   * Resolve singular item for dynamic routes.
   * If block/page has dynamicContext, find the matching item in the collection.
   *
   * @param {Object} data - Resolved entity data { schema: items[] }
   * @param {Object|null} dynamicContext
   * @returns {Object} data with singular key added if applicable
   */
  _resolveSingularItem(data, dynamicContext) {
    if (!dynamicContext) return data

    const { paramName, paramValue, schema: pluralSchema } = dynamicContext
    if (!pluralSchema || !paramName || paramValue === undefined) return data

    const items = data[pluralSchema]
    if (!Array.isArray(items)) return data

    const singularSchema = singularize(pluralSchema)
    const currentItem = items.find(
      (item) => String(item[paramName]) === String(paramValue)
    )

    if (currentItem && singularSchema) {
      return { ...data, [singularSchema]: currentItem }
    }

    return data
  }

  /**
   * Sync resolution. Checks build-provided cascadedData and DataStore cache.
   *
   * @param {import('./block.js').default} block
   * @param {Object} meta - Component runtime metadata
   * @returns {{ status: 'ready'|'pending'|'none', data: Object|null }}
   */
  resolve(block, meta) {
    const requested = this._getRequestedSchemas(meta)
    if (requested === null) {
      return { status: 'none', data: null }
    }

    // Check build-time cascadedData first
    const cascaded = block.cascadedData
    if (cascaded && Object.keys(cascaded).length > 0) {
      const satisfies = requested.length === 0 || requested.every((s) => s in cascaded)
      if (satisfies) {
        const dynamicContext = block.dynamicContext || block.page.dynamicContext
        const data = this._resolveSingularItem(cascaded, dynamicContext)
        return { status: 'ready', data }
      }
    }

    // Walk hierarchy for runtime fetch configs
    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) {
      // No fetch configs found — if cascadedData had partial data, return it
      if (cascaded && Object.keys(cascaded).length > 0) {
        const dynamicContext = block.dynamicContext || block.page.dynamicContext
        const data = this._resolveSingularItem(cascaded, dynamicContext)
        return { status: 'ready', data }
      }
      return { status: 'none', data: null }
    }

    // Check DataStore cache for each config
    const data = { ...(cascaded || {}) }
    let allCached = true

    for (const [schema, cfg] of configs) {
      if (data[schema] !== undefined) continue // already have from cascadedData
      if (this.dataStore.has(cfg)) {
        data[schema] = this.dataStore.get(cfg)
      } else {
        allCached = false
      }
    }

    if (allCached) {
      const dynamicContext = block.dynamicContext || block.page.dynamicContext
      const resolved = this._resolveSingularItem(data, dynamicContext)
      return { status: 'ready', data: resolved }
    }

    return { status: 'pending', data: null }
  }

  /**
   * Async fetch. Walks hierarchy, fetches missing data via DataStore.
   *
   * @param {import('./block.js').default} block
   * @param {Object} meta - Component runtime metadata
   * @returns {Promise<{ data: Object|null }>}
   */
  async fetch(block, meta) {
    const requested = this._getRequestedSchemas(meta)
    if (requested === null) {
      return { data: null }
    }

    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) {
      // Return cascadedData if available
      const cascaded = block.cascadedData
      if (cascaded && Object.keys(cascaded).length > 0) {
        const dynamicContext = block.dynamicContext || block.page.dynamicContext
        return { data: this._resolveSingularItem(cascaded, dynamicContext) }
      }
      return { data: null }
    }

    // Fetch all missing configs in parallel
    const data = { ...(block.cascadedData || {}) }
    const fetchPromises = []

    for (const [schema, cfg] of configs) {
      if (data[schema] !== undefined) continue // already have from cascadedData
      fetchPromises.push(
        this.dataStore.fetch(cfg).then((result) => {
          if (result.data !== undefined && result.data !== null) {
            data[schema] = result.data
          }
        })
      )
    }

    if (fetchPromises.length > 0) {
      await Promise.all(fetchPromises)
    }

    const dynamicContext = block.dynamicContext || block.page.dynamicContext
    const resolved = this._resolveSingularItem(data, dynamicContext)
    return { data: resolved }
  }
}
