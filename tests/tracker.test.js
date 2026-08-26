/**
 * Tracker — the no-op contract, the consent gate, and field lifetime.
 *
 * `isBrowser` and the framed check are evaluated at MODULE SCOPE, so every case
 * installs its globals and then imports a fresh copy (`vi.resetModules()` +
 * dynamic import). Setting globals after the import would test nothing.
 *
 * Design settled with the backend and hosting lanes, 2026-08.
 */

const ENDPOINT = 'https://collector.test/e'

/** A minimal browser. `framed` makes `window.top !== window.self`. */
function makeBrowser({ url = 'https://site.test/a', referrer = '', framed = false } = {}) {
  const listeners = {}
  const win = {
    location: new URL(url),
    addEventListener: (name, fn) => {
      ;(listeners[name] ||= []).push(fn)
    },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn)
    }
  }
  win.self = win
  win.top = framed ? { other: true } : win
  return { win, doc: { referrer, visibilityState: 'visible' }, listeners }
}

async function freshTracker(options = {}, browser = null) {
  vi.resetModules()
  if (browser) {
    globalThis.window = browser.win
    globalThis.document = browser.doc
  } else {
    delete globalThis.window
    delete globalThis.document
  }
  const { default: Tracker } = await import('../src/tracker.js')
  return new Tracker(options)
}

/** Every event body posted so far, flattened across flushes. */
function sentEvents() {
  return globalThis.fetch.mock.calls.flatMap((call) => JSON.parse(call[1].body).events)
}

/**
 * Just the page views.
 *
 * ⭐ **One queue carries every event type**, so a suite about `page_view` has to
 * say so. Before `time_on_page` shipped these assertions read the whole queue
 * and were accidentally right — the next event emitted from inside the tracker
 * itself would have broken them again.
 */
const pageViews = () => sentEvents().filter((e) => e.event === 'page_view')

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }))
  // `navigator` is deliberately left alone: it is a getter-only global on
  // current Node, and Node's own navigator has no `sendBeacon` — so the flush
  // takes the `fetch` branch, which is the one these tests assert against.
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.window
  delete globalThis.document
})

describe('absent means no-op', () => {
  it('is disabled with no endpoint, and arms nothing', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({}, browser)

    expect(tracker.isEnabled()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(Object.keys(browser.listeners)).toHaveLength(0)
  })

  it('control — a CONFIGURED tracker does arm both', async () => {
    // Without this the assertion above passes for any tracker, including one
    // that never arms anything under any circumstances.
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)

    expect(tracker.isEnabled()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    expect(Object.keys(browser.listeners).sort()).toEqual(['pagehide', 'visibilitychange'])
  })

  it('swallows every call without throwing or queueing', async () => {
    const tracker = await freshTracker({}, makeBrowser())

    expect(() => {
      tracker.track('anything', { a: 1 })
      tracker.trackPageView('/a')
      tracker.flush()
      tracker.flush(true)
      tracker.setConsent(true)
    }).not.toThrow()

    expect(tracker.queue).toHaveLength(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('a host declaring the name with no address is the same as nothing', async () => {
    // resolveService returns { url: null } for a decline, so the tracker is
    // constructed with no endpoint — there is no separate "declined" state.
    const tracker = await freshTracker({ endpoint: null }, makeBrowser())
    expect(tracker.isEnabled()).toBe(false)
  })

  it('is disabled outside a browser even WITH an endpoint', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, null)
    tracker.trackPageView('/a')
    expect(tracker.isEnabled()).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('is disabled in a framed document — the editor-preview suppression', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser({ framed: true }))
    tracker.trackPageView('/a')
    expect(tracker.isEnabled()).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('page views', () => {
  it('sends promptly rather than waiting out the batch window', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(pageViews()).toMatchObject([{ event: 'page_view', path: '/a' }])
  })

  it('guards CONSECUTIVE same-path reports', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/a') // StrictMode double-invoke, or a stray re-render
    expect(pageViews()).toHaveLength(1)
  })

  it('is NOT revisit-dedupe: A→B→A reports three times', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    tracker.trackPageView('/a')
    expect(pageViews().map((e) => e.path)).toEqual(['/a', '/b', '/a'])
  })

  it('carries nothing beyond the closed payload plus the envelope', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')

    const [event] = pageViews()
    // ⛔ Adding a key here is a DELIBERATE act and this line is the gate.
    // `first_of_load` was added 2026-08-24; it is a boolean about this document
    // load and carries no identity, which is the bar anything on this list has
    // to clear.
    expect(Object.keys(event).sort()).toEqual(['event', 'first_of_load', 'path', 'visit'])
    // No session duration, no timestamp, no identity at the wrapper level either.
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body)
    expect(Object.keys(body)).toEqual(['events'])
  })
})

describe('the visit key — one document, not one visitor', () => {
  it('rides the envelope on every event, with the same value', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT, maxQueueSize: 1 }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.track('download')
    tracker.trackPageView('/b')

    // FOUR, not three: leaving `/a` also reports its `time_on_page`. Counted
    // deliberately rather than filtered out — the claim is that the envelope
    // rides *every* event, and an event emitted from inside the tracker itself
    // is exactly the one that could slip past `enqueue`.
    const keys = sentEvents().map((e) => e.visit)
    expect(keys).toHaveLength(4)
    expect(keys[0]).toBeTruthy()
    expect(new Set(keys).size).toBe(1)
  })

  it('is different for a different document', async () => {
    const one = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    const two = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    expect(one.visit).not.toBe(two.visit)
  })

  it('is not minted when there is nowhere to send it', async () => {
    const tracker = await freshTracker({}, makeBrowser())
    expect(tracker.visit).toBe(null)
  })

  it('survives the consent boundary — buffered and post-grant events share it', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT, consentRequired: true, maxQueueSize: 1 },
      makeBrowser()
    )
    tracker.trackPageView('/a') // buffered
    tracker.setConsent(true) // flushes the buffer
    tracker.trackPageView('/b') // sent live

    // THREE: `/a`'s dwell closes when `/b` arrives, and it must share the key —
    // an event minted after the consent boundary that carried a different one
    // would split a single visit in two.
    const keys = sentEvents().map((e) => e.visit)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
  })

  /**
   * The principle is "nothing PERSISTENT is minted", and persistence means
   * storage. This asserts it mechanically rather than trusting the reading of
   * the code — if anyone ever reaches for a cookie to make the key survive a
   * refresh, it stops being a correlation token and becomes an identity.
   */
  it('touches no browser storage at all', async () => {
    const browser = makeBrowser()
    const cookieSet = vi.fn()
    Object.defineProperty(browser.doc, 'cookie', {
      get: () => '',
      set: cookieSet,
      configurable: true
    })
    const storage = () => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })
    browser.win.localStorage = storage()
    browser.win.sessionStorage = storage()
    globalThis.localStorage = browser.win.localStorage
    globalThis.sessionStorage = browser.win.sessionStorage

    try {
      const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)
      tracker.trackPageView('/a')
      tracker.track('x')
      tracker.flush(true)

      expect(cookieSet).not.toHaveBeenCalled()
      for (const store of [browser.win.localStorage, browser.win.sessionStorage]) {
        expect(store.setItem).not.toHaveBeenCalled()
        expect(store.getItem).not.toHaveBeenCalled()
      }
      // Control: the run above really did emit, so the assertions had a chance
      // to fail rather than passing on an inert tracker.
      expect(sentEvents().length).toBeGreaterThan(0)
    } finally {
      delete globalThis.localStorage
      delete globalThis.sessionStorage
    }
  })
})

describe('acquisition context — captured once, replayed on every page view', () => {
  const browserWithCampaign = () =>
    makeBrowser({
      url: 'https://site.test/a?utm_source=news&utm_medium=email&utm_campaign=spring',
      referrer: 'https://elsewhere.test/post'
    })

  it('attaches referrer and utm to EVERY page view, not only the first', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browserWithCampaign())
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')

    const events = pageViews()
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event.referrer).toBe('https://elsewhere.test/post')
      expect(event.utm_source).toBe('news')
      expect(event.utm_medium).toBe('email')
      expect(event.utm_campaign).toBe('spring')
    }
  })

  it('captures at construction, so a later URL change cannot alter it', async () => {
    const browser = browserWithCampaign()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)

    // SPA navigation: the params leave the URL. The replay must not follow.
    browser.win.location = new URL('https://site.test/b')
    tracker.trackPageView('/b')

    expect(sentEvents()[0].utm_source).toBe('news')
  })

  it('drops a same-origin referrer — internal navigation is not a referral', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({ referrer: 'https://site.test/previous' })
    )
    tracker.trackPageView('/a')
    expect(sentEvents()[0]).not.toHaveProperty('referrer')
  })

  /**
   * `continues` — the bit that survives dropping the same-origin referrer.
   *
   * ⭐ **Measured in Chrome 151 before this was built**, because the design
   * rested on an assumption nobody had checked: a same-origin plain-`<a>`
   * navigation (what kit's `<Link reload>` renders) DOES populate
   * `document.referrer`, an address-bar arrival does NOT, and a page sending
   * `<meta name="referrer" content="no-referrer">` collapses the first onto the
   * second. ⚠️ One engine only — Firefox and Safari are unverified, and this is
   * spec-governed behaviour where agreement is expected but not shown.
   */
  it('marks a same-origin arrival as a continuation', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({ referrer: 'https://site.test/previous' })
    )
    tracker.trackPageView('/a')
    expect(sentEvents()[0].continues).toBe(true)
  })

  // The control that makes the one above mean something: an EXTERNAL referral
  // is a real arrival, so it must carry `referrer` and NOT the bit. Without
  // this, "sets continues" is indistinguishable from "always sets continues".
  it('does not mark an external referral as a continuation', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({ referrer: 'https://elsewhere.test/post' })
    )
    tracker.trackPageView('/a')
    const event = sentEvents()[0]
    expect(event.referrer).toBe('https://elsewhere.test/post')
    expect(event).not.toHaveProperty('continues')
  })

  // ⛔ Emitted only when true, so a direct arrival carries nothing. Absent then
  // means both "not a continuation" and "a runtime too old to say" — collapsing
  // to today's behaviour rather than to a wrong answer.
  it('says nothing at all on a direct arrival', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser({ referrer: '' }))
    tracker.trackPageView('/a')
    expect(sentEvents()[0]).not.toHaveProperty('continues')
  })

  // It rides on EVERY page view of the document, like referrer and utm_*, since
  // it is captured once and replayed — a visitor who continues in and then
  // navigates has not turned into a direct arrival.
  it('rides every page view of the document, not only the first', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({ referrer: 'https://site.test/previous' })
    )
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    expect(pageViews().map((e) => e.continues)).toEqual([true, true])
  })

  // ⛔ The privacy line: the bit says a visit continues, never WHICH visit. If
  // it ever carried an id, this file's categorical no-persistent-identifier
  // claim would be false while every other test still passed.
  it('carries no identity — the bit is a boolean and nothing else', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({ referrer: 'https://site.test/previous' })
    )
    tracker.trackPageView('/a')
    expect(typeof sentEvents()[0].continues).toBe('boolean')
    expect(Object.keys(sentEvents()[0]).sort()).toEqual(
      ['continues', 'event', 'first_of_load', 'path', 'visit'].sort()
    )
  })

  it('omits the fields entirely when there is no acquisition context', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    // Key-set equality, not toMatchObject: the point is that referrer and utm_*
    // are ABSENT, and toMatchObject would tolerate them.
    // `first_of_load` is not an acquisition field — it is computed per view —
    // so it is present here while every acquisition field is gone. That
    // difference is the reason it does not live in `acquisition`.
    expect(Object.keys(sentEvents()[0]).sort()).toEqual(['event', 'first_of_load', 'path', 'visit'])
  })

  /**
   * `first_of_load` — the one view that opened this document.
   *
   * ⭐ **Why the framework emits a bit a consumer could derive.** Only a
   * consumer that RETAINS events can derive it: "the first `page_view` with
   * this `visit`" requires remembering which `visit` values have been seen,
   * which is retaining `visit`. A counter store that keeps no per-event rows
   * cannot, and is a supported consumer — a collector that aggregates into
   * counters and keeps no rows is an ordinary shape, not an unusual one.
   *
   * ⛔ The pair below is the whole contract: it must appear on the first view
   * and be ABSENT on the rest. Either half alone is satisfied by a constant.
   */
  it('marks the first page view of the document', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    expect(sentEvents()[0].first_of_load).toBe(true)
  })

  it('does NOT mark any later view of the same document', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    tracker.trackPageView('/c')
    expect(pageViews().map((e) => e.first_of_load)).toEqual([true, undefined, undefined])
  })

  // ⛔ The opposite of `continues`, and the contrast is the point: acquisition
  // is captured once and REPLAYED, this is computed per view and emitted once.
  // A regression that moved it into `acquisition` would redden here and pass
  // the test above.
  it('is emitted once even when acquisition rides every view', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({ referrer: 'https://site.test/previous' })
    )
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    expect(pageViews().map((e) => e.continues)).toEqual([true, true])
    expect(pageViews().map((e) => e.first_of_load)).toEqual([true, undefined])
  })

  // The StrictMode guard must not spend the bit. A double-invoked effect
  // reports the same path twice; the second is dropped, so the NEXT real
  // navigation must still be the second view and not the first.
  it('survives a duplicate report of the same path', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    expect(pageViews().map((e) => e.path)).toEqual(['/a', '/b'])
    expect(pageViews().map((e) => e.first_of_load)).toEqual([true, undefined])
  })

  // ⛔ Never `false`. Absent is the negative, like `continues` — a consumer
  // branching on presence must not have to branch on value too.
  it('is omitted rather than sent as false', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    expect(Object.keys(sentEvents()[1])).not.toContain('first_of_load')
  })

  // A foundation's own events are not page views and must not carry it.
  it('never appears on a foundation event', async () => {
    // maxQueueSize 1 so the single foundation event flushes — `track()` is not
    // immediate, unlike `trackPageView`, and without this the assertion would
    // run against an empty queue and pass for the wrong reason.
    const tracker = await freshTracker({ endpoint: ENDPOINT, maxQueueSize: 1 }, makeBrowser())
    tracker.track('read_depth', { depth: 25 })
    expect(sentEvents()).toHaveLength(1)
    expect(Object.keys(sentEvents()[0])).not.toContain('first_of_load')
  })
})

describe('foundation events', () => {
  it('batch until maxQueueSize rather than sending one request each', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT, maxQueueSize: 3 }, makeBrowser())

    tracker.track('a')
    tracker.track('b')
    expect(globalThis.fetch).not.toHaveBeenCalled()

    tracker.track('c')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(sentEvents().map((e) => e.event)).toEqual(['a', 'b', 'c'])
  })

  it('inherit the current path, and let the caller override it', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT, maxQueueSize: 1 }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.track('download', { file: 'x.pdf' })
    tracker.track('elsewhere', { path: '/other' })

    const [, download, elsewhere] = sentEvents()
    expect(download).toMatchObject({ event: 'download', path: '/a', file: 'x.pdf' })
    expect(elsewhere.path).toBe('/other')
  })

  it('ignore an empty event name', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT, maxQueueSize: 1 }, makeBrowser())
    tracker.track('')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('consent', () => {
  const pending = () =>
    freshTracker({ endpoint: ENDPOINT, consentRequired: true, maxQueueSize: 1 }, makeBrowser())

  it('buffers while pending and sends nothing', async () => {
    const tracker = await pending()
    tracker.trackPageView('/a')
    tracker.track('download')

    expect(tracker.consentStatus()).toBe('pending')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(tracker.queue).toHaveLength(2)
  })

  it('flushes the buffer on grant — the views before the click are not lost', async () => {
    const tracker = await pending()
    tracker.trackPageView('/a')
    tracker.setConsent(true)

    expect(tracker.consentStatus()).toBe('granted')
    expect(pageViews().map((e) => e.path)).toEqual(['/a'])
  })

  it('discards the buffer on deny and stops accepting', async () => {
    const tracker = await pending()
    tracker.trackPageView('/a')
    tracker.setConsent(false)
    tracker.track('later')

    expect(tracker.consentStatus()).toBe('denied')
    expect(tracker.queue).toHaveLength(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('is granted by default — declaring a destination is the decision', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    expect(tracker.consentStatus()).toBe('granted')
  })

  it('records the decision in a FRAMED document', async () => {
    // Enablement and consent answer different questions: "have we anywhere to
    // send?" and "what did the visitor say?". The framed suppression exists so
    // an authoring session cannot inflate a site's numbers, and it belongs on
    // the sending — a status that can never move leaves a banner rendered and
    // undismissable.
    const tracker = await freshTracker(
      { endpoint: ENDPOINT, consentRequired: true },
      makeBrowser({ framed: true })
    )
    expect(tracker.consentStatus()).toBe('pending')

    tracker.setConsent(true)

    expect(tracker.consentStatus()).toBe('granted')
    // Controls: recording a decision is not emitting one.
    expect(tracker.isEnabled()).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('records the decision with NO destination resolved', async () => {
    const tracker = await freshTracker({ consentRequired: true }, makeBrowser())
    expect(tracker.consentStatus()).toBe('pending')

    tracker.setConsent(false)

    expect(tracker.consentStatus()).toBe('denied')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('caps the pending buffer so an unanswered banner cannot grow it forever', async () => {
    const tracker = await pending()
    for (let i = 0; i < 200; i++) tracker.track(`e${i}`)

    expect(tracker.queue.length).toBeLessThanOrEqual(50)
    // Newest dropped, not oldest: the earliest events are the ones worth keeping.
    expect(tracker.queue[0].event).toBe('e0')
  })
})

describe('delivery', () => {
  it('does NOT re-queue on failure — the retry loop is deliberately gone', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')))
    const tracker = await freshTracker({ endpoint: ENDPOINT, maxQueueSize: 1 }, makeBrowser())

    tracker.track('a')
    await Promise.resolve()

    expect(tracker.queue).toHaveLength(0)
    tracker.track('b')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2) // one per event, not a loop
  })

  it('flushes on the interval', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT, flushInterval: 5000, maxQueueSize: 99 },
      makeBrowser()
    )
    tracker.track('a')
    expect(globalThis.fetch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

/**
 * `time_on_page` — how long a visitor spent on one route.
 *
 * ⭐ **The whole design is "one event per page visit, raw".** A second event for
 * one visit inflates the count the consumer divides by, so every mean it derives
 * is wrong — and nothing downstream can detect it, because a sum and a count are
 * both plausible whatever they hold. The guard is asserted directly.
 */
describe('time_on_page', () => {
  const dwell = () => sentEvents().filter((e) => e.event === 'time_on_page')

  /** Advance wall-clock time; the tracker reads `Date.now()`, not timers. */
  let clock
  beforeEach(() => {
    clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
  })
  const wait = (ms) => {
    clock += ms
  }

  it('closes the OUTGOING page at a route change, not the incoming one', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    wait(5000)
    tracker.trackPageView('/b')

    expect(dwell()).toMatchObject([{ path: '/a', durationMs: 5000 }])
  })

  // ⛔ The failure an unload-only implementation has: one duration per DOCUMENT,
  // silently attributed to the last page seen. Three routes must yield two
  // closed dwells with their own paths — the third is still open.
  it('reports per ROUTE across an SPA visit, not once per document', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    wait(1000)
    tracker.trackPageView('/b')
    wait(2000)
    tracker.trackPageView('/c')

    expect(dwell().map((e) => [e.path, e.durationMs])).toEqual([
      ['/a', 1000],
      ['/b', 2000]
    ])
  })

  it('reports the last page at pagehide, which a route change never closes', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)
    tracker.trackPageView('/a')
    wait(3000)
    browser.listeners.pagehide.forEach((fn) => fn())

    expect(dwell()).toMatchObject([{ path: '/a', durationMs: 3000 }])
  })

  // ⭐ Otherwise it measures tab-open rather than reading.
  it('SUBTRACTS time the document spent hidden', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)
    const hide = () => {
      browser.doc.visibilityState = 'hidden'
      browser.listeners.visibilitychange.forEach((fn) => fn())
    }
    const show = () => {
      browser.doc.visibilityState = 'visible'
      browser.listeners.visibilitychange.forEach((fn) => fn())
    }

    tracker.trackPageView('/a')
    wait(1000)
    hide()
    wait(60_000) // a minute in another tab
    show()
    wait(2000)
    tracker.trackPageView('/b')

    expect(dwell()).toMatchObject([{ path: '/a', durationMs: 3000 }])
  })

  // ⛔ Visibility is a PAUSE, not an end. Emitting here would truncate exactly
  // the engaged readers this metric exists to find, and a second event for one
  // visit would corrupt every mean derived from it.
  it('does NOT report when the document merely becomes hidden', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)
    tracker.trackPageView('/a')
    wait(1000)
    browser.doc.visibilityState = 'hidden'
    browser.listeners.visibilitychange.forEach((fn) => fn())

    expect(dwell()).toHaveLength(0)
  })

  it('reports AT MOST ONCE per page visit, even when both terminal signals fire', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)
    tracker.trackPageView('/a')
    wait(1000)
    browser.listeners.pagehide.forEach((fn) => fn())
    browser.listeners.pagehide.forEach((fn) => fn()) // a second one, or a late route change
    tracker.trackPageView('/b')

    expect(dwell()).toHaveLength(1)
  })

  // ⛔ Both belong to the collector: applied here they are frozen at the speed of
  // a framework release, applied at write time they change when the host deploys.
  it('applies NO floor and NO clamp — the scalar is raw', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)
    tracker.trackPageView('/a')
    wait(12) // far under the collector's 500ms floor
    tracker.trackPageView('/b')
    wait(9 * 60 * 60 * 1000) // far over its 30-minute clamp
    browser.listeners.pagehide.forEach((fn) => fn())

    expect(dwell().map((e) => e.durationMs)).toEqual([12, 32_400_000])
  })

  it('carries nothing beyond the closed payload plus the envelope', async () => {
    // A campaign arrival on purpose: acquisition fields exist on this document,
    // so their ABSENCE below is a real exclusion rather than nothing to exclude.
    const tracker = await freshTracker(
      { endpoint: ENDPOINT },
      makeBrowser({
        url: 'https://site.test/a?utm_source=news&utm_medium=email&utm_campaign=spring',
        referrer: 'https://elsewhere.test/post'
      })
    )
    tracker.trackPageView('/a')
    wait(1000)
    tracker.trackPageView('/b')

    // Control: the page view DID carry them, so the gate below discriminates.
    expect(pageViews()[0].utm_source).toBe('news')

    // ⛔ Adding a key here is a DELIBERATE act and this line is the gate.
    // Acquisition fields and `continues` ride `page_view` ONLY — they answer a
    // question about arrival, and repeating them on a duration would invite a
    // consumer to facet dwell by campaign as if it had been observed per event.
    expect(Object.keys(dwell()[0]).sort()).toEqual(['durationMs', 'event', 'path', 'visit'])
  })

  it('is gated by arms(), so a narrowed site emits none of it', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT, siteEmit: ['page_view'] },
      makeBrowser()
    )
    tracker.trackPageView('/a')
    wait(5000)
    tracker.trackPageView('/b')

    expect(dwell()).toHaveLength(0)
    expect(pageViews()).toHaveLength(2) // control: the same calls DID emit
  })
})

/**
 * ⛔ Page-boundary bookkeeping is NOT `page_view`'s to gate.
 *
 * `trackPageView` maintains two things every other event depends on —
 * `currentPath`, which is the default `path` on EVERY event, and the dwell
 * clock. Both used to sit behind `arms('page_view')`, so a site that selected
 * other events but not that one lost them **silently**: no error, no warning,
 * a plausible payload with a field quietly missing.
 */
describe('a narrowed site that does not select page_view', () => {
  const emitWithout = { endpoint: ENDPOINT, siteEmit: ['outbound_click', 'time_on_page'] }

  it('still attributes OTHER events to the current path', async () => {
    const tracker = await freshTracker(emitWithout, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    tracker.track('outbound_click', { hostname: 'x.test' })
    // ⭐ Explicit: the PROMPT flush belongs to `page_view`, so a site that
    // narrowed it away batches normally instead. Correct, and worth stating —
    // it is why these assertions cannot read `sentEvents()` straight away.
    tracker.flush()

    const [click] = sentEvents().filter((e) => e.event === 'outbound_click')
    expect(click.path).toBe('/b')
    expect(pageViews()).toHaveLength(0) // control: page_view really is narrowed away
  })

  it('still reports time_on_page, which is armed independently', async () => {
    const clock = vi.spyOn(Date, 'now')
    let t = 1_000_000
    clock.mockImplementation(() => t)

    const tracker = await freshTracker(emitWithout, makeBrowser())
    tracker.trackPageView('/a')
    t += 4000
    tracker.trackPageView('/b')
    tracker.flush() // see above — no page_view, so no prompt flush

    expect(sentEvents().filter((e) => e.event === 'time_on_page')).toMatchObject([
      { path: '/a', durationMs: 4000 }
    ])
  })

  it('emits NOTHING at all when the site selects neither', async () => {
    const tracker = await freshTracker(
      { endpoint: ENDPOINT, siteEmit: ['outbound_click'] },
      makeBrowser()
    )
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')

    // Bookkeeping ran; no event was produced by it.
    tracker.flush()
    expect(sentEvents()).toHaveLength(0)
    expect(tracker.currentPath).toBe('/b')
  })
})
