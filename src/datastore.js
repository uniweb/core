/**
 * DataStore
 *
 * Pure keyed cache with in-flight deduplication. Persists across SPA navigation.
 *
 * Owned by the Website; accessed only by the FetcherDispatcher (which computes
 * cache keys and runs fetchers) and by build-time / startup preload paths
 * (which write entries keyed by the default cache key so runtime cache probes
 * find them).
 *
 * No knowledge of fetchers, transports, or cascades. Keys are opaque strings.
 */

/**
 * Default cache-key derivation for a request or fetch config.
 *
 * The framework's default URL fetcher and the build-time preload path both
 * use this key shape. Fetchers with state-dependent requests (e.g., a query
 * slug read from `page.state`) must declare their own `cacheKey(request)`
 * on the fetcher so reactive changes miss the cache and re-fetch.
 *
 * Only the four fields that affect the response contribute to the key.
 * Post-processing fields like `limit`, `sort`, `filter` are applied after
 * fetch and must not split the cache.
 *
 * @param {Object} request - Normalized request (or fetch config)
 * @returns {string} A stable JSON string usable as a cache-Map key
 */
export function defaultCacheKey(request) {
  const { path, url, schema, transform } = request || {}
  return JSON.stringify({ path, url, schema, transform })
}

export default class DataStore {
  constructor() {
    // key → { data, meta? }
    this._cache = new Map()
    // key → { promise, signals: Set<AbortSignal> }
    this._inflight = new Map()
    // Notified on every successful `set()`.
    this._listeners = new Set()

    Object.seal(this)
  }

  /**
   * Subscribe to cache updates. Fires after every successful `set()`.
   *
   * @param {Function} fn - Listener called with no arguments
   * @returns {Function} unsubscribe
   */
  subscribe(fn) {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  /**
   * Cache presence check.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._cache.has(key)
  }

  /**
   * Cache lookup.
   *
   * @param {string} key
   * @returns {{ data: any, meta?: Object } | null}
   */
  get(key) {
    return this._cache.has(key) ? this._cache.get(key) : null
  }

  /**
   * Cache store. Fires listeners.
   *
   * @param {string} key
   * @param {{ data: any, meta?: Object }} entry
   */
  set(key, entry) {
    this._cache.set(key, entry)
    for (const fn of this._listeners) fn()
  }

  /**
   * In-flight fetch registry — used by the dispatcher to dedup concurrent
   * requests and collect abort signals so the underlying fetch is cancelled
   * only when every attached block aborts.
   *
   * @returns {Map<string, { promise: Promise, signals: Set<AbortSignal> }>}
   */
  get inflight() {
    return this._inflight
  }

  /**
   * Flush cache and in-flight map.
   */
  clear() {
    this._cache.clear()
    this._inflight.clear()
  }
}
