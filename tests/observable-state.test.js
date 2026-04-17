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

  describe('subscribe(key, fn)', () => {
    it('fires only when that key changes', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.subscribe('slug', fn)

      s.set('other', 1)
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

    it('does not fire when the value is unchanged (===)', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.set('a', 1)
      s.subscribe('a', fn)

      s.set('a', 1)
      expect(fn).not.toHaveBeenCalled()
    })

    it('delete fires listeners only when a key existed', () => {
      const s = new ObservableState()
      const fn = jest.fn()
      s.subscribe('a', fn)

      s.delete('unset')
      expect(fn).not.toHaveBeenCalled()

      s.set('a', 1)
      s.delete('a')
      expect(fn).toHaveBeenCalledTimes(2) // one for set, one for delete
    })

    it('supports multiple listeners on the same key', () => {
      const s = new ObservableState()
      const a = jest.fn()
      const b = jest.fn()
      s.subscribe('k', a)
      s.subscribe('k', b)

      s.set('k', 1)
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })
})
