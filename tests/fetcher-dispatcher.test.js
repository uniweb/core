import { describe, it, expect, jest } from '@jest/globals'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'
import DataStore, { deriveCacheKey } from '../src/datastore.js'

function buildFoundationTransports(transports = {}, extras = {}) {
  return { default: { ...extras, transports } }
}

function websiteCtx(fetcherConfig) {
  return { website: { config: { fetcher: fetcherConfig } } }
}

describe('FetcherDispatcher', () => {
  describe('named transports', () => {
    it('uses the framework default when no foundation declares transports', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: [1, 2] }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const result = await d.dispatch({ path: '/a.json', schema: 'a' }, {})
      expect(result.data).toEqual([1, 2])
      expect(defaultFetcher.resolve).toHaveBeenCalled()
    })

    it('uses the framework default when the site picks no transport', async () => {
      const dataStore = new DataStore()
      const members = jest.fn()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['default'] }) }
      const foundation = buildFoundationTransports({ uniweb: { resolve: members } })
      const d = new FetcherDispatcher({ foundation, dataStore, defaultFetcher })

      // No fetcher.transports on the site → default wins even though 'uniweb' is registered.
      const result = await d.dispatch({ schema: 'members' }, websiteCtx({}))
      expect(result.data).toEqual(['default'])
      expect(members).not.toHaveBeenCalled()
    })

    it('selects a named transport per site.yml fetcher.transports[schema]', async () => {
      const dataStore = new DataStore()
      const uniweb = { resolve: jest.fn().mockResolvedValue({ data: ['m'] }) }
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['default'] }) }
      const foundation = buildFoundationTransports({ uniweb: uniweb })
      const d = new FetcherDispatcher({ foundation, dataStore, defaultFetcher })

      const r1 = await d.dispatch(
        { schema: 'members' },
        websiteCtx({ transports: { members: 'uniweb' } }),
      )
      expect(r1.data).toEqual(['m'])

      // Other schemas fall through to default.
      const r2 = await d.dispatch(
        { schema: 'articles' },
        websiteCtx({ transports: { members: 'uniweb' } }),
      )
      expect(r2.data).toEqual(['default'])
    })

    it('honors fetcher.transports.default as the site-level default', async () => {
      const dataStore = new DataStore()
      const uniweb = { resolve: jest.fn().mockResolvedValue({ data: ['all'] }) }
      const foundation = buildFoundationTransports({ uniweb: uniweb })
      const d = new FetcherDispatcher({ foundation, dataStore })

      const r = await d.dispatch(
        { schema: 'anything' },
        websiteCtx({ transports: { default: 'uniweb' } }),
      )
      expect(r.data).toEqual(['all'])
    })

    it('primary wins over extension on name collision with a dev warning', async () => {
      const dataStore = new DataStore()
      const primary = { resolve: jest.fn().mockResolvedValue({ data: ['primary'] }) }
      const ext = { resolve: jest.fn() }
      const foundation = buildFoundationTransports({ uniweb: primary })
      const extension = { default: { transports: { uniweb: ext } } }
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      const d = new FetcherDispatcher({
        foundation,
        extensions: [extension],
        dataStore,
        dev: true,
      })

      const r = await d.dispatch(
        { schema: 'anything' },
        websiteCtx({ transports: { anything: 'uniweb' } }),
      )
      expect(r.data).toEqual(['primary'])
      expect(ext.resolve).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('extension transport "uniweb" ignored'),
      )
      warn.mockRestore()
    })

    it('extension contributes a transport the primary foundation does not provide', async () => {
      const dataStore = new DataStore()
      const extResolve = jest.fn().mockResolvedValue({ data: ['e'] })
      const extension = { default: { transports: { stats: { resolve: extResolve } } } }
      const d = new FetcherDispatcher({
        foundation: null,
        extensions: [extension],
        dataStore,
      })

      const r = await d.dispatch(
        { schema: 'views' },
        websiteCtx({ transports: { views: 'stats' } }),
      )
      expect(r.data).toEqual(['e'])
    })

    it('tolerates an extension whose transports getter throws (warns, keeps registry)', async () => {
      const dataStore = new DataStore()
      const good = { resolve: jest.fn().mockResolvedValue({ data: ['g'] }) }
      const badExt = { default: Object.defineProperty({}, 'transports', {
        get() { throw new Error('boom') },
      }) }
      const goodExt = { default: { transports: { stats: good } } }
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      const d = new FetcherDispatcher({
        foundation: null,
        extensions: [badExt, goodExt],
        dataStore,
        dev: true,
      })

      const r = await d.dispatch(
        { schema: 'views' },
        websiteCtx({ transports: { views: 'stats' } }),
      )
      expect(r.data).toEqual(['g'])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('extension transports getter threw'),
        expect.anything(),
      )
      warn.mockRestore()
    })

    it('skips a transport entry missing resolve() with a dev warning', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['d'] }) }
      const foundation = buildFoundationTransports({
        broken: { notResolve: 'oops' },
        ok: { resolve: jest.fn() },
      })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const d = new FetcherDispatcher({ foundation, dataStore, defaultFetcher, dev: true })

      // Site picks the broken one → dispatcher drops the mapping and falls back.
      const r = await d.dispatch(
        { schema: 'x' },
        websiteCtx({ transports: { x: 'broken' } }),
      )
      expect(r.data).toEqual(['d'])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('primary foundation transport "broken" missing resolve()'),
      )
      warn.mockRestore()
    })

    it('site picks a name that no foundation registered — falls back to default with warning', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['d'] }) }
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const d = new FetcherDispatcher({
        foundation: null,
        dataStore,
        defaultFetcher,
        dev: true,
      })

      const r = await d.dispatch(
        { schema: 'articles' },
        websiteCtx({ transports: { articles: 'ghost' } }),
      )
      expect(r.data).toEqual(['d'])
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('site selected transport "ghost"'),
      )
      warn.mockRestore()
    })
  })

  describe('caching', () => {
    it('returns cached entry without calling the fetcher', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn() }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      dataStore.set(deriveCacheKey(request), { data: [1, 2, 3], meta: { t: 5 } })

      const result = await d.dispatch(request, {})
      expect(result).toEqual({ data: [1, 2, 3], meta: { t: 5 } })
      expect(defaultFetcher.resolve).not.toHaveBeenCalled()
    })

    it('writes { data, meta } on success', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['x'], meta: { t: 1 } }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      await d.dispatch(request, {})

      const key = deriveCacheKey(request)
      expect(dataStore.get(key)).toEqual({ data: ['x'], meta: { t: 1 } })
    })

    it('does not cache error results', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: [], error: 'HTTP 500' }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      const result = await d.dispatch(request, {})

      expect(result.error).toBe('HTTP 500')
      expect(dataStore.has(deriveCacheKey(request))).toBe(false)
    })

    it('does not cache when the fetcher throws', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockRejectedValue(new Error('boom')) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      const result = await d.dispatch(request, {})

      expect(result.data).toEqual([])
      expect(result.error).toBe('boom')
      expect(dataStore.has(deriveCacheKey(request))).toBe(false)
      expect(dataStore.inflight.size).toBe(0)
    })

    it('uses fetcher.cacheKey(request) when provided', async () => {
      const dataStore = new DataStore()
      const resolve = jest.fn().mockResolvedValue({ data: ['x'] })
      const defaultFetcher = { resolve, cacheKey: (r) => `ck:${r.schema}:${r.slug ?? ''}` }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      await d.dispatch({ schema: 'members', slug: 'tenured' }, {})
      expect(dataStore.has('ck:members:tenured')).toBe(true)

      // Different slug → different key → another fetch runs.
      await d.dispatch({ schema: 'members', slug: 'emeritus' }, {})
      expect(resolve).toHaveBeenCalledTimes(2)
      expect(dataStore.has('ck:members:emeritus')).toBe(true)
    })
  })

  describe('peek', () => {
    it('returns null on cache miss and does not start a fetch', () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn() }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      expect(d.peek({ path: '/a.json', schema: 'a' }, {})).toBeNull()
      expect(defaultFetcher.resolve).not.toHaveBeenCalled()
    })

    it('returns the cached entry using the fetcher-specific cacheKey', () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn(), cacheKey: (r) => `ck:${r.schema}` }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      dataStore.set('ck:members', { data: ['m'], meta: { t: 1 } })
      expect(d.peek({ schema: 'members' }, {})).toEqual({ data: ['m'], meta: { t: 1 } })
    })
  })

  describe('in-flight dedup', () => {
    it('two concurrent dispatches share one fetcher call', async () => {
      const dataStore = new DataStore()
      let resolveFetch
      const pending = new Promise((r) => { resolveFetch = r })
      const defaultFetcher = { resolve: jest.fn().mockReturnValue(pending) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const req = { path: '/a.json', schema: 'a' }
      const p1 = d.dispatch(req, {})
      const p2 = d.dispatch(req, {})

      expect(defaultFetcher.resolve).toHaveBeenCalledTimes(1)

      resolveFetch({ data: [42] })
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1.data).toEqual([42])
      expect(r2.data).toEqual([42])
    })

    it('aborting one signal does not cancel the shared master while others are live', async () => {
      const dataStore = new DataStore()
      let seenSignal
      let resolveFetch
      const defaultFetcher = {
        resolve: jest.fn((req, ctx) => {
          seenSignal = ctx.signal
          return new Promise((r) => { resolveFetch = r })
        }),
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const c1 = new AbortController()
      const c2 = new AbortController()
      const req = { path: '/a.json', schema: 'a' }

      const p1 = d.dispatch(req, { signal: c1.signal })
      const p2 = d.dispatch(req, { signal: c2.signal })

      c1.abort() // one caller gives up
      expect(seenSignal.aborted).toBe(false) // master still live

      resolveFetch({ data: ['ok'] })
      const r2 = await p2
      expect(r2.data).toEqual(['ok'])
      await p1 // also resolves with the same data
    })

    it('aborts the master when every attached signal has aborted', async () => {
      const dataStore = new DataStore()
      let seenSignal
      const defaultFetcher = {
        resolve: jest.fn((req, ctx) => {
          seenSignal = ctx.signal
          return new Promise(() => {}) // never resolves
        }),
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const c1 = new AbortController()
      const c2 = new AbortController()
      const req = { path: '/a.json', schema: 'a' }

      d.dispatch(req, { signal: c1.signal })
      d.dispatch(req, { signal: c2.signal })

      c1.abort()
      expect(seenSignal.aborted).toBe(false)
      c2.abort()
      expect(seenSignal.aborted).toBe(true)
    })

    it('aborts the master immediately when the first attached signal is already aborted', async () => {
      const dataStore = new DataStore()
      let seenSignal
      let resolveFetch
      const defaultFetcher = {
        resolve: jest.fn((req, ctx) => {
          seenSignal = ctx.signal
          return new Promise((r) => { resolveFetch = r })
        }),
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const controller = new AbortController()
      controller.abort() // abort BEFORE dispatch

      const p = d.dispatch({ path: '/a.json', schema: 'a' }, { signal: controller.signal })
      // Fetcher sees an already-aborted master signal.
      expect(seenSignal.aborted).toBe(true)

      resolveFetch({ data: ['ok'] })
      await p
    })

    it('does not abort the master when no caller supplied a signal', async () => {
      const dataStore = new DataStore()
      let seenSignal
      let resolveFetch
      const defaultFetcher = {
        resolve: jest.fn((req, ctx) => {
          seenSignal = ctx.signal
          return new Promise((r) => { resolveFetch = r })
        }),
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const p = d.dispatch({ path: '/a.json', schema: 'a' }, {}) // no signal
      expect(seenSignal.aborted).toBe(false)

      resolveFetch({ data: ['ok'] })
      await p
    })
  })

  describe('dev-mode validation', () => {
    it('warns when the fetcher returns a non-object', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue('oops') }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher, dev: true })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await d.dispatch({ path: '/a.json', schema: 'a' }, {})
      expect(result.error).toMatch(/non-object/)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('non-object'),
        expect.anything(),
      )
      warn.mockRestore()
    })

    it('warns on unexpected return keys', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: [1], extra: 'oops' }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher, dev: true })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await d.dispatch({ path: '/a.json', schema: 'a' }, {})
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('unexpected keys'),
        expect.anything(),
      )
      warn.mockRestore()
    })

    it('does not warn in production (dev: false)', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = {
        resolve: jest.fn().mockResolvedValue({ data: [], extra: 'oops' }),
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await d.dispatch({ url: 'https://x', schema: 's' }, {})
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('transport override', () => {
    it('wins over foundation transports and the framework default', async () => {
      const dataStore = new DataStore()
      const foundationResolve = jest.fn()
      const defaultFetcher = { resolve: jest.fn() }
      const transport = { resolve: jest.fn().mockResolvedValue({ data: ['bridge'] }) }

      const foundation = buildFoundationTransports({ uniweb: { resolve: foundationResolve } })
      const d = new FetcherDispatcher({
        foundation,
        dataStore,
        defaultFetcher,
        transport,
      })

      const result = await d.dispatch(
        { schema: 'anything', url: 'https://x' },
        websiteCtx({ transports: { anything: 'uniweb' } }),
      )
      expect(result.data).toEqual(['bridge'])
      expect(transport.resolve).toHaveBeenCalledTimes(1)
      expect(foundationResolve).not.toHaveBeenCalled()
      expect(defaultFetcher.resolve).not.toHaveBeenCalled()
    })

    it('handles every request through the override (bridge delegates internally)', async () => {
      const dataStore = new DataStore()
      const seen = []
      const transport = {
        resolve: (req) => {
          seen.push(req.url ?? req.path)
          return Promise.resolve({ data: [req.url ?? req.path] })
        },
      }
      const d = new FetcherDispatcher({
        foundation: null,
        dataStore,
        defaultFetcher: { resolve: jest.fn() },
        transport,
      })

      await d.dispatch({ url: 'https://api.example.com/a', schema: 'a' }, {})
      await d.dispatch({ path: '/data/b.json', schema: 'b' }, {})
      expect(seen).toEqual(['https://api.example.com/a', '/data/b.json'])
    })

    it('ignores a transport missing resolve() and falls through to defaults', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['d'] }) }
      const d = new FetcherDispatcher({
        foundation: null,
        dataStore,
        defaultFetcher,
        transport: { notResolve: () => {} },
      })

      const result = await d.dispatch({ path: '/a.json', schema: 'a' }, {})
      expect(result.data).toEqual(['d'])
      expect(defaultFetcher.resolve).toHaveBeenCalled()
    })
  })

  describe('listener notifications via DataStore.subscribe', () => {
    it('fires the DataStore subscriber on successful dispatch', async () => {
      const dataStore = new DataStore()
      const listener = jest.fn()
      dataStore.subscribe(listener)

      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['x'] }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      await d.dispatch({ path: '/a.json', schema: 'a' }, {})
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})
