import { describe, it, expect, jest } from '@jest/globals'
import DataStore, { deriveCacheKey } from '../src/datastore.js'

describe('DataStore', () => {
  const config = { path: '/data/articles.json', schema: 'articles' }
  const key = deriveCacheKey(config)

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

  describe('subscribe(key, fn)', () => {
    const otherConfig = { path: '/data/other.json', schema: 'other' }
    const otherKey = deriveCacheKey(otherConfig)

    it('fires only when the matching key is set', () => {
      const store = new DataStore()
      const fn = jest.fn()
      store.subscribe(key, fn)

      store.set(otherKey, { data: [] })
      expect(fn).not.toHaveBeenCalled()

      store.set(key, { data: [1] })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('returns an unsubscribe function that removes only this listener', () => {
      const store = new DataStore()
      const a = jest.fn()
      const b = jest.fn()
      const unsubA = store.subscribe(key, a)
      store.subscribe(key, b)

      unsubA()
      store.set(key, { data: [1] })
      expect(a).not.toHaveBeenCalled()
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('fires both global and keyed listeners on a matching set', () => {
      const store = new DataStore()
      const all = jest.fn()
      const keyed = jest.fn()
      store.subscribe(all)
      store.subscribe(key, keyed)

      store.set(key, { data: [1] })
      expect(all).toHaveBeenCalledTimes(1)
      expect(keyed).toHaveBeenCalledTimes(1)
    })

    it('throws on bad signatures', () => {
      const store = new DataStore()
      expect(() => store.subscribe(42)).toThrow(TypeError)
      expect(() => store.subscribe('k', 'nope')).toThrow(TypeError)
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

  describe('deriveCacheKey', () => {
    it('derives stable keys from path/url/schema/transform', () => {
      expect(deriveCacheKey({ path: '/a', schema: 'x' }))
        .toEqual(deriveCacheKey({ schema: 'x', path: '/a' }))
    })

    it('ignores post-processing fields', () => {
      const a = deriveCacheKey({ path: '/a', schema: 'x', limit: 3 })
      const b = deriveCacheKey({ path: '/a', schema: 'x', limit: 99 })
      expect(a).toEqual(b)
    })
  })
})
