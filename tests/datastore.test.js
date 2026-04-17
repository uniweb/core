import { describe, it, expect, jest } from '@jest/globals'
import DataStore, { defaultCacheKey } from '../src/datastore.js'

describe('DataStore', () => {
  const config = { path: '/data/articles.json', schema: 'articles' }
  const key = defaultCacheKey(config)

  describe('get / set / has', () => {
    it('returns null on cache miss', () => {
      const store = new DataStore()
      expect(store.has(key)).toBe(false)
      expect(store.get(key)).toBeNull()
    })

    it('stores and retrieves entries', () => {
      const store = new DataStore()
      const entry = { data: [{ id: 1, title: 'Hello' }] }
      store.set(key, entry)

      expect(store.has(key)).toBe(true)
      expect(store.get(key)).toEqual(entry)
    })

    it('preserves meta on the entry', () => {
      const store = new DataStore()
      const entry = { data: [{ id: 1 }], meta: { fetchedAt: 123 } }
      store.set(key, entry)

      expect(store.get(key)).toEqual(entry)
    })
  })

  describe('subscribe', () => {
    it('fires listeners on set', () => {
      const store = new DataStore()
      const fn = jest.fn()
      store.subscribe(fn)

      store.set(key, { data: [] })
      expect(fn).toHaveBeenCalledTimes(1)

      store.set(key, { data: [{ id: 2 }] })
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('returns an unsubscribe function', () => {
      const store = new DataStore()
      const fn = jest.fn()
      const unsubscribe = store.subscribe(fn)

      unsubscribe()
      store.set(key, { data: [] })
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('inflight', () => {
    it('exposes a Map that the dispatcher can manage', () => {
      const store = new DataStore()
      expect(store.inflight).toBeInstanceOf(Map)

      const entry = { promise: Promise.resolve(), signals: new Set() }
      store.inflight.set(key, entry)
      expect(store.inflight.get(key)).toBe(entry)
    })
  })

  describe('clear', () => {
    it('flushes cache and in-flight map', () => {
      const store = new DataStore()
      store.set(key, { data: [1] })
      store.inflight.set(key, { promise: Promise.resolve(), signals: new Set() })
      expect(store.has(key)).toBe(true)
      expect(store.inflight.has(key)).toBe(true)

      store.clear()

      expect(store.has(key)).toBe(false)
      expect(store.inflight.has(key)).toBe(false)
    })
  })

  describe('defaultCacheKey', () => {
    it('derives stable keys from path/url/schema/transform', () => {
      expect(defaultCacheKey({ path: '/a', schema: 'x' }))
        .toEqual(defaultCacheKey({ schema: 'x', path: '/a' }))
    })

    it('ignores post-processing fields', () => {
      const a = defaultCacheKey({ path: '/a', schema: 'x', limit: 3 })
      const b = defaultCacheKey({ path: '/a', schema: 'x', limit: 99 })
      expect(a).toEqual(b)
    })
  })
})
