import { describe, it, expect, jest } from '@jest/globals'
import DataStore from '../src/datastore.js'

describe('DataStore', () => {
  const config = { path: '/data/articles.json', schema: 'articles' }

  describe('get / set / has', () => {
    it('returns null on cache miss', () => {
      const store = new DataStore()
      expect(store.has(config)).toBe(false)
      expect(store.get(config)).toBeNull()
    })

    it('stores and retrieves data', () => {
      const store = new DataStore()
      const data = [{ id: 1, title: 'Hello' }]
      store.set(config, data)

      expect(store.has(config)).toBe(true)
      expect(store.get(config)).toEqual(data)
    })

    it('uses normalized key (field order does not matter)', () => {
      const store = new DataStore()
      const data = [1, 2, 3]

      // set with one field ordering
      store.set({ schema: 'articles', path: '/data/articles.json' }, data)

      // get with the canonical ordering
      expect(store.get(config)).toEqual(data)
    })
  })

  describe('fetch — cache hit', () => {
    it('returns cached data without calling fetcher', async () => {
      const store = new DataStore()
      const fetcher = jest.fn()
      store.registerFetcher(fetcher)

      const data = [{ id: 1 }]
      store.set(config, data)

      const result = await store.fetch(config)
      expect(result).toEqual({ data })
      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  describe('fetch — in-flight dedup', () => {
    it('calls fetcher only once for concurrent requests', async () => {
      const store = new DataStore()
      const data = [{ id: 1 }]
      const fetcher = jest.fn().mockResolvedValue({ data })
      store.registerFetcher(fetcher)

      // Two concurrent fetches for the same config
      const [r1, r2] = await Promise.all([
        store.fetch(config),
        store.fetch(config),
      ])

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(r1.data).toEqual(data)
      expect(r2.data).toEqual(data)

      // Data should now be cached
      expect(store.has(config)).toBe(true)
    })
  })

  describe('fetch — miss', () => {
    it('calls fetcher and caches the result', async () => {
      const store = new DataStore()
      const data = [{ id: 2 }]
      const fetcher = jest.fn().mockResolvedValue({ data })
      store.registerFetcher(fetcher)

      const result = await store.fetch(config)
      expect(result.data).toEqual(data)
      expect(store.get(config)).toEqual(data)
    })

    it('does not cache null data', async () => {
      const store = new DataStore()
      const fetcher = jest.fn().mockResolvedValue({ data: null, error: 'Not found' })
      store.registerFetcher(fetcher)

      const result = await store.fetch(config)
      expect(result.error).toBe('Not found')
      expect(store.has(config)).toBe(false)
    })
  })

  describe('clear', () => {
    it('flushes cache and in-flight map', async () => {
      const store = new DataStore()
      store.set(config, [1])
      expect(store.has(config)).toBe(true)

      store.clear()
      expect(store.has(config)).toBe(false)
    })
  })

  describe('error — no fetcher', () => {
    it('throws when fetch is called without registerFetcher', async () => {
      const store = new DataStore()
      await expect(store.fetch(config)).rejects.toThrow('no fetcher registered')
    })
  })
})
