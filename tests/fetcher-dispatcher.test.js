import { describe, it, expect, jest } from '@jest/globals'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'
import DataStore, { defaultCacheKey } from '../src/datastore.js'

function buildFoundation(fetcherSpec, extras = {}) {
  return { default: { ...extras, fetcher: fetcherSpec } }
}

describe('FetcherDispatcher', () => {
  describe('routing', () => {
    it('uses the framework default when no foundation declares a fetcher', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: [1, 2] }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const result = await d.dispatch({ path: '/a.json', schema: 'a' }, {})
      expect(result.data).toEqual([1, 2])
      expect(defaultFetcher.resolve).toHaveBeenCalled()
    })

    it('selects a primary route when match returns true', async () => {
      const dataStore = new DataStore()
      const members = { resolve: jest.fn().mockResolvedValue({ data: ['m'] }) }
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: ['default'] }) }
      const foundation = buildFoundation({
        routes: [{ match: (r) => r.schema === 'members', resolve: members.resolve }],
      })
      const d = new FetcherDispatcher({ foundation, dataStore, defaultFetcher })

      const r1 = await d.dispatch({ schema: 'members' }, {})
      expect(r1.data).toEqual(['m'])

      const r2 = await d.dispatch({ schema: 'articles' }, {})
      expect(r2.data).toEqual(['default'])
    })

    it('falls back to primary foundation fallback when no route matches', async () => {
      const dataStore = new DataStore()
      const fallback = { resolve: jest.fn().mockResolvedValue({ data: ['fallback'] }) }
      const defaultFetcher = { resolve: jest.fn() }
      const foundation = buildFoundation({
        routes: [{ match: () => false, resolve: jest.fn() }],
        fallback: { resolve: fallback.resolve },
      })
      const d = new FetcherDispatcher({ foundation, dataStore, defaultFetcher })

      const result = await d.dispatch({ schema: 'x' }, {})
      expect(result.data).toEqual(['fallback'])
      expect(defaultFetcher.resolve).not.toHaveBeenCalled()
    })

    it('walks extension routes after primary routes, in declared order', async () => {
      const dataStore = new DataStore()
      const ext1 = { resolve: jest.fn().mockResolvedValue({ data: ['ext1'] }) }
      const ext2 = { resolve: jest.fn().mockResolvedValue({ data: ['ext2'] }) }
      const defaultFetcher = { resolve: jest.fn() }

      const foundation = buildFoundation({ routes: [] })
      const extA = { default: { fetcher: { routes: [{ match: (r) => r.schema === 'stats', resolve: ext1.resolve }] } } }
      const extB = { default: { fetcher: { routes: [{ match: (r) => r.schema === 'stats', resolve: ext2.resolve }] } } }

      const d = new FetcherDispatcher({
        foundation,
        extensions: [extA, extB],
        dataStore,
        defaultFetcher,
      })

      const result = await d.dispatch({ schema: 'stats' }, {})
      expect(result.data).toEqual(['ext1'])
      expect(ext2.resolve).not.toHaveBeenCalled()
    })

    it('routes without a match function are treated as match-all', async () => {
      const dataStore = new DataStore()
      const custom = { resolve: jest.fn().mockResolvedValue({ data: ['c'] }) }
      const foundation = buildFoundation({
        routes: [{ resolve: custom.resolve }],
      })
      const d = new FetcherDispatcher({ foundation, dataStore })

      const result = await d.dispatch({ schema: 'anything' }, {})
      expect(result.data).toEqual(['c'])
    })

    it('swallows a throwing match predicate and skips that route', async () => {
      const dataStore = new DataStore()
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const bad = { resolve: jest.fn() }
      const good = { resolve: jest.fn().mockResolvedValue({ data: ['g'] }) }
      const foundation = buildFoundation({
        routes: [
          { match: () => { throw new Error('bad match') }, resolve: bad.resolve },
          { match: () => true, resolve: good.resolve },
        ],
      })
      const d = new FetcherDispatcher({ foundation, dataStore })

      const result = await d.dispatch({ schema: 'x' }, {})
      expect(result.data).toEqual(['g'])
      expect(bad.resolve).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('caching', () => {
    it('returns cached entry without calling the fetcher', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn() }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      dataStore.set(defaultCacheKey(request), { data: [1, 2, 3], meta: { t: 5 } })

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

      const key = defaultCacheKey(request)
      expect(dataStore.get(key)).toEqual({ data: ['x'], meta: { t: 1 } })
    })

    it('does not cache error results', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockResolvedValue({ data: [], error: 'HTTP 500' }) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      const result = await d.dispatch(request, {})

      expect(result.error).toBe('HTTP 500')
      expect(dataStore.has(defaultCacheKey(request))).toBe(false)
    })

    it('does not cache when the fetcher throws', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = { resolve: jest.fn().mockRejectedValue(new Error('boom')) }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })

      const request = { path: '/a.json', schema: 'a' }
      const result = await d.dispatch(request, {})

      expect(result.data).toEqual([])
      expect(result.error).toBe('boom')
      expect(dataStore.has(defaultCacheKey(request))).toBe(false)
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

    it('warns when the request carries fields not in expectedFields', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = {
        resolve: jest.fn().mockResolvedValue({ data: [] }),
        expectedFields: ['schema', 'url'],
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher, dev: true })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await d.dispatch({ url: 'https://x', schema: 's', wher: 'typo' }, {})
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('wher'),
        expect.anything(),
      )
      warn.mockRestore()
    })

    it('does not warn in production (dev: false)', async () => {
      const dataStore = new DataStore()
      const defaultFetcher = {
        resolve: jest.fn().mockResolvedValue({ data: [], extra: 'oops' }),
        expectedFields: ['schema'],
      }
      const d = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      await d.dispatch({ url: 'https://x', schema: 's', wher: 'typo' }, {})
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
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
