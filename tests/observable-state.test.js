import { describe, it, expect, jest } from '@jest/globals'
import ObservableState from '../src/observable-state.js'

describe('ObservableState', () => {
  describe('get / set / has / delete', () => {
    it('returns undefined for missing keys', () => {
      const s = new ObservableState()
      expect(s.get('x')).toBeUndefined()
      expect(s.has('x')).toBe(false)
    })

    it('stores and retrieves values', () => {
      const s = new ObservableState()
      s.set('slug', 'tenured-biology')
      expect(s.get('slug')).toBe('tenured-biology')
      expect(s.has('slug')).toBe(true)
    })

    it('delete removes a key and returns true on removal', () => {
      const s = new ObservableState()
      s.set('slug', 'X')
      expect(s.delete('slug')).toBe(true)
      expect(s.has('slug')).toBe(false)
    })

    it('delete returns false when the key was missing', () => {
      const s = new ObservableState()
      expect(s.delete('unset')).toBe(false)
    })
  })

  describe('subscribe(fn) — all-keys listener', () => {
    it('fires on any key change', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.subscribe(fn)

      s.set('a', 1)
      s.set('b', 2)

      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('unsubscribe stops notifications', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      const off = s.subscribe(fn)

      off()
      s.set('a', 1)

      expect(fn).not.toHaveBeenCalled()
    })

    it('does not fire when the value is unchanged (===)', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.set('a', 1)
      s.subscribe(fn)

      s.set('a', 1)
      expect(fn).not.toHaveBeenCalled()
    })

    it('delete fires listeners only when a key existed', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.subscribe(fn)

      s.delete('unset')
      expect(fn).not.toHaveBeenCalled()

      s.set('a', 1)
      s.delete('a')
      expect(fn).toHaveBeenCalledTimes(2) // one for set, one for delete
    })
  })

  describe('subscribe(key, fn) — keyed listener', () => {
    it('fires only when that key changes', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.subscribe('slug', fn)

      s.set('other', 1) // different key
      expect(fn).not.toHaveBeenCalled()

      s.set('slug', 'X')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('unsubscribe stops notifications for that key', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      const off = s.subscribe('slug', fn)

      off()
      s.set('slug', 'X')
      expect(fn).not.toHaveBeenCalled()
    })

    it('keyed and all-keys listeners coexist', () => {
      const s = new ObservableState()
      const keyFn = jest.fn()
      const anyFn = jest.fn()
      s.subscribe('slug', keyFn)
      s.subscribe(anyFn)

      s.set('slug', 'X')
      expect(keyFn).toHaveBeenCalledTimes(1)
      expect(anyFn).toHaveBeenCalledTimes(1)

      s.set('other', 1)
      expect(keyFn).toHaveBeenCalledTimes(1)
      expect(anyFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('snapshot', () => {
    it('returns a shallow copy of live values', () => {
      const s = new ObservableState()
      s.set('a', 1)
      s.set('b', { nested: true })
      const snap = s.snapshot()
      expect(snap).toEqual({ a: 1, b: { nested: true } })

      // Mutating the snapshot doesn't affect the store.
      snap.a = 999
      expect(s.get('a')).toBe(1)
    })
  })
})
