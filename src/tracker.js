/**
 * Tracker — one event stream for a site.
 *
 * ⭐ **A page visit is a trackable event.** That sentence is the design. There is
 * one destination, one envelope, and one queue; the runtime emits `page_view`
 * automatically and a foundation emits whatever else it likes, through the same
 * path.
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
 * nowhere afterwards** — as does `continues`, which is derived from the same
 * read: the referrer never changes across SPA navigation, and the params leave
 * the URL on the first navigation. So they are captured once, here, and
 * attached to every `page_view` of the document.
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
 *
 * ⚠️ **The boundary condition: this checks `framed`, not `preview`.** A preview
 * rendered in a popup or a top-level tab would be same-origin and NOT framed,
 * `isLiveDocument()` would return true, and — like every failure in this area —
 * it would have no symptom: the payload stays internally consistent while the
 * owner's own edits quietly inflate their numbers.
 *
 * ✅ **Covered on the other side too, by a test rather than a promise**
 * **[frontend, measured; relayed 2026-08-17]**: `preview-runtime` imports the
 * real `setup` / `provider` / `foundation-loader` (not a fork), all five of its
 * mounts are `<iframe>`, and the popup case is already instantiated —
 * `DetachedPreview.jsx` is a popup *root* with the runtime in an iframe inside
 * it, so the guard holds. A non-framed preview is not reachable by re-parenting
 * at all: content and foundation arrive *only* over the frame-bridge, so going
 * non-framed means replacing the transport. Their
 * `previewFraming.smoke.test.js` pins both the iframe property and the exact set
 * of mounting files, so a new mount fails there.
 *
 * ⛔ **Do not "fix" this by adding an explicit preview flag from the harness.**
 * A suppression that depends on another lane remembering something has no
 * symptom when forgotten, which is the whole reason this one reads the DOM
 * instead; two suppressions where one is authoritative is how you get a stale
 * one. The two guards now fail independently, in different repos, for the same
 * violation.
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
  //
  // ⭐ **But dropping it destroys the only thing separating two different
  // events, so the fact that it WAS same-origin is kept as one bit.** A full
  // document load happens either because someone arrived from outside, or
  // because a visitor already on the site triggered a real navigation — a
  // locale switch through kit's `<Link reload>` being the shipped case. Both
  // reach a collector with no referrer: the first never had one, the second had
  // it discarded here. ⇒ An "entry pages" metric built on that **invents**
  // arrivals, counting a locale switch as somebody landing on the Spanish page.
  //
  // ⚖️ `continues` states the FACT, not the conclusion. Whether a continuation
  // disqualifies an entry is the consumer's call; a field named for one metric
  // ages badly the moment a second one wants it.
  //
  // ⛔ **It carries no identity and links nothing.** It says only *this document
  // continues a visit*, never *which* — so the categorical claim in this file's
  // header, that nothing persistent is minted, is untouched. Correlating two
  // visits would be a session, which is exactly what is refused.
  const referrer = document.referrer
  if (referrer) {
    try {
      if (new URL(referrer).origin !== window.location.origin) {
        context.referrer = referrer
      } else {
        // Emitted only when true. Absent means "not a continuation" AND "an
        // older runtime that never sent it" — indistinguishable on purpose,
        // because that collapses to today's behaviour rather than to a wrong
        // answer, and it keeps the common payload the size it already was.
        context.continues = true
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
   * @param {number} [options.flushIntervalMs=5000] - batch window, MILLISECONDS
   * @param {number} [options.maxQueueSize=10]
   * @param {boolean} [options.debug=false]
   */
  constructor(options = {}) {
    this.endpoint = options.endpoint || null
    // ⭐ **`Ms` is in the name because the unit cannot be inferred from the
    // value, and the failure is silent and inverted.** A bare `flushInterval:
    // 30` meaning *thirty seconds* reads here as 30 **milliseconds** — flushing
    // ~33x a second, the opposite of the intent, indistinguishable from working
    // config, and paid for by the host rather than by whoever typed it. The wire
    // field the host emits is `flushIntervalMs` for the same reason; this option
    // is spelled to match so nothing has to translate between them.
    //
    // ⛔ **No floor is imposed, deliberately.** A minimum here would be a second
    // copy of a policy the host already owns, able only to disagree with theirs —
    // the same reason this framework never co-owns a serve location. What is
    // rejected is not a *small* value but an *invalid* one: anything non-finite
    // or <= 0 would arm a spinning or never-firing timer, so it falls back to the
    // default rather than being honoured.
    const interval = options.flushIntervalMs
    this.flushIntervalMs = Number.isFinite(interval) && interval > 0 ? interval : 5000
    this.maxQueueSize = options.maxQueueSize || 10
    this.debug = options.debug || false

    // 'granted' | 'denied' | 'pending'. Without a consent requirement the
    // operator's act of declaring a destination IS the decision, and the
    // framework does not presume a jurisdiction on their behalf.
    // ⛔ The requirement is consumed HERE and not stored. A `consentRequired`
    // field was kept alongside and read by nothing — dead instance state in a
    // class every site loads, which is what `destroy()` and its three fields
    // were removed for. The starting status is the whole of what the flag means.
    this.consent = options.consentRequired ? 'pending' : 'granted'

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

    // ── time_on_page ─────────────────────────────────────────────────────
    // ⛔ Declared here because the instance is SEALED below — an assignment to
    // an undeclared property throws in module code. Same reason `onGranted` and
    // `Uniweb.defaultInsets` are pre-declared.
    //
    // ⭐ No new listener is needed for any of this: `armUnloadHandlers` already
    // registers `pagehide` and `visibilitychange`, and `trackPageView` already
    // knows the SPA route boundary. This is arithmetic inside handlers that
    // already run.
    /** When the current path became active. */
    this.pageEnteredAt = null
    /** Hidden time accrued on the current path, in ms. */
    this.hiddenMs = 0
    /** When the document last became hidden, or `null` while visible. */
    this.hiddenSince = null
    /** Guards against a second report for one page visit — see `reportTimeOnPage`. */
    this.pageReported = false

    // What the runtime may ARM, as two independent narrowings. Both are `null`
    // when nothing narrows, which is the common case and the cheap one.
    //
    // ⛔ **Neither ever filters `track()`.** The registry is open by design, and
    // a client-side allowlist over a foundation's own events would export one
    // host's policy onto every host — including hosts that sent no list, whose
    // sites would silently drop everything their foundation emits. These gate
    // the runtime's OWN emissions and nothing else. See `arms()`.
    this.hostEvents = options.hostEvents ? new Set(options.hostEvents) : null
    this.siteEmit = options.siteEmit ? new Set(options.siteEmit) : null

    this.framed = detectFramed()

    // Called once when consent moves to granted, and never otherwise. The
    // runtime uses it to load a site's declared third-party tags at the moment
    // they become permitted; nothing in core knows or cares what it does.
    //
    // ⛔ Declared HERE because the instance is sealed below — an assignment to
    // an undeclared property throws in module code, and the caller assigns this
    // after construction. Same reason `Uniweb.defaultInsets` is pre-declared.
    this.onGranted = null

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
   * Whether this document is one where the site's telemetry should run at all —
   * a real visit in a browser, rather than a server render or a framed
   * authoring preview. Says nothing about whether anything is *configured*.
   *
   * Split out from `isEnabled()` because a second consumer needs exactly this
   * half: the runtime loads a site's declared third-party tags, which have no
   * endpoint of ours to check but must be suppressed in the same contexts and
   * for the same reason. One predicate, so the two cannot drift.
   *
   * @returns {boolean}
   */
  isLiveDocument() {
    return isBrowser && !this.framed
  }

  /**
   * Enabled means: a destination exists, and this is a live document. Consent
   * is checked separately — a consent-pending tracker is *enabled* and
   * buffering, which is a different state from off.
   *
   * @returns {boolean}
   */
  isEnabled() {
    return !!this.endpoint && this.isLiveDocument()
  }

  /**
   * Whether the runtime should ARM one of its own automatic emitters.
   *
   * ⭐ **Three questions, in the order that makes each one's absence safe:**
   *
   * 1. **Is there anywhere to send, in a live document?** — `isEnabled()`.
   * 2. **Will the host consume this?** `hostEvents` is the host's cost switch:
   *    no point arming an observer for a row nobody stores. ⛔ **Absent means NO
   *    NARROWING, never an empty set** — a host that sends no list is an older
   *    or simpler one, and reading absence as "consume nothing" would take
   *    every site on that host dark with every gate reading yes.
   * 3. **Did the site ask for it?** `siteEmit` is the operator's own selection.
   *    Absent means everything.
   *
   * `override` is the per-page answer where one exists (`page.trackSections`).
   * It replaces the SITE's answer and cannot escape the host's: a page may
   * widen what its own site configured, and may not conjure a row the host
   * declined to store.
   *
   * ⛔ **Not consulted by `track()`.** A foundation's events are never gated —
   * see the constructor.
   *
   * @param {string} event
   * @param {boolean} [override] - the per-page decision, when the caller has one
   * @returns {boolean}
   */
  arms(event, override) {
    if (!this.isEnabled()) return false
    if (this.hostEvents && !this.hostEvents.has(event)) return false
    if (override != null) return !!override
    return !this.siteEmit || this.siteEmit.has(event)
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
    const wasGranted = this.consent === 'granted'
    this.consent = granted ? 'granted' : 'denied'

    if (!granted) {
      this.queue = []
      return
    }

    this.flush()

    // Fires on the TRANSITION only, so a component calling grant() twice does
    // not load a site's tags twice. The callback is cleared as it runs: this is
    // a one-time permission, not a subscription.
    if (!wasGranted && this.onGranted) {
      const notify = this.onGranted
      this.onGranted = null
      notify()
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
   * ⭐ **`first_of_load` marks the one view that opened this document**, and it
   * is computed here rather than living in `acquisition` — precisely because
   * everything in `acquisition` is *replayed* onto every view, and this must
   * not be. Exactly one emission per `Tracker` can carry it: `currentPath` is
   * `null` only before the first report and is never reset.
   *
   * ⛔ **Why it exists at all, since a consumer holding the events can derive
   * it from `visit`.** Not every consumer holds the events. A counter store
   * that keeps no per-event rows cannot ask *"was this the first `page_view`
   * with this `visit`?"* without remembering which `visit` values it has seen —
   * which is retaining `visit`, arrived at by the back door. This bit makes the
   * document-scoped question answerable with **no collector state at all**, and
   * a store that deliberately retains nothing is a supported consumer, not an
   * unusual one.
   *
   * ⛔ **The name carries the unit on purpose.** Bare `first` reads as *the
   * visitor's first ever view*, which is a claim this file refuses to make and
   * could not make — nothing here survives the document. The unit is **one
   * document load**, so a panel built on it counts loads, never people and
   * never sessions. *(`lane-chain.md` §4a: when a misread name is paid by
   * another lane, put the constraint in the name.)*
   *
   * ⛔ **IT MUST NEVER SHIP IN A RELEASE THAT LACKS `continues`, and that is a
   * standing contract rather than an accident of ordering.** A consumer uses
   * its *presence* as proof that this emitter is new enough to have sent
   * `continues` had the referrer been same-origin — which is what lets an
   * entry-page metric drop the "runtime too old to say" case entirely instead
   * of caveating it. Backport `first_of_load` to a line without `continues`
   * and every such consumer starts counting continuations as arrivals, with
   * nothing anywhere reporting an error. *(The dependency is one-way:
   * `continues` without `first_of_load` is fine and shipped that way.)*
   *
   * ⚖️ **It states a FACT, not a metric** — the same discipline as `continues`.
   * Whether a first-of-load view is an "entry page" also depends on
   * `continues`, and that combination is the consumer's to make; a field named
   * `entry` would age badly the moment a second metric wanted this bit.
   *
   * @param {string} path
   */
  trackPageView(path) {
    if (!path) return
    if (path === this.currentPath) return

    // ⛔ **EVERYTHING DOWN TO THE `arms` CHECK IS PAGE-BOUNDARY BOOKKEEPING, NOT
    // AN EMISSION.** It must not sit behind `arms('page_view')`, because two
    // other things read it and neither is `page_view`:
    //
    //   - `currentPath` is the default `path` for EVERY event `track()` sends —
    //     a foundation's own events and `outbound_click` among them. Gated, a
    //     site that selects `outbound_click` without `page_view` reports every
    //     event with `path: undefined`, silently.
    //   - `time_on_page` is armed independently, so gating its clock behind a
    //     different event's selection means a site that asks for it gets
    //     nothing at all.
    //
    // ⚖️ Both failures are invisible: no error, no warning, a plausible payload
    // with a field quietly missing. The bookkeeping is cheap and unconditional;
    // only the EMISSION below is a decision.
    //
    // The OUTGOING path's dwell closes before `currentPath` moves — the SPA
    // boundary an unload-only implementation misses, which would report one
    // duration per document and silently attribute it to the last page seen.
    this.reportTimeOnPage()
    const firstOfLoad = this.currentPath === null
    this.currentPath = path
    this.startTimeOnPage()

    if (!this.arms('page_view')) return
    // Promptly, rather than waiting out the batch window: a page view is the
    // event most likely to be the only one of a short visit.
    //
    // Emitted only when true, like `continues` — absent is the negative, and it
    // keeps every later view the size it already was.
    this.enqueue(
      {
        event: 'page_view',
        path,
        ...(this.acquisition || {}),
        ...(firstOfLoad ? { first_of_load: true } : {})
      },
      true
    )
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

  /**
   * Both of these are armed once, for the life of the document, and are never
   * detached — so neither the interval id nor the handler references are kept.
   *
   * ⛔ **There is deliberately no `destroy()`.** One shipped, was called by
   * nothing, and cost 334 bytes minified in a package **every site loads
   * whether it tracks or not** (`@uniweb/core` is not tree-shaken — the
   * singleton's constructor holds a `Tracker`, so the class can never be
   * dropped). Removing it took three instance fields with it, since they
   * existed only to serve it.
   *
   * ⭐ The precedent is the thing this class replaced: `analytics.js` was dead
   * code that shipped to every site for months because nobody deleted it.
   * Adding a never-called teardown method would have been the same mistake at
   * smaller scale. If a lifecycle that needs teardown ever appears, it arrives
   * *with* its call site — which is the order that keeps this honest.
   *
   * @private
   */
  /**
   * Begin measuring dwell on the path that just became active.
   *
   * @private
   */
  startTimeOnPage() {
    this.pageEnteredAt = Date.now()
    this.hiddenMs = 0
    this.hiddenSince = null
    this.pageReported = false
  }

  /**
   * Report how long the visitor spent on the current path, once.
   *
   * ⭐ **A RAW scalar, with no floor and no clamp.** Both belong to the
   * collector: a threshold baked in here is frozen at the speed of framework
   * release → foundation rebuild → site republish, where the same threshold
   * applied at write time changes when the host deploys. Dwell is also violently
   * skewed — a tab left open overnight sits in the same mean as forty readers —
   * so a clamp is genuinely needed; it is just not needed *here*.
   *
   * ⛔ **Hidden time is subtracted**, or this measures tab-open rather than
   * reading. A backgrounded tab accrues nothing.
   *
   * ⛔ **Reported at a route change and at `pagehide` — NOT when the document
   * merely becomes hidden.** Visibility is a *pause*, not an end: someone who
   * switches tabs to look something up and comes back is still reading. Emitting
   * on hidden would truncate exactly the engaged readers this metric exists to
   * find, and — because the consumer derives a mean from a sum and a count —
   * emitting more than once per page visit would inflate the count and make
   * every mean wrong. Hence `pageReported`: **at most one per page visit.**
   *
   * ⚠️ **The cost of that choice, stated rather than hidden:** a page discarded
   * while hidden, without `pagehide`, is never reported. That is an
   * under-count, it is bounded, and it fails in the direction that does not
   * corrupt the statistic.
   *
   * @private
   */
  reportTimeOnPage() {
    if (this.pageReported || this.pageEnteredAt === null || !this.currentPath) return
    if (!this.arms('time_on_page')) return

    const now = Date.now()
    // A tab hidden at this instant has not yet had its span folded in.
    const openHidden = this.hiddenSince === null ? 0 : now - this.hiddenSince
    const durationMs = now - this.pageEnteredAt - this.hiddenMs - openHidden

    this.pageReported = true
    // Negative is not reachable by arithmetic, but a clock adjustment mid-visit
    // would produce one, and a negative duration poisons a sum the consumer
    // cannot repair.
    if (durationMs < 0) return
    this.enqueue({ event: 'time_on_page', path: this.currentPath, durationMs })
  }

  /** @private */
  armFlushInterval() {
    setInterval(() => this.flush(), this.flushIntervalMs)
  }

  /** @private */
  armUnloadHandlers() {
    window.addEventListener('pagehide', () => {
      // Order matters: the report must be QUEUED before the beacon goes, or it
      // rides the next flush — and for a page being unloaded there is no next.
      this.reportTimeOnPage()
      this.flush(true)
    })
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // A pause, not an end — see `reportTimeOnPage`. Only the clock stops.
        if (this.hiddenSince === null) this.hiddenSince = Date.now()
        this.flush(true)
      } else if (this.hiddenSince !== null) {
        this.hiddenMs += Date.now() - this.hiddenSince
        this.hiddenSince = null
      }
    })
  }
}
