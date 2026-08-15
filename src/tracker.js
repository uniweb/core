/**
 * Tracker — one event stream for a site.
 *
 * ⭐ **A page visit is a trackable event.** That sentence is the design. There is
 * one destination, one envelope, and one queue; the runtime emits `page_view`
 * automatically and a foundation emits whatever else it likes, through the same
 * path. Design doc: `kb/framework/plans/tracking.md`.
 *
 * ```
 * { event: 'page_view',       path: '/about', referrer?, utm_* }
 * { event: 'video_milestone', path: '/about', section: 'Hero', milestone: 50 }
 * ```
 *
 * ## ⛔ Absent means NO-OP, at every entry point
 *
 * A site with no tracking destination is the DEFAULT and the majority. So with
 * no endpoint: nothing is queued, no interval is armed, no listener is
 * registered, and every method returns immediately. **A caller never needs a
 * guard** — `block.track(…)` on an unconfigured site is normal, not an error.
 * Nothing here throws, rejects, or logs unless `debug` is on.
 *
 * ## ⛔ Nothing PERSISTENT is ever minted here
 *
 * No session id, no visitor id, no fingerprint, and **nothing written to any
 * browser storage** — no cookie, no `localStorage`, no `sessionStorage`, no
 * IndexedDB. The privacy hazard of an identifier is *persistence and
 * cross-context linkage*, not existence, and that is the line this class holds.
 * `tests/tracker.test.js` asserts it mechanically rather than by promise.
 *
 * ✅ **The one thing it does mint is `visit`** — an opaque key generated at
 * construction, held only in this instance, sent on every event so a consumer
 * can tell that these events came from the same page load. It **dies with the
 * document**: a refresh, a new tab, or tomorrow all produce a different one, and
 * nothing links them. It is a correlation token, not an identity — closer to a
 * trace id than to a cookie, and strictly less linkable than the IP-and-UA
 * derivations a collector can already compute for itself.
 *
 * ⚖️ **Why the framework mints it rather than a host supplying one.** A host
 * that renders per request would have to embed the value in the document it
 * serves — and that document is cacheable, so every visitor of one cached
 * render would share a single key and collapse into one visitor, silently, with
 * the numbers staying plausible. Generating it in the browser does not solve
 * that problem, it removes it.
 *
 * *(The ported `Analytics` class this replaces stamped `sessionId` and
 * `sessionDuration` on every payload — a day-scoped identity and a duration.
 * Both are gone deliberately; `visit` is neither.)*
 *
 * ## Field lifetime — captured once, replayed on every page view
 *
 * `document.referrer` and the landing `utm_*` params exist **at arrival and
 * nowhere afterwards**: the referrer never changes across SPA navigation, and
 * the params leave the URL on the first navigation. So they are captured once,
 * here, and attached to every `page_view` of the document.
 *
 * ⇒ **Consequence worth knowing when reading the numbers:** a per-view facet
 * built on them is *derived, not observed*. `utm_source` counts "views by
 * visitors who **arrived** via X", never "views that **carried** X".
 *
 * @module @uniweb/core/tracker
 */

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

/**
 * A framed document is the editor's live-preview iframe far more often than it
 * is a legitimately embedded site, and the failure modes are asymmetric: an
 * embedded site going uncounted is an undercount — visible and complainable —
 * while a site owner's authoring session inflating their own numbers is a silent
 * overcount that corrupts what the data means. Default to the side that fails
 * loudly.
 *
 * A cross-origin parent throws on `window.top` access; that also means framed.
 */
function detectFramed() {
  if (!isBrowser) return false
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

/** Acquisition context, read once at construction. See "Field lifetime" above. */
function captureAcquisition() {
  if (!isBrowser) return null

  const context = {}

  // Same-origin referrers are dropped: internal navigation is not a referral,
  // and counting it would make a site its own top referrer on every page.
  const referrer = document.referrer
  if (referrer) {
    try {
      if (new URL(referrer).origin !== window.location.origin) {
        context.referrer = referrer
      }
    } catch {
      // Unparseable — treat as absent rather than forwarding a malformed value.
    }
  }

  try {
    const params = new URLSearchParams(window.location.search)
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const value = params.get(key)
      if (value) context[key] = value
    }
  } catch {
    // No parseable query string — nothing to attach.
  }

  return Object.keys(context).length > 0 ? context : null
}

/**
 * An opaque key for one document lifetime. Never stored, never persisted.
 *
 * `crypto.randomUUID` needs a secure context, so a site served over plain HTTP
 * falls through to a non-cryptographic value — which is correct rather than a
 * compromise: this is a correlation token with no security property to preserve,
 * and a collision only merges two visits in one site's own numbers.
 */
function mintVisitKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Secure-context restrictions throw rather than return undefined in places.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * How many events may accumulate while consent is pending.
 *
 * The ordinary `maxQueueSize` triggers a *flush*, which is a no-op while
 * pending — so without a hard cap a site that never answers the consent
 * question would grow the queue for the whole session. Newest are dropped
 * rather than oldest: the first `page_view` is the one worth keeping.
 */
const MAX_PENDING = 50

export default class Tracker {
  /**
   * @param {Object} options
   * @param {string} [options.endpoint] - destination; **required to enable**
   * @param {boolean} [options.consentRequired=false] - hold everything until granted
   * @param {number} [options.flushInterval=5000]
   * @param {number} [options.maxQueueSize=10]
   * @param {boolean} [options.debug=false]
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint || null
    this.flushInterval = options.flushInterval || 5000
    this.maxQueueSize = options.maxQueueSize || 10
    this.debug = options.debug || false

    // 'granted' | 'denied' | 'pending'. Without a consent requirement the
    // operator's act of declaring a destination IS the decision, and the
    // framework does not presume a jurisdiction on their behalf.
    this.consent = options.consentRequired ? 'pending' : 'granted'
    this.consentRequired = !!options.consentRequired

    this.queue = []
    this.acquisition = null

    // One key per document, minted only when there is somewhere to send it.
    // Rides the ENVELOPE beside `event` rather than inside a payload, because
    // every event needs it for the same reason `event` itself is there — and
    // because `page_view`'s payload is closed at `{ path, referrer?, utm_* }`
    // and this must not widen it.
    this.visit = null

    // The last path a `page_view` reported. Guards consecutive duplicates —
    // React StrictMode double-invokes effects, and this makes "one report per
    // path change" true here rather than contingent on every caller's
    // dependency array. NOT revisit-dedupe: it is overwritten, so A→B→A
    // reports three times.
    this.currentPath = null

    this.flushIntervalId = null
    this.onPageHide = null
    this.onVisibilityChange = null
    this.framed = detectFramed()

    if (isBrowser && this.isEnabled()) {
      this.acquisition = captureAcquisition()
      // Minted even when consent is pending: events buffered before the visitor
      // answers must carry the SAME key as those after it, or granting consent
      // would split one visit in two. It never leaves the device until the
      // buffer flushes, so minting early costs nothing.
      this.visit = mintVisitKey()
      this.armFlushInterval()
      this.armUnloadHandlers()
    }

    Object.seal(this)
  }

  /**
   * Enabled means: a destination exists, we are in a browser, and we are not
   * inside someone's iframe. Consent is checked separately — a consent-pending
   * tracker is *enabled* and buffering, which is a different state from off.
   *
   * @returns {boolean}
   */
  isEnabled() {
    return !!this.endpoint && isBrowser && !this.framed
  }

  /** @returns {'granted'|'denied'|'pending'} */
  consentStatus() {
    return this.consent
  }

  /**
   * Record the visitor's decision. A consent component calls this through
   * kit's `useTrackingConsent()`; foundations never touch this object.
   *
   * Granting flushes what was buffered — nothing left the device before the
   * decision, and the views that preceded the click are not lost. Denying
   * discards the buffer and stops accepting.
   *
   * ⛔ **Recording the decision is NOT gated on `isEnabled()`, deliberately.**
   * Consent is *the visitor's answer*; enablement is *whether we have anywhere
   * to send*. Two different questions, and conflating them meant a decision
   * could not be recorded **when no destination resolved** — benign while our
   * own queue is the only thing gated on consent, a correctness bug the moment
   * anything else is.
   *
   * The same conflation suppressed recording inside a framed document. That
   * suppression exists so an authoring session cannot inflate a site's own
   * numbers (see `detectFramed`), and it belongs on the *sending*: with
   * `consentRequired` the status starts `'pending'` and could not move at all,
   * so a banner following the documented pattern would render and then never
   * dismiss.
   *
   * Nothing is sent as a result: `flush()` keeps its own `isEnabled()` guard,
   * so a disabled tracker still transmits nothing no matter what is recorded
   * here. This changes what the tracker *remembers*, never what it *emits*.
   *
   * @param {boolean} granted
   */
  setConsent(granted) {
    this.consent = granted ? 'granted' : 'denied'
    if (granted) {
      this.flush()
    } else {
      this.queue = []
    }
  }

  /**
   * Report an event.
   *
   * @param {string} event - event name, e.g. 'video_milestone'. Open registry.
   * @param {Object} [data] - the caller's own fields; `path` overrides the
   *        current route, which is what block-scoped callers supply.
   */
  track(event, data = {}) {
    if (!this.isEnabled() || !event) return
    const { path, ...rest } = data
    this.enqueue({ event, path: path || this.currentPath || undefined, ...rest })
  }

  /**
   * Report a page view. Framework-owned: it carries the acquisition context and
   * dedupes consecutive reports of the same path.
   *
   * @param {string} path
   */
  trackPageView(path) {
    if (!this.isEnabled() || !path) return
    if (path === this.currentPath) return
    this.currentPath = path
    // Promptly, rather than waiting out the batch window: a page view is the
    // event most likely to be the only one of a short visit.
    this.enqueue({ event: 'page_view', path, ...(this.acquisition || {}) }, true)
  }

  /**
   * @param {Object} event
   * @param {boolean} [immediate=false]
   * @private
   */
  enqueue(event, immediate = false) {
    if (this.consent === 'denied') return

    // Envelope: the visit key is stamped here, at the one choke point every
    // event passes through, so no caller can forget it or override it.
    const envelope = { ...event, visit: this.visit }

    if (this.consent === 'pending') {
      if (this.queue.length >= MAX_PENDING) return
      this.queue.push(envelope)
      if (this.debug) console.log('[Tracker] Buffered pending consent:', envelope)
      return
    }

    this.queue.push(envelope)
    if (this.debug) console.log('[Tracker] Queued:', envelope)

    if (immediate || this.queue.length >= this.maxQueueSize) this.flush()
  }

  /**
   * Send whatever is queued.
   *
   * ⛔ **A failed send is dropped, not retried.** The class this replaced put
   * the events back with `queue.unshift(...)`, which left the queue at or above
   * `maxQueueSize` so the *next* event flushed immediately — a tight loop
   * against a dead endpoint, with `maxQueueSize` triggering a flush but never
   * bounding the queue. Best-effort delivery is the norm for this shape, and
   * `sendBeacon` is fire-and-forget regardless.
   *
   * @param {boolean} [useBeacon=false] - force `sendBeacon` (unload)
   */
  flush(useBeacon = false) {
    if (!this.isEnabled() || this.consent !== 'granted' || this.queue.length === 0) return

    const events = this.queue
    this.queue = []

    const payload = JSON.stringify({ events })
    if (this.debug) console.log('[Tracker] Flushing', events.length, 'event(s)')

    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      const sent = navigator.sendBeacon(this.endpoint, blob)
      if (!sent && this.debug) console.warn('[Tracker] sendBeacon refused the payload')
      return
    }

    // The response is ignored entirely — no retry, no branch, no surfaced
    // error. A host's 204, 403, 503 and a network failure are indistinguishable
    // here by construction, which is what lets a host put its own preconditions
    // in front of the collector without the client needing to know.
    fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch((error) => {
      if (this.debug) console.warn('[Tracker] Flush failed:', error.message)
    })
  }

  /** @private */
  armFlushInterval() {
    this.flushIntervalId = setInterval(() => this.flush(), this.flushInterval)
  }

  /** @private */
  armUnloadHandlers() {
    this.onPageHide = () => this.flush(true)
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.flush(true)
    }
    window.addEventListener('pagehide', this.onPageHide)
    window.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  /** Stop the interval, detach listeners, and send what is left. */
  destroy() {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId)
      this.flushIntervalId = null
    }
    if (isBrowser) {
      if (this.onPageHide) window.removeEventListener('pagehide', this.onPageHide)
      if (this.onVisibilityChange) {
        window.removeEventListener('visibilitychange', this.onVisibilityChange)
      }
    }
    this.onPageHide = null
    this.onVisibilityChange = null
    this.flush(true)
  }
}
