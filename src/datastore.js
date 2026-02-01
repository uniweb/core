/**
 * DataStore
 *
 * Runtime data cache that persists across SPA navigation.
 * Deduplicates in-flight fetches so concurrent callers share a single request.
 *
 * Core can't import runtime, so the fetcher function is registered at startup
 * via registerFetcher().
 */

/**
 * Build a stable cache key from a fetch config.
 * Only includes fields that affect the response.
 *
 * @param {Object} config
 * @returns {string}
 */
function cacheKey(config) {
  const { path, url, schema, transform } = config
  return JSON.stringify({ path, url, schema, transform })
}

export default class DataStore {
  constructor() {
    this._cache = new Map()
    this._inflight = new Map()
    this._fetcher = null
  }

  /**
   * Register the fetcher function (called by runtime at startup).
   * @param {Function} fn - (config) => Promise<{ data, error? }>
   */
  registerFetcher(fn) {
    this._fetcher = fn
  }

  /**
   * Check whether data for this config is cached.
   * @param {Object} config - Fetch config
   * @returns {boolean}
   */
  has(config) {
    return this._cache.has(cacheKey(config))
  }

  /**
   * Return cached data, or null on miss.
   * @param {Object} config - Fetch config
   * @returns {any|null}
   */
  get(config) {
    const key = cacheKey(config)
    return this._cache.has(key) ? this._cache.get(key) : null
  }

  /**
   * Store data in the cache.
   * @param {Object} config - Fetch config
   * @param {any} data
   */
  set(config, data) {
    this._cache.set(cacheKey(config), data)
  }

  /**
   * Fetch data with caching and in-flight deduplication.
   *
   * - Cache hit: returns immediately.
   * - In-flight: returns existing promise (no duplicate request).
   * - Miss: calls the registered fetcher, caches the result.
   *
   * @param {Object} config - Fetch config
   * @returns {Promise<{ data: any, error?: string }>}
   */
  async fetch(config) {
    if (!this._fetcher) {
      throw new Error('DataStore: no fetcher registered. Call registerFetcher() first.')
    }

    const key = cacheKey(config)

    // Cache hit
    if (this._cache.has(key)) {
      return { data: this._cache.get(key) }
    }

    // In-flight dedup
    if (this._inflight.has(key)) {
      return this._inflight.get(key)
    }

    // Miss — execute fetch
    const promise = this._fetcher(config).then((result) => {
      this._inflight.delete(key)
      if (result.data !== undefined && result.data !== null) {
        this._cache.set(key, result.data)
      }
      return result
    })

    this._inflight.set(key, promise)
    return promise
  }

  /**
   * Flush cache and in-flight map.
   */
  clear() {
    this._cache.clear()
    this._inflight.clear()
  }
}
