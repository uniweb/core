/**
 * Tracker — the no-op contract, the consent gate, and field lifetime.
 *
 * `isBrowser` and the framed check are evaluated at MODULE SCOPE, so every case
 * installs its globals and then imports a fresh copy (`vi.resetModules()` +
 * dynamic import). Setting globals after the import would test nothing.
 *
 * Design: `kb/framework/plans/tracking.md`.
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
    expect(tracker.flushIntervalId).toBe(null)
    expect(Object.keys(browser.listeners)).toHaveLength(0)
  })

  it('swallows every call without throwing or queueing', async () => {
    const tracker = await freshTracker({}, makeBrowser())

    expect(() => {
      tracker.track('anything', { a: 1 })
      tracker.trackPageView('/a')
      tracker.flush()
      tracker.flush(true)
      tracker.setConsent(true)
      tracker.destroy()
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
    expect(sentEvents()).toMatchObject([{ event: 'page_view', path: '/a' }])
  })

  it('guards CONSECUTIVE same-path reports', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/a') // StrictMode double-invoke, or a stray re-render
    expect(sentEvents()).toHaveLength(1)
  })

  it('is NOT revisit-dedupe: A→B→A reports three times', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    tracker.trackPageView('/b')
    tracker.trackPageView('/a')
    expect(sentEvents().map((e) => e.path)).toEqual(['/a', '/b', '/a'])
  })

  it('carries nothing beyond the closed payload plus the envelope', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')

    const [event] = sentEvents()
    expect(Object.keys(event).sort()).toEqual(['event', 'path', 'visit'])
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

    const keys = sentEvents().map((e) => e.visit)
    expect(keys).toHaveLength(3)
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

    const keys = sentEvents().map((e) => e.visit)
    expect(keys).toHaveLength(2)
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

    const events = sentEvents()
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

  it('omits the fields entirely when there is no acquisition context', async () => {
    const tracker = await freshTracker({ endpoint: ENDPOINT }, makeBrowser())
    tracker.trackPageView('/a')
    // Key-set equality, not toMatchObject: the point is that referrer and utm_*
    // are ABSENT, and toMatchObject would tolerate them.
    expect(Object.keys(sentEvents()[0]).sort()).toEqual(['event', 'path', 'visit'])
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
    expect(sentEvents().map((e) => e.path)).toEqual(['/a'])
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

  it('arms the interval and unload listeners only when enabled', async () => {
    const browser = makeBrowser()
    const tracker = await freshTracker({ endpoint: ENDPOINT }, browser)

    expect(tracker.flushIntervalId).not.toBe(null)
    expect(Object.keys(browser.listeners).sort()).toEqual(['pagehide', 'visibilitychange'])

    tracker.destroy()
    expect(tracker.flushIntervalId).toBe(null)
    expect(browser.listeners.pagehide).toHaveLength(0)
    expect(browser.listeners.visibilitychange).toHaveLength(0)
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
