/**
 * ObservableState
 *
 * Small typed observable value store used by `page.state` and `website.state`.
 * Foundations write into it (current selected query, active filter, view-mode
 * toggle). Kit hooks subscribe and re-render React components on change. The
 * fetcher — which runs outside React — reads it directly from `ctx.page.state`
 * / `ctx.website.state`.
 *
 * Plain typed API: no Proxies, no reactive derivations, no middleware. Strict
 * shape reduces accidental reads, makes subscriptions explicit, and avoids
 * enumerate/ownKey surprises that come with property-access proxies.
 *
 * Subscribers fire on change only — `set(key, sameValue)` is a no-op.
 *
 * @example
 *   page.state.get('selectedQuery')           // → any | undefined
 *   page.state.set('selectedQuery', 'X')      // fires listeners
 *   page.state.delete('selectedQuery')        // fires listeners if the key existed
 *
 *   page.state.subscribe('selectedQuery', fn) // listener for this key only
 */
export default class ObservableState {
  constructor() {
    // key → value
    this._values = new Map()
    // key → Set<fn> — listeners for a specific key.
    this._keyListeners = new Map()

    Object.seal(this)
  }

  /**
   * @param {string} key
   * @returns {any|undefined}
   */
  get(key) {
    return this._values.get(key)
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._values.has(key)
  }

  /**
   * Set a key. No-op when the value is `===` the existing value.
   * Listeners fire only on actual changes.
   *
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (this._values.has(key) && this._values.get(key) === value) return
    this._values.set(key, value)
    this._notify(key)
  }

  /**
   * Remove a key. No-op when the key was already absent.
   *
   * @param {string} key
   * @returns {boolean} true if a key was deleted
   */
  delete(key) {
    if (!this._values.has(key)) return false
    this._values.delete(key)
    this._notify(key)
    return true
  }

  /**
   * Subscribe to changes for a specific key. Returns an unsubscribe function.
   *
   * There is no all-keys subscription form — fan-out belongs in the caller
   * when it's really needed. Subscribing per key keeps re-render blast
   * radius predictable and avoids "every write wakes every listener" fan-in.
   *
   * @param {string} key
   * @param {Function} fn
   * @returns {Function} unsubscribe
   */
  subscribe(key, fn) {
    let bucket = this._keyListeners.get(key)
    if (!bucket) {
      bucket = new Set()
      this._keyListeners.set(key, bucket)
    }
    bucket.add(fn)
    return () => {
      bucket.delete(fn)
      if (bucket.size === 0) this._keyListeners.delete(key)
    }
  }

  _notify(key) {
    const bucket = this._keyListeners.get(key)
    if (bucket) for (const fn of bucket) fn()
  }
}
