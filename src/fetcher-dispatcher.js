/**
 * FetcherDispatcher
 *
 * Assembled by the Website from the primary foundation's named transports
 * plus any extensions'. Resolves which fetcher handles a given request by
 * name lookup — the site selects per-schema in `site.yml fetcher.transports`.
 *
 * The dispatcher owns cache-key derivation, checks the DataStore, dedups
 * concurrent in-flight requests, and passes an AbortSignal through to the
 * selected fetcher. A runtime `transport` override (editor preview bridge)
 * bypasses all of that and handles every request directly.
 *
 * The dispatcher is the only layer that touches DataStore directly;
 * EntityStore calls the dispatcher's `peek` / `dispatch` methods and
 * never goes around it.
 */
import { deriveCacheKey } from './datastore.js'

/**
 * Extract the declaration object from a foundation — either an ESM module
 * with a default export, or an already-plain declaration.
 */
function getFoundationDecl(mod) {
  if (!mod) return null
  if (mod.default && typeof mod.default === 'object') return mod.default
  if (typeof mod === 'object') return mod
  return null
}

function isValidTransport(t) {
  return !!t && typeof t.resolve === 'function'
}

/**
 * Collect transports from a foundation declaration, returning a Map
 * `name → transport`. Throwing or malformed entries are dropped with a
 * dev-mode warning so a single bad transport never tears down the
 * registry. This mirrors the `Promise.allSettled` pattern the runtime
 * uses when loading extensions — one bad extension doesn't block the site.
 */
function collectTransports(decl, { source, dev }) {
  const out = new Map()
  if (!decl) return out

  let raw
  try {
    raw = decl.transports
  } catch (err) {
    if (dev) console.warn(`[FetcherDispatcher] ${source} transports getter threw:`, err)
    return out
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out

  for (const name of Object.keys(raw)) {
    let t
    try {
      t = raw[name]
    } catch (err) {
      if (dev) {
        console.warn(`[FetcherDispatcher] ${source} transport "${name}" getter threw:`, err)
      }
      continue
    }
    if (!isValidTransport(t)) {
      if (dev) {
        console.warn(
          `[FetcherDispatcher] ${source} transport "${name}" missing resolve(); skipped.`,
        )
      }
      continue
    }
    out.set(name, t)
  }
  return out
}

export default class FetcherDispatcher {
  /**
   * @param {Object} options
   * @param {Object|null} options.foundation - Primary foundation module or declaration.
   * @param {Array<Object>} [options.extensions] - Extension modules or declarations.
   * @param {Object} options.dataStore - The Website's DataStore.
   * @param {{ resolve: Function, cacheKey?: Function }} [options.defaultFetcher]
   *   Framework default fetcher. Used when the site doesn't pick a named
   *   transport for the request's schema.
   * @param {{ resolve: Function, cacheKey?: Function }} [options.transport] -
   *   Runtime-level transport override. When set, every Layer-1 request is
   *   routed through this transport — no named-transport lookup, no fallback
   *   to the framework default. Editor preview iframe only.
   * @param {boolean} [options.dev] - Enable dev-mode validation warnings.
   */
  constructor({ foundation, extensions = [], dataStore, defaultFetcher = null, transport = null, dev = false }) {
    if (!dataStore) throw new Error('FetcherDispatcher: dataStore is required')
    this._dataStore = dataStore
    this._defaultFetcher = defaultFetcher
    this._transportOverride = isValidTransport(transport) ? transport : null
    this._dev = !!dev

    // Named transport registry. Primary foundation wins on name collisions
    // with extensions (dev-mode warning); bad extension transports are
    // skipped individually rather than tearing down the whole registry.
    const registry = new Map()

    const primaryTransports = collectTransports(getFoundationDecl(foundation), {
      source: 'primary foundation',
      dev: this._dev,
    })
    for (const [name, t] of primaryTransports) registry.set(name, t)

    for (const ext of extensions) {
      let extTransports
      try {
        extTransports = collectTransports(getFoundationDecl(ext), {
          source: 'extension',
          dev: this._dev,
        })
      } catch (err) {
        if (this._dev) {
          console.warn('[FetcherDispatcher] extension transports collection threw:', err)
        }
        continue
      }
      for (const [name, t] of extTransports) {
        if (registry.has(name)) {
          if (this._dev) {
            console.warn(
              `[FetcherDispatcher] extension transport "${name}" ignored — primary foundation already provides it.`,
            )
          }
          continue
        }
        registry.set(name, t)
      }
    }

    this._namedTransports = registry

    Object.freeze(this)
  }

  /**
   * Select the fetcher for a request.
   *
   *   1. Runtime `transport` override (editor preview) wins over everything.
   *   2. Otherwise, look up the site's per-schema selection in
   *      `ctx.website.config.fetcher.transports[schema]` → `.transports.default`.
   *      A named match is resolved against the registry of foundation /
   *      extension transports.
   *   3. If the site didn't pick a name (or picked one that's not in the
   *      registry), fall through to the framework default fetcher.
   */
  _selectFetcher(request, ctx) {
    if (this._transportOverride) return this._transportOverride

    const transportsConfig = ctx?.website?.config?.fetcher?.transports
    if (transportsConfig && typeof transportsConfig === 'object') {
      const schema = request?.schema
      const name = (schema && transportsConfig[schema]) || transportsConfig.default
      if (name) {
        const t = this._namedTransports.get(name)
        if (t) return t
        if (this._dev) {
          console.warn(
            `[FetcherDispatcher] site selected transport "${name}" for schema "${schema ?? '(none)'}" ` +
              'but no foundation or extension registered it; falling back to the framework default.',
          )
        }
      }
    }

    return this._defaultFetcher
  }

  _cacheKey(fetcher, request) {
    if (fetcher && typeof fetcher.cacheKey === 'function') {
      try {
        return String(fetcher.cacheKey(request))
      } catch (err) {
        console.warn('[FetcherDispatcher] fetcher.cacheKey threw:', err)
      }
    }
    return deriveCacheKey(request)
  }

  /**
   * Synchronous cache probe. Selects the fetcher (for key derivation), checks
   * DataStore, returns the cached `{ data, meta }` entry or null. Never starts
   * a fetch.
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
        if (this._dev) {
          console.warn(
            '[FetcherDispatcher] Fetcher returned a non-object; expected { data, error?, meta? }.',
            { request, result },
          )
        }
        return { data: [], error: 'Fetcher returned a non-object' }
      }

      const { data, error, meta } = result
      if (this._dev) this._validateReturnShape(result, request)

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

  /**
   * Dev-mode: warn when the fetcher's return object has unexpected top-level
   * keys — catches typos like { items, error } instead of { data, error }.
   */
  _validateReturnShape(result, request) {
    const allowed = new Set(['data', 'error', 'meta'])
    const unexpected = Object.keys(result).filter((k) => !allowed.has(k))
    if (unexpected.length > 0) {
      console.warn(
        `[FetcherDispatcher] Fetcher return has unexpected keys: ${unexpected.join(', ')}. ` +
          'Expected { data, error?, meta? }.',
        { request, result },
      )
    }
  }
}
