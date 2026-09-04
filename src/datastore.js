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
 * ⭐ TWO IDENTITIES, decided by whether the request carries an ADDRESS.
 *
 * An ADDRESSED request — `path`, `url` or `endpoint` — is identified by where it
 * goes: the address, the binding key, the unwrap, and for a POST its method and
 * body. Post-processing fields (`limit`, `sort`, `where`) are applied after the
 * fetch over one shared copy and must not split the cache; `query` and `depth`
 * are not hashed either, because the address already carries them (a query's
 * list and its per-record file are different addresses) and because a kit hook
 * asking for `{ path, as }` must hit the entry the page's declaration filled —
 * that shared cache is a documented property of `useFetched`.
 *
 * An ADDRESS-LESS request — a QUESTION sent to a records door — is identified by
 * the question: `query`, `schema`, `scope`, `where`, `sort`, `limit`, `depth`.
 * ⛔ The reason: with no per-query address, two pages
 * binding one `as` to two queries would otherwise share an entry, and a list
 * (brief) and a record (full) of one query would collide — the one defect on
 * this path that delivers WRONG data rather than none.
 *
 * `locale` is hashed on both when present: a live lane's address does not carry
 * the locale, and two locales' records must not share an entry (F1).
 *
 * @param {Object} request - Normalized request (or fetch config)
 * @returns {string} A stable JSON string usable as a cache-Map key
 */
export function deriveCacheKey(request) {
  // ⭐ `as` is the binding key — the name it has had since 2026-09-02, when the
  // compatibility alias for the older `schema` spelling was removed alongside
  // frontend's and hosting's.
  const { path, url, endpoint, transform, locale } = request || {}
  const as = request?.as
  const method = request?.method && request.method.toUpperCase() !== 'GET'
    ? request.method.toUpperCase()
    : undefined
  const body = method === 'POST' ? request?.body : undefined
  if (path || url || endpoint) {
    // ⚠️ The field NAME is part of the hash, so renaming it moves every key ONCE.
    // In-memory stores repopulate; a consumer with a persistent cache takes one
    // cold pass. Chosen over hashing under the old name, which would have hidden
    // the rename inside the one function whose job is to be canonical.
    return JSON.stringify({ path, url, endpoint, as, transform, method, body, locale })
  }
  const { query, schema, scope, where, sort, limit, depth } = request || {}
  return JSON.stringify({ query, schema, scope, where, sort, limit, depth, as, transform, locale })
}

/**
 * A record's identity — the backend-minted `$uuid`, present on every record a
 * live lane serves and on a file-lane record whose source was synced once. A
 * record with none is held inline in its result and never indexed.
 *
 * @param {*} record
 * @returns {string|null}
 */
export function recordIdentity(record) {
  const id = record && typeof record === 'object' ? record.$uuid : null
  return typeof id === 'string' && id.length > 0 ? id : null
}

/** Which of two depths holds MORE of a record. */
const DEPTH_RANK = { brief: 1, full: 2 }

function indexableDepth(entry) {
  const depth = entry?.meta?.depth
  return depth === 'brief' || depth === 'full' ? depth : null
}

/**
 * ⭐ THE RECORD INDEX — records are held ONCE, by identity, with the depth they
 * were fetched at; a query's result holds their ids.
 *
 * [Diego, 2026-09-04]: "they need to be able to hydrate records on their own…
 * track if they already have the briefs, and don't confuse that with knowing the
 * full records." Before this, a list and a detail fetch of one query landed in
 * separate slots only because their ADDRESSES differed, and a detail page whose
 * record was already held in full still fetched it again, or — with the record's
 * list already cached — delivered the brief as if it were the record.
 *
 * Three rules:
 *   R1  an entry whose `meta.depth` is `brief` or `full` and whose records all
 *       carry `$uuid` is filed by id; `get()` materializes it from the index, so
 *       every list holding a record sees the record's latest depth;
 *   R2  depth is MONOTONIC — a brief never overwrites a record held in full;
 *   R3  an upgrade MERGES the full record over the brief rather than replacing
 *       it, so nothing depends on the full being a superset of the brief.
 * An entry with no depth, or with a record lacking identity, is held inline
 * exactly as before — the file lane with no synced records changes nothing.
 */
export default class DataStore {
  constructor() {
    // key → { data, meta? }  or, when indexed,  { ids, single?, meta, _at, _data }
    this._cache = new Map()
    // key → { promise, signals: Set<AbortSignal> }
    this._inflight = new Map()
    // Notified on every successful `set()`.
    this._listeners = new Set()
    // Key-scoped listeners: key → Set<Function>
    this._keyedListeners = new Map()
    // $uuid → { depth, record } — the record index
    this._records = new Map()
    // bumps on every index write, so a materialized list knows it is stale
    this._recordsVersion = 0

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
    const entry = this._cache.has(key) ? this._cache.get(key) : null
    if (!entry || !entry.ids) return entry
    // Indexed: materialize from the record index, once per index version.
    if (entry._at === this._recordsVersion && entry._data) return entry._data
    const records = entry.ids.map((id) => this._records.get(id)?.record).filter(Boolean)
    const data = entry.single ? (records[0] ?? null) : records
    const out = entry.meta !== undefined ? { data, meta: entry.meta } : { data }
    entry._at = this._recordsVersion
    entry._data = out
    return out
  }

  /**
   * Cache store. Fires listeners: first the global ones (all-writes), then
   * any subscribers registered for this specific key.
   *
   * An entry carrying `meta.depth` whose records all carry `$uuid` is filed in
   * the record index and stored as ids — see the class note. Anything else is
   * stored as given.
   *
   * @param {string} key
   * @param {{ data: any, meta?: Object }} entry
   */
  set(key, entry) {
    this._cache.set(key, this._index(entry))
    for (const fn of this._listeners) fn()
    const keyed = this._keyedListeners.get(key)
    if (keyed) {
      for (const fn of keyed) fn()
    }
  }

  /**
   * The record held under an identity, with the depth it was fetched at — the
   * question a detail page asks before fetching: "do I hold this in full?"
   *
   * @param {string} id - a `$uuid`
   * @returns {{ depth: 'brief'|'full', record: Object } | null}
   */
  getRecord(id) {
    return (id && this._records.get(id)) || null
  }

  /**
   * File one record at a depth, honouring R2 and R3. Returns the record now held.
   *
   * @param {Object} record
   * @param {'brief'|'full'} depth
   * @returns {Object}
   */
  upsertRecord(record, depth) {
    const id = recordIdentity(record)
    if (!id || !DEPTH_RANK[depth]) return record
    const held = this._records.get(id)
    if (!held) {
      this._records.set(id, { depth, record })
      this._recordsVersion += 1
      return record
    }
    if (DEPTH_RANK[depth] < DEPTH_RANK[held.depth]) return held.record // R2
    const next = DEPTH_RANK[depth] > DEPTH_RANK[held.depth]
      ? { ...held.record, ...record } // R3 — merge on upgrade
      : record // same depth: the fresher copy
    this._records.set(id, { depth, record: next })
    this._recordsVersion += 1
    return next
  }

  _index(entry) {
    const depth = indexableDepth(entry)
    if (!depth || !entry || entry.ids) return entry
    const { data } = entry
    if (Array.isArray(data)) {
      if (data.length === 0 || !data.every((r) => recordIdentity(r))) return entry
      const ids = data.map((r) => recordIdentity(r))
      for (const r of data) this.upsertRecord(r, depth)
      return { ids, meta: entry.meta, _at: -1, _data: null }
    }
    if (recordIdentity(data)) {
      this.upsertRecord(data, depth)
      return { ids: [recordIdentity(data)], single: true, meta: entry.meta, _at: -1, _data: null }
    }
    return entry
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
    this._records.clear()
    this._recordsVersion += 1
  }
}
