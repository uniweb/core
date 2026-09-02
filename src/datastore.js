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
 * Fields that contribute to the key:
 *   - path, url       — what resource is being fetched
 *   - schema          — which entity type the response will be stored under
 *   - transform       — any per-fetch response unwrap; different transforms
 *                       of the same endpoint produce different cached data
 *   - method (POST)   — POST requests may share a URL with GET; don't collide
 *   - body (POST)     — two POSTs to the same URL with different bodies are
 *                       different queries; must cache distinctly
 *
 * Post-processing fields like `limit`, `sort`, `filter` are applied after
 * fetch and must not split the cache.
 *
 * @param {Object} request - Normalized request (or fetch config)
 * @returns {string} A stable JSON string usable as a cache-Map key
 */
export function deriveCacheKey(request) {
  // ⭐ `as` is the binding key; `schema` is the name it had until 2026-09-02 and
  // still arrives on every payload published before then. Normalised HERE so one
  // logical request hashes to one key whichever spelling reached us — a consumer
  // deriving a key must not get two entries for the same fetch.
  const { path, url, endpoint, transform } = request || {}
  const as = request?.as ?? request?.schema
  const method = request?.method && request.method.toUpperCase() !== 'GET'
    ? request.method.toUpperCase()
    : undefined
  const body = method === 'POST' ? request?.body : undefined
  // ⚠️ The field NAME is part of the hash, so renaming it moves every key ONCE.
  // In-memory stores repopulate; a consumer with a persistent cache takes one
  // cold pass. Chosen over hashing under the old name, which would have hidden
  // the rename inside the one function whose job is to be canonical.
  return JSON.stringify({ path, url, endpoint, as, transform, method, body })
}

export default class DataStore {
  constructor() {
    // key → { data, meta? }
    this._cache = new Map()
    // key → { promise, signals: Set<AbortSignal> }
    this._inflight = new Map()
    // Notified on every successful `set()`.
    this._listeners = new Set()
    // Key-scoped listeners: key → Set<Function>
    this._keyedListeners = new Map()

    Object.seal(this)
  }

  /**
   * Subscribe to cache updates.
   *
   * Two forms:
   *   - `subscribe(fn)`      — fires after every successful `set()` (all keys).
   *   - `subscribe(key, fn)` — fires only when `set(key, ...)` or `delete(key)` is called.
   *
   * The global form is useful for debugging / blanket observers. The keyed
   * form is what Layer-3 kit hooks (`useFetched`, `useCacheEntry`) use so
   * a cache write for one request doesn't wake up every subscriber.
   *
   * @param {string|Function} keyOrFn
   * @param {Function} [maybeFn]
   * @returns {Function} unsubscribe
   */
  subscribe(keyOrFn, maybeFn) {
    if (typeof keyOrFn === 'string' && typeof maybeFn === 'function') {
      const key = keyOrFn
      let set = this._keyedListeners.get(key)
      if (!set) {
        set = new Set()
        this._keyedListeners.set(key, set)
      }
      set.add(maybeFn)
      return () => {
        const s = this._keyedListeners.get(key)
        if (!s) return
        s.delete(maybeFn)
        if (s.size === 0) this._keyedListeners.delete(key)
      }
    }
    if (typeof keyOrFn === 'function') {
      this._listeners.add(keyOrFn)
      return () => this._listeners.delete(keyOrFn)
    }
    throw new TypeError('DataStore.subscribe: expected (fn) or (key, fn)')
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
   * Cache store. Fires listeners: first the global ones (all-writes), then
   * any subscribers registered for this specific key.
   *
   * @param {string} key
   * @param {{ data: any, meta?: Object }} entry
   */
  set(key, entry) {
    this._cache.set(key, entry)
    for (const fn of this._listeners) fn()
    const keyed = this._keyedListeners.get(key)
    if (keyed) {
      for (const fn of keyed) fn()
    }
  }

  /**
   * Drop one entry, and any in-flight record for the same key.
   *
   * Fires the key's subscribers (and the global ones) so an observer re-reads
   * and sees the absence, exactly as it would see a write. Exists for the case
   * `clear()` is too blunt for: one consumer's entries must leave memory — a
   * viewer's records at sign-out — while everything else stays warm.
   *
   * @param {string} key
   * @returns {boolean} true if an entry was removed
   */
  delete(key) {
    const had = this._cache.delete(key)
    this._inflight.delete(key)
    if (!had) return false
    for (const fn of this._listeners) fn()
    const keyed = this._keyedListeners.get(key)
    if (keyed) {
      for (const fn of keyed) fn()
    }
    return true
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
   * Flush cache and in-flight map. Listeners are preserved so subscribers
   * that outlive the cache (kit hooks waiting on a key) aren't orphaned.
   */
  clear() {
    this._cache.clear()
    this._inflight.clear()
  }
}
