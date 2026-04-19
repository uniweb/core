/**
 * EntityStore
 *
 * Walks the block→page→parent→site cascade to find applicable fetch configs,
 * asks the Website's FetcherDispatcher to execute them, and assembles the
 * data payload passed to `prepare-props`.
 *
 * The cascade, localization, detail-query handling, and collection-first
 * content-gate logic all live here — unchanged from the pre-refactor model.
 * What changed: EntityStore no longer talks to DataStore directly. It calls
 * `website.fetcher.peek(request, ctx)` for the sync path (resolve) and
 * `website.fetcher.dispatch(request, ctx)` for the async path (fetch).
 * The dispatcher owns fetcher selection, cache-key derivation, cache lookup,
 * and in-flight dedup.
 */

import singularize from './singularize.js'
import { substitutePlaceholders } from './substitute-placeholders.js'

/**
 * Is `block.fetch` a per-instance refinement of the ancestor's fetch config
 * rather than a new source? The canonical spelling is `refine: true`; the
 * legacy spelling `inherit: true` is still honored for one release with a
 * dev-mode warning.
 */
function isRefinement(bf) {
  return bf?.refine === true || bf?.inherit === true
}

let inheritDeprecationWarned = false
function warnInheritDeprecation(block) {
  if (inheritDeprecationWarned) return
  inheritDeprecationWarned = true
  // Dev-only; production builds typically strip console.warn. We gate on
  // the presence of the deprecated key and fire once per process.
  console.warn(
    "[uniweb] 'fetch: { inherit: true }' is deprecated; rename to 'fetch: { refine: true }'. " +
    'Accepted for one release; will be removed in the next minor. ' +
    `First seen on block ${block?.id ?? '(unknown)'} of page ${block?.page?.route ?? '(unknown)'}.`
  )
}

export default class EntityStore {
  /**
   * @param {Object} options
   * @param {import('./website.js').default} options.website
   */
  constructor({ website }) {
    this.website = website
    Object.seal(this)
  }

  _shouldInheritDetail(meta, block) {
    const bf = block?.fetch
    if (isRefinement(bf) && bf?.detail !== undefined) return bf.detail !== false
    if (!meta) return true
    return meta.inheritDetail !== false
  }

  _inheritLimit(meta, block) {
    const bf = block?.fetch
    if (isRefinement(bf) && bf?.limit > 0) return bf.limit
    return (meta?.inheritLimit > 0) ? meta.inheritLimit : null
  }

  _inheritOrder(block) {
    const bf = block?.fetch
    if (isRefinement(bf) && bf?.order?.orderBy) return bf.order
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
   * Which schemas does this component want delivered?
   *
   * - meta missing → default-on: collect all available schemas.
   * - meta.inheritData === false → opt out entirely.
   * - Anything else → collect all (legacy inheritData arrays collapse here).
   */
  _getRequestedSchemas(meta) {
    if (!meta) return []
    if (meta.inheritData === false) return null
    return []
  }

  /**
   * Return a localized copy of a fetch config for collection data.
   * Non-default locales get /{locale} prefixed onto /data/ paths so the
   * client fetches the translated JSON (/fr/data/articles.json).
   */
  _localizeConfig(cfg, website) {
    if (!cfg.path || !website) return cfg
    const locale = website.getActiveLocale?.()
    const defaultLocale = website.getDefaultLocale?.()
    if (!locale || locale === defaultLocale) return cfg
    if (!cfg.path.startsWith('/data/')) return cfg
    return { ...cfg, path: `/${locale}${cfg.path}` }
  }

  /**
   * Walk the four-level hierarchy and collect fetch configs for the
   * requested schemas. First match per schema wins.
   */
  _findFetchConfigs(block, requested) {
    const configs = new Map()
    const collectAll = requested.length === 0
    const sources = []

    if (block.fetch?.inherit === true && block.fetch?.refine !== true) {
      warnInheritDeprecation(block)
    }
    if (block.fetch && !isRefinement(block.fetch)) sources.push(block.fetch)
    const page = block.page
    if (page?.fetch) sources.push(page.fetch)
    if (page?.parent?.fetch) sources.push(page.parent.fetch)
    const siteFetch = block.website?.config?.fetch
    if (siteFetch) sources.push(siteFetch)

    const website = block.website

    for (const source of sources) {
      const configList = Array.isArray(source) ? source : [source]
      for (const cfg of configList) {
        if (!cfg.schema) continue
        if (configs.has(cfg.schema)) continue
        if (collectAll || requested.includes(cfg.schema)) {
          const localized = this._localizeConfig(cfg, website)
          const withDetail = this._applyDeferredDetail(localized, website)
          configs.set(cfg.schema, withDetail)
        }
      }
    }
    return configs
  }

  /**
   * Auto-inject `detail:` on collection refs whose collection has
   * `deferred:` declared. The detail pattern points at the per-record
   * source so the existing dynamic-route singular flow fetches a record
   * with all fields (including the deferred ones) instead of the
   * matched-item-from-the-cascade-collection (without).
   *
   * Two patterns:
   *
   *   - Markdown-backed collections (the build emits per-record files
   *     at `/data/<name>/<slug>.json`): the auto-injected pattern is
   *     that path. `isLocalPath` resolution downstream gives the
   *     fetch a `path:` shape.
   *
   *   - API-backed collections (the source is a remote URL; the build
   *     emits no per-record files): the author declares a `detailUrl:`
   *     on the collection — e.g., `/api/articles/{slug}` — and the
   *     auto-injected pattern uses it. `isLocalPath` resolution
   *     downstream gives the fetch a `url:` shape (because the
   *     collection itself has `url:`, not `path:`).
   *
   * Conventions:
   *   - Per-record sources are keyed by `item.slug`. The injected
   *     pattern uses the `{slug}` placeholder; substitution works when
   *     the dynamic route's paramName is 'slug' (the documented
   *     convention). Routes with other param names need an explicit
   *     author-written `detail:` value.
   *   - Author-supplied `cfg.detail` always wins. This helper only fills
   *     in the default for collections that have declared deferred fields.
   *   - Per-record files are not currently localized; sites needing
   *     localized deferred collections write their own `detail:` URL.
   */
  _applyDeferredDetail(cfg, website) {
    if (cfg.detail !== undefined) return cfg
    const schema = cfg.schema
    if (!schema) return cfg
    const collConfig = website?.config?.collections?.[schema]
    if (!collConfig || typeof collConfig !== 'object') return cfg
    const deferred = Array.isArray(collConfig.deferred) ? collConfig.deferred : null
    if (!deferred || deferred.length === 0) return cfg
    const pattern = typeof collConfig.detailUrl === 'string'
      ? collConfig.detailUrl
      : `/data/${schema}/{slug}.json`
    return { ...cfg, detail: pattern }
  }

  /**
   * Build a detail-URL fetch config from a collection config + dynamic context.
   *
   * Three forms of `detail:`:
   *   - `'rest'`                — append paramValue as a path segment.
   *   - `'query'`               — append `?paramName=paramValue`.
   *   - `'/articles/{slug}'`    — custom URL pattern with {paramName} placeholders.
   *   - `{ body, envelope }`    — object form. Reuses the collection's url /
   *                               method / headers / auth; adds per-detail
   *                               body (with placeholder substitution) and
   *                               per-detail envelope.
   */
  _buildDetailConfig(collectionConfig, dynamicContext) {
    const { detail } = collectionConfig
    if (!detail) return null
    const { paramName, paramValue } = dynamicContext
    if (!paramName || paramValue === undefined) return null

    const baseUrl = collectionConfig.url || collectionConfig.path
    if (!baseUrl) return null
    const isLocalPath = !!collectionConfig.path && !collectionConfig.url

    // Object form: `detail: { body, envelope }`. Reuses collection's URL +
    // method + headers + auth. The body is placeholder-substituted against
    // the dynamic context so `body: { variables: { slug: "{slug}" } }` works.
    if (detail && typeof detail === 'object') {
      const out = {
        ...(isLocalPath ? { path: baseUrl } : { url: baseUrl }),
        schema: singularize(collectionConfig.schema) || collectionConfig.schema,
        transform: collectionConfig.transform,
      }
      if (collectionConfig.method) out.method = collectionConfig.method
      if (detail.body !== undefined) {
        out.body = substitutePlaceholders(detail.body, { [paramName]: paramValue }, { encode: false })
      } else if (collectionConfig.body !== undefined) {
        out.body = substitutePlaceholders(collectionConfig.body, { [paramName]: paramValue }, { encode: false })
      }
      if (detail.envelope) out.envelope = detail.envelope
      return out
    }

    // String-form: URL-based conventions.
    let detailUrl
    if (detail === 'rest') {
      const [basePath, queryString] = baseUrl.split('?')
      const cleanBase = basePath.replace(/\/$/, '')
      detailUrl = queryString
        ? `${cleanBase}/${encodeURIComponent(paramValue)}?${queryString}`
        : `${cleanBase}/${encodeURIComponent(paramValue)}`
    } else if (detail === 'query') {
      const sep = baseUrl.includes('?') ? '&' : '?'
      detailUrl = `${baseUrl}${sep}${paramName}=${encodeURIComponent(paramValue)}`
    } else {
      // Custom pattern like '/articles/{slug}' — substitute placeholders
      // from the dynamic-route context. Only placeholders matching the
      // active paramName resolve; others pass through as literal `{name}`.
      detailUrl = substitutePlaceholders(detail, { [paramName]: paramValue })
    }

    return {
      ...(isLocalPath ? { path: detailUrl } : { url: detailUrl }),
      schema: singularize(collectionConfig.schema) || collectionConfig.schema,
      transform: collectionConfig.transform,
    }
  }

  /**
   * For dynamic routes: extract the matching item from a collection and
   * expose it under the singular schema key (articles → article).
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
   * Build the `ctx` handed to the dispatcher for a given block.
   * @private
   */
  _ctx(block, extra = {}) {
    return {
      website: this.website,
      page: block?.page || null,
      block: block || null,
      signal: extra.signal,
    }
  }

  /**
   * Sync resolution — probes the cache via `fetcher.peek`. Returns
   * `ready` only when every relevant entry is cached, otherwise `pending`
   * (caller falls through to `fetch()` to populate and await).
   *
   * @returns {{ status: 'ready'|'pending'|'none', data: Object|null }}
   */
  resolve(block, meta) {
    const dispatcher = this.website?.fetcher
    let requested = this._getRequestedSchemas(meta)

    // If the component hasn't declared data inheritance but the block itself
    // has a fetch config, target the block's schema explicitly rather than
    // collecting all cascade matches.
    if (requested === null && block.fetch) {
      const blockFetchList = Array.isArray(block.fetch) ? block.fetch : [block.fetch]
      const schemas = blockFetchList.filter((cfg) => cfg.schema).map((cfg) => cfg.schema)
      if (schemas.length > 0) requested = schemas
    }

    if (requested === null) return { status: 'none', data: null }

    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) return { status: 'none', data: null }

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const inheritDetail = this._shouldInheritDetail(meta, block)
    const limit = this._inheritLimit(meta, block)
    const order = this._inheritOrder(block)
    const ctx = this._ctx(block)

    const data = {}
    let allCached = true

    for (const [schema, cfg] of configs) {
      if (dynamicContext && cfg.detail && !inheritDetail) {
        // detail: false — return collection minus the active item.
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          const { paramName, paramValue } = dynamicContext
          const items = cached.data
          let filtered = Array.isArray(items)
            ? items.filter((item) => String(item[paramName]) !== String(paramValue))
            : items
          if (order) filtered = this._sortItems(filtered, order)
          data[schema] = limit && Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
        } else {
          allCached = false
        }
      } else if (dynamicContext && cfg.detail) {
        // Collection-first detail: the collection is the content gate.
        const cachedCollection = dispatcher?.peek(cfg, ctx)
        if (cachedCollection) {
          const collectionItems = cachedCollection.data
          const { paramName, paramValue } = dynamicContext
          const singularKey = singularize(schema) || schema
          const match = Array.isArray(collectionItems)
            ? collectionItems.find((item) => String(item[paramName]) === String(paramValue))
            : null

          if (!match) {
            data[singularKey] = null
          } else {
            const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
            const detailCached = detailCfg ? dispatcher?.peek(detailCfg, ctx) : null
            if (detailCfg && detailCached) {
              data[singularKey] = detailCached.data
            } else if (detailCfg) {
              allCached = false
            } else {
              data[singularKey] = match
            }
          }
        } else {
          allCached = false
        }
      } else {
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          const items = cached.data
          data[schema] = order ? this._sortItems(items, order) : items
        } else {
          allCached = false
        }
      }
    }

    if (allCached) {
      const resolved = this._resolveSingularItem(data, dynamicContext)
      return { status: 'ready', data: resolved }
    }
    return { status: 'pending', data: null }
  }

  /**
   * Async fetch — dispatches missing configs through the FetcherDispatcher
   * and assembles the result. Collection-first detail ordering preserved.
   *
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] - Forwarded to the dispatcher.
   * @returns {Promise<{ data: Object|null }>}
   */
  async fetch(block, meta, { signal } = {}) {
    const dispatcher = this.website?.fetcher
    if (!dispatcher) return { data: null }

    let requested = this._getRequestedSchemas(meta)
    if (requested === null && block.fetch) {
      const blockFetchList = Array.isArray(block.fetch) ? block.fetch : [block.fetch]
      const schemas = blockFetchList.filter((cfg) => cfg.schema).map((cfg) => cfg.schema)
      if (schemas.length > 0) requested = schemas
    }
    if (requested === null) return { data: null }

    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) return { data: null }

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const inheritDetail = this._shouldInheritDetail(meta, block)
    const limit = this._inheritLimit(meta, block)
    const order = this._inheritOrder(block)
    const ctx = this._ctx(block, { signal })

    const data = {}
    const parallelFetches = []

    for (const [schema, cfg] of configs) {
      if (dynamicContext && cfg.detail && !inheritDetail) {
        // detail: false — collection-only, minus the active item.
        let collectionItems = peekArray(dispatcher, cfg, ctx)
        if (collectionItems === null) {
          const result = await dispatcher.dispatch(cfg, ctx)
          collectionItems = Array.isArray(result?.data) ? result.data : null
        }
        const { paramName, paramValue } = dynamicContext
        let filtered = Array.isArray(collectionItems)
          ? collectionItems.filter((item) => String(item[paramName]) !== String(paramValue))
          : (collectionItems ?? [])
        if (order) filtered = this._sortItems(filtered, order)
        data[schema] = limit && Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
      } else if (dynamicContext && cfg.detail) {
        // Collection-first detail resolution.
        const { paramName, paramValue } = dynamicContext
        const singularKey = singularize(schema) || schema

        let collectionItems = peekArray(dispatcher, cfg, ctx)
        if (collectionItems === null) {
          const result = await dispatcher.dispatch(cfg, ctx)
          collectionItems = Array.isArray(result?.data) ? result.data : null
        }

        const match = collectionItems?.find(
          (item) => String(item[paramName]) === String(paramValue)
        ) ?? null

        if (!match) {
          data[singularKey] = null
          continue
        }

        const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
        if (detailCfg) {
          parallelFetches.push(
            dispatcher.dispatch(detailCfg, ctx).then((result) => {
              data[singularKey] = (result?.data !== undefined && result?.data !== null)
                ? result.data
                : match
            })
          )
        } else {
          data[singularKey] = match
        }
      } else {
        parallelFetches.push(
          dispatcher.dispatch(cfg, ctx).then((result) => {
            if (result?.data !== undefined && result?.data !== null) {
              data[schema] = result.data
            }
          })
        )
      }
    }

    if (parallelFetches.length > 0) await Promise.all(parallelFetches)
    const resolved = this._resolveSingularItem(data, dynamicContext)
    return { data: resolved }
  }
}

/**
 * Sync-peek helper: return the cached array for a config, or null on miss.
 */
function peekArray(dispatcher, cfg, ctx) {
  const cached = dispatcher.peek(cfg, ctx)
  if (!cached) return null
  return Array.isArray(cached.data) ? cached.data : null
}
