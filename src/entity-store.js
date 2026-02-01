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
   * Order: block.fetch → page.fetch → parent.fetch → site config.fetch
   * First match per schema wins. Only walks one parent level (auto-wiring).
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

    // 2. Page-level fetch
    const page = block.page
    if (page?.fetch) {
      sources.push(page.fetch)
    }

    // 3. Parent page fetch (one level — auto-wiring for dynamic routes)
    if (page?.parent?.fetch) {
      sources.push(page.parent.fetch)
    }

    // 4. Site-level fetch
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
   * Build a fetch config for a single entity using the detail convention.
   *
   * @param {Object} collectionConfig - The collection's fetch config (must have `detail`)
   * @param {Object} dynamicContext - { paramName, paramValue, schema }
   * @returns {Object|null} A fetch config for the single entity, or null
   */
  _buildDetailConfig(collectionConfig, dynamicContext) {
    const { detail } = collectionConfig
    if (!detail) return null

    const { paramName, paramValue } = dynamicContext
    if (!paramName || paramValue === undefined) return null

    const baseUrl = collectionConfig.url || collectionConfig.path
    if (!baseUrl) return null

    let detailUrl

    if (detail === 'rest') {
      // REST convention: {baseUrl}/{paramValue}
      detailUrl = `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(paramValue)}`
    } else if (detail === 'query') {
      // Query param convention: {baseUrl}?{paramName}={paramValue}
      const sep = baseUrl.includes('?') ? '&' : '?'
      detailUrl = `${baseUrl}${sep}${paramName}=${encodeURIComponent(paramValue)}`
    } else {
      // Custom pattern: replace {paramName} placeholders
      detailUrl = detail.replace(/\{(\w+)\}/g, (_, key) => {
        if (key === paramName) return encodeURIComponent(paramValue)
        return `{${key}}` // leave unknown placeholders
      })
    }

    // Build a fetch config for the single item
    const isLocalPath = !!collectionConfig.path && !collectionConfig.url
    return {
      ...(isLocalPath ? { path: detailUrl } : { url: detailUrl }),
      schema: singularize(collectionConfig.schema) || collectionConfig.schema,
      transform: collectionConfig.transform,
    }
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
   * Sync resolution. Checks DataStore cache for fetch configs found in hierarchy.
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

    // Walk hierarchy for fetch configs
    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) {
      return { status: 'none', data: null }
    }

    // Check DataStore cache for each config
    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const data = {}
    let allCached = true

    for (const [schema, cfg] of configs) {
      if (this.dataStore.has(cfg)) {
        data[schema] = this.dataStore.get(cfg)
      } else if (dynamicContext && cfg.detail) {
        // Detail query: check if the single-entity result is cached
        const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
        if (detailCfg && this.dataStore.has(detailCfg)) {
          const singularKey = singularize(schema) || schema
          data[singularKey] = this.dataStore.get(detailCfg)
        } else {
          allCached = false
        }
      } else {
        allCached = false
      }
    }

    if (allCached) {
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
      return { data: null }
    }

    // Fetch all missing configs in parallel
    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const data = {}
    const fetchPromises = []

    for (const [schema, cfg] of configs) {
      // Detail query optimization: on template pages, if the collection
      // isn't cached and a detail convention is defined, fetch just the
      // single entity instead of the full collection.
      if (dynamicContext && cfg.detail && !this.dataStore.has(cfg)) {
        const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
        if (detailCfg) {
          fetchPromises.push(
            this.dataStore.fetch(detailCfg).then((result) => {
              if (result.data !== undefined && result.data !== null) {
                const singularKey = singularize(schema) || schema
                data[singularKey] = result.data
              }
            })
          )
          continue // skip collection fetch for this schema
        }
      }

      // Default: fetch the full collection
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
    const resolved = this._resolveSingularItem(data, dynamicContext)
    return { data: resolved }
  }
}
