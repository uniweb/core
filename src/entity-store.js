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

    Object.seal(this)
  }

  /**
   * Whether a component wants detail-URL resolution on dynamic pages.
   * Default true. Set to false via `data: { inherit: true, detail: false }`
   * to receive the full collection (minus the active item) instead.
   *
   * @param {Object} meta
   * @returns {boolean}
   */
  _shouldInheritDetail(meta, block) {
    // Block-level fetch inherit override takes priority over meta
    const bf = block?.fetch
    if (bf?.inherit === true && bf?.detail !== undefined) return bf.detail !== false
    if (!meta) return true
    return meta.inheritDetail !== false
  }

  _inheritLimit(meta, block) {
    // Block-level fetch inherit override takes priority over meta
    const bf = block?.fetch
    if (bf?.inherit === true && bf?.limit > 0) return bf.limit
    return (meta?.inheritLimit > 0) ? meta.inheritLimit : null
  }

  _inheritOrder(block) {
    const bf = block?.fetch
    if (bf?.inherit === true && bf?.order?.orderBy) return bf.order
    return null
  }

  _sortItems(items, order) {
    if (!order?.orderBy || !Array.isArray(items) || items.length === 0) return items
    const { orderBy, sortOrder = 'ASC' } = order
    const desc = sortOrder === 'DESC'
    return [...items].sort((a, b) => {
      const av = a[orderBy] ?? ''
      const bv = b[orderBy] ?? ''
      const cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : (av > bv ? 1 : av < bv ? -1 : 0)
      return desc ? -cmp : cmp
    })
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
   * Return a localized copy of a fetch config for collection data.
   * For non-default locales, prepends /{locale} to /data/ paths so the
   * client fetches the translated JSON (e.g. /fr/data/articles.json).
   *
   * @param {Object} cfg - Fetch config
   * @param {import('./website.js').default|null} website
   * @returns {Object} Localized config (or original if no change needed)
   */
  _localizeConfig(cfg, website) {
    if (!cfg.path || !website) return cfg

    const locale = website.getActiveLocale()
    const defaultLocale = website.getDefaultLocale()
    if (!locale || locale === defaultLocale) return cfg

    if (!cfg.path.startsWith('/data/')) return cfg

    return { ...cfg, path: `/${locale}${cfg.path}` }
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

    // 1. Block-level fetch (skip inherit-merge configs — they have no URL, only override props)
    if (block.fetch && !block.fetch.inherit) {
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

    const website = block.website

    for (const source of sources) {
      // Normalize: single config or array of configs
      const configList = Array.isArray(source) ? source : [source]

      for (const cfg of configList) {
        if (!cfg.schema) continue
        if (configs.has(cfg.schema)) continue // first match wins

        if (collectAll || requested.includes(cfg.schema)) {
          configs.set(cfg.schema, this._localizeConfig(cfg, website))
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
      // Preserve query string (auth params like token, profileLang) — only insert
      // the param value before the '?', not after.
      const [basePath, queryString] = baseUrl.split('?')
      const cleanBase = basePath.replace(/\/$/, '')
      detailUrl = queryString
        ? `${cleanBase}/${encodeURIComponent(paramValue)}?${queryString}`
        : `${cleanBase}/${encodeURIComponent(paramValue)}`
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
    let requested = this._getRequestedSchemas(meta)

    // If the component doesn't declare inheritData but the block itself
    // has a fetch config (e.g. data_source_info converted to fetch),
    // use the block's schema directly. Block-level fetch is an explicit
    // data assignment, not inheritance.
    if (requested === null && block.fetch) {
      const blockFetchList = Array.isArray(block.fetch) ? block.fetch : [block.fetch]
      const schemas = blockFetchList
        .filter((cfg) => cfg.schema)
        .map((cfg) => cfg.schema)
      if (schemas.length > 0) {
        requested = schemas
      }
    }

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
    const inheritDetail = this._shouldInheritDetail(meta, block)
    const limit = this._inheritLimit(meta, block)
    const order = this._inheritOrder(block)
    const data = {}
    let allCached = true

    for (const [schema, cfg] of configs) {
      if (dynamicContext && cfg.detail && !inheritDetail) {
        // detail: false — return collection minus the active item (sidebar/related use case)
        if (this.dataStore.has(cfg)) {
          const { paramName, paramValue } = dynamicContext
          const items = this.dataStore.get(cfg)
          let filtered = Array.isArray(items)
            ? items.filter((item) => String(item[paramName]) !== String(paramValue))
            : items
          if (order) filtered = this._sortItems(filtered, order)
          data[schema] = limit && Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
        } else {
          allCached = false
        }
      } else if (dynamicContext && cfg.detail) {
        // Collection-first detail resolution:
        // The collection acts as the access gate — the item must exist in the
        // cached collection before we'll serve (or fetch) its detail data.
        if (this.dataStore.has(cfg)) {
          const collectionItems = this.dataStore.get(cfg)
          const { paramName, paramValue } = dynamicContext
          const singularKey = singularize(schema) || schema
          const match = Array.isArray(collectionItems)
            ? collectionItems.find((item) => String(item[paramName]) === String(paramValue))
            : null

          if (!match) {
            // Item not in collection — definitive "not found" (content gate).
            data[singularKey] = null
          } else {
            // Item is valid. Check if the detail result is already cached.
            const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
            if (detailCfg && this.dataStore.has(detailCfg)) {
              data[singularKey] = this.dataStore.get(detailCfg)
            } else if (detailCfg) {
              allCached = false // Collection cached, item valid, detail still needed
            } else {
              data[singularKey] = match // No detail URL — use collection item directly
            }
          }
        } else {
          allCached = false // Collection not yet cached — must fetch it first
        }
      } else if (this.dataStore.has(cfg)) {
        const items = this.dataStore.get(cfg)
        data[schema] = order ? this._sortItems(items, order) : items
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
    let requested = this._getRequestedSchemas(meta)

    // Same block-level fetch fallback as resolve()
    if (requested === null && block.fetch) {
      const blockFetchList = Array.isArray(block.fetch) ? block.fetch : [block.fetch]
      const schemas = blockFetchList
        .filter((cfg) => cfg.schema)
        .map((cfg) => cfg.schema)
      if (schemas.length > 0) {
        requested = schemas
      }
    }

    if (requested === null) {
      return { data: null }
    }

    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) {
      return { data: null }
    }

    // Fetch all missing configs
    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const inheritDetail = this._shouldInheritDetail(meta, block)
    const limit = this._inheritLimit(meta, block)
    const order = this._inheritOrder(block)

    const data = {}
    const parallelFetches = []

    for (const [schema, cfg] of configs) {
      if (dynamicContext && cfg.detail && !inheritDetail) {
        // detail: false — fetch collection and return it minus the active item
        // (sidebar / related-posts use case on a dynamic page)
        let collectionItems = this.dataStore.has(cfg) ? this.dataStore.get(cfg) : null
        if (collectionItems === null) {
          const result = await this.dataStore.fetch(cfg)
          collectionItems = Array.isArray(result.data) ? result.data : null
        }
        const { paramName, paramValue } = dynamicContext
        let filtered = Array.isArray(collectionItems)
          ? collectionItems.filter((item) => String(item[paramName]) !== String(paramValue))
          : (collectionItems ?? [])
        if (order) filtered = this._sortItems(filtered, order)
        data[schema] = limit && Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
      } else if (dynamicContext && cfg.detail) {
        // Collection-first detail resolution:
        // 1. Ensure the collection is in DataStore (fetching if needed).
        // 2. Validate that paramValue exists in the collection (content gate).
        // 3. Only then fetch the detail URL for richer item data.
        const { paramName, paramValue } = dynamicContext
        const singularKey = singularize(schema) || schema

        // Step 1: ensure collection is cached (sequential — needed for validation)
        let collectionItems = this.dataStore.has(cfg) ? this.dataStore.get(cfg) : null
        if (collectionItems === null) {
          const result = await this.dataStore.fetch(cfg)
          collectionItems = Array.isArray(result.data) ? result.data : null
        }

        // Step 2: validate paramValue is in the collection (content gate)
        const match = collectionItems?.find(
          (item) => String(item[paramName]) === String(paramValue)
        ) ?? null

        if (!match) {
          data[singularKey] = null // Not in collection — content gate
          continue
        }

        // Step 3: fetch detail URL for richer data; fall back to collection item
        const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
        if (detailCfg) {
          parallelFetches.push(
            this.dataStore.fetch(detailCfg).then((result) => {
              data[singularKey] = (result.data !== undefined && result.data !== null)
                ? result.data
                : match // fallback: collection item is still valid
            })
          )
        } else {
          data[singularKey] = match // No detail URL — collection item is enough
        }
      } else {
        // Default: fetch the full collection
        parallelFetches.push(
          this.dataStore.fetch(cfg).then((result) => {
            if (result.data !== undefined && result.data !== null) {
              data[schema] = result.data
            }
          })
        )
      }
    }

    if (parallelFetches.length > 0) {
      await Promise.all(parallelFetches)
    }
    const resolved = this._resolveSingularItem(data, dynamicContext)
    return { data: resolved }
  }
}
