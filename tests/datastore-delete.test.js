import { describe, it, expect, vi } from 'vitest'
import DataStore, { deriveCacheKey } from '../src/datastore.js'

describe('DataStore.delete', () => {
  const key = deriveCacheKey({ endpoint: 'api:viewer-1:/records', as: 'courses' })
  const other = deriveCacheKey({ path: '/data/articles.json', as: 'articles' })

  it('removes one entry and leaves the rest warm', () => {
    const store = new DataStore()
    store.set(key, { data: [1] })
    store.set(other, { data: [2] })

    expect(store.delete(key)).toBe(true)
    expect(store.has(key)).toBe(false)
    expect(store.get(other)).toEqual({ data: [2] })
  })

  it('is a no-op on a key it never held, and wakes nobody', () => {
    const store = new DataStore()
    const fn = vi.fn()
    store.subscribe(key, fn)

    expect(store.delete(key)).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it("wakes the key's subscribers, who then read null", () => {
    const store = new DataStore()
    store.set(key, { data: [1] })
    const seen = []
    store.subscribe(key, () => seen.push(store.get(key)))

    store.delete(key)
    expect(seen).toEqual([null])
  })

  it('wakes global subscribers too, like a write does', () => {
    const store = new DataStore()
    store.set(key, { data: [1] })
    const fn = vi.fn()
    store.subscribe(fn)

    store.delete(key)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('forgets an in-flight record for the key', () => {
    const store = new DataStore()
    store.inflight.set(key, { promise: Promise.resolve(), signals: new Set() })
    store.set(key, { data: [] })

    store.delete(key)
    expect(store.inflight.has(key)).toBe(false)
  })
})
