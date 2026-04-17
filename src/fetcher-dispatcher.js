/**
 * FetcherDispatcher
 *
 * Assembled by the Website from the primary foundation's declaration plus any
 * extensions. Resolves which fetcher handles a given request, owns cache-key
 * derivation, checks the DataStore, dedups concurrent in-flight requests, and
 * passes an AbortSignal through to the selected fetcher.
 *
 * See kb/framework/plans/data-transport-architecture.md Part 2 for the full
 * request/context/return shapes and resolution order. The dispatcher is the
 * only layer that touches DataStore directly; EntityStore calls the
 * dispatcher's `peek` / `dispatch` methods and never goes around it.
 */
import { defaultCacheKey } from './datastore.js'

function normalizeFetcherSpec(raw) {
  if (!raw || typeof raw !== 'object') return { routes: [], fallback: null }
  const routes = Array.isArray(raw.routes) ? raw.routes.filter(Boolean) : []
  const fallback = raw.fallback && typeof raw.fallback.resolve === 'function' ? raw.fallback : null
  return { routes, fallback }
}

/**
 * Extract the declaration object from a foundation — either an ESM module
 * with a default export, or an already-plain declaration (used by the
 * editor's wrap-and-replace-fetcher pattern).
 */
function getFoundationDecl(mod) {
  if (!mod) return null
  if (mod.default && typeof mod.default === 'object') return mod.default
  if (typeof mod === 'object') return mod
  return null
}

export default class FetcherDispatcher {
  /**
   * @param {Object} options
   * @param {Object|null} options.foundation - Primary foundation module or declaration.
   * @param {Array<Object>} [options.extensions] - Extension modules or declarations.
   * @param {Object} options.dataStore - The Website's DataStore.
   * @param {{ resolve: Function }} [options.defaultFetcher] - Framework default
   *   used when no route matches and the primary foundation declares no fallback.
   */
  constructor({ foundation, extensions = [], dataStore, defaultFetcher = null }) {
    if (!dataStore) throw new Error('FetcherDispatcher: dataStore is required')
    this._dataStore = dataStore
    this._defaultFetcher = defaultFetcher

    const primary = normalizeFetcherSpec(getFoundationDecl(foundation)?.fetcher)
    this._primaryRoutes = primary.routes
    this._primaryFallback = primary.fallback

    // Extensions contribute routes, not fallbacks.
    this._extensionRoutes = []
    for (const ext of extensions) {
      const spec = normalizeFetcherSpec(getFoundationDecl(ext)?.fetcher)
      for (const route of spec.routes) this._extensionRoutes.push(route)
    }

    Object.freeze(this)
  }

  /**
   * Select the fetcher for a request. Walks primary routes → extension routes
   * → primary fallback → framework default.
   */
  _selectFetcher(request, ctx) {
    for (const route of this._primaryRoutes) {
      if (this._matches(route, request, ctx)) return route
    }
    for (const route of this._extensionRoutes) {
      if (this._matches(route, request, ctx)) return route
    }
    if (this._primaryFallback) return this._primaryFallback
    return this._defaultFetcher
  }

  _matches(route, request, ctx) {
    if (typeof route.resolve !== 'function') return false
    if (typeof route.match !== 'function') return true
    try {
      return !!route.match(request, ctx)
    } catch (err) {
      console.warn('[FetcherDispatcher] route.match threw:', err)
      return false
    }
  }

  _cacheKey(fetcher, request) {
    if (fetcher && typeof fetcher.cacheKey === 'function') {
      try {
        return String(fetcher.cacheKey(request))
      } catch (err) {
        console.warn('[FetcherDispatcher] fetcher.cacheKey threw:', err)
      }
    }
    return defaultCacheKey(request)
  }

  /**
   * Synchronous cache probe. Selects the fetcher (for key derivation), checks
   * DataStore, returns the cached `{ data, meta }` entry or null. Never starts
   * a fetch. Used by EntityStore.resolve() and anywhere else that wants a
   * side-effect-free lookup.
   */
  peek(request, ctx = {}) {
    const fetcher = this._selectFetcher(request, ctx)
    const key = this._cacheKey(fetcher, request)
    return this._dataStore.get(key)
  }

  /**
   * Full dispatch — selection, cache check, in-flight dedup, execution.
   *
   *   Cache hit        → returns a resolved promise with the cached entry.
   *   In-flight match  → attaches the caller's signal, awaits the shared promise.
   *   Miss             → runs fetcher, stores on success, returns the result.
   *
   * Signal semantics: the dispatcher owns a master `AbortController` per
   * in-flight entry. The fetcher sees the master's signal in `ctx.signal`;
   * each caller's own signal is attached for bookkeeping. The master aborts
   * only when every attached signal has aborted — so cancelling one block
   * doesn't kill a fetch another block still needs.
   *
   * Error isolation: thrown exceptions and malformed returns surface as
   * `{ data: [], error }` and never poison the cache. Successful results
   * containing an `error` field are passed through unchanged and not cached.
   */
  async dispatch(request, ctx = {}) {
    const fetcher = this._selectFetcher(request, ctx)
    if (!fetcher) {
      return { data: [], error: 'FetcherDispatcher: no fetcher selected and no default configured' }
    }

    const key = this._cacheKey(fetcher, request)

    const cached = this._dataStore.get(key)
    if (cached) return { data: cached.data, meta: cached.meta }

    const existing = this._dataStore.inflight.get(key)
    if (existing) {
      this._attachSignal(existing, ctx.signal)
      return existing.promise
    }

    const master = typeof AbortController !== 'undefined' ? new AbortController() : null
    const inflight = {
      promise: null,
      master,
      signals: new Set(),
      everAttached: false,
    }

    this._attachSignal(inflight, ctx.signal)
    this._dataStore.inflight.set(key, inflight)

    const innerCtx = master ? { ...ctx, signal: master.signal } : ctx
    inflight.promise = this._runFetcher(fetcher, request, innerCtx, key, inflight)
    return inflight.promise
  }

  /**
   * Attach a caller's AbortSignal to an in-flight entry. Aborting a signal
   * removes it from the entry's set; when every attached signal has aborted
   * (and at least one was ever attached), the master controller fires so the
   * underlying fetch can bail out.
   */
  _attachSignal(inflight, signal) {
    if (!signal) return
    if (!inflight.master) return

    inflight.everAttached = true

    if (signal.aborted) {
      this._maybeAbortMaster(inflight)
      return
    }

    inflight.signals.add(signal)
    const onAbort = () => {
      inflight.signals.delete(signal)
      this._maybeAbortMaster(inflight)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  _maybeAbortMaster(inflight) {
    if (!inflight.master) return
    if (inflight.master.signal.aborted) return
    if (!inflight.everAttached) return
    if (inflight.signals.size > 0) return
    inflight.master.abort()
  }

  async _runFetcher(fetcher, request, ctx, key, inflight) {
    try {
      const result = await fetcher.resolve(request, ctx)

      if (this._dataStore.inflight.get(key) === inflight) {
        this._dataStore.inflight.delete(key)
      }

      if (!result || typeof result !== 'object') {
        return { data: [], error: 'Fetcher returned a non-object' }
      }

      const { data, error, meta } = result
      if (error) return { data: data ?? [], error, meta }

      if (data === undefined || data === null) {
        // Nothing meaningful to cache; surface as-is.
        return { data: data ?? [], meta }
      }

      const entry = meta !== undefined ? { data, meta } : { data }
      this._dataStore.set(key, entry)
      return { data, meta }
    } catch (err) {
      if (this._dataStore.inflight.get(key) === inflight) {
        this._dataStore.inflight.delete(key)
      }
      return { data: [], error: String(err?.message || err) }
    }
  }
}
