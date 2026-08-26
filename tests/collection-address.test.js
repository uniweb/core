import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveCollectionAddress,
  resolveRecordAddressPattern,
  _resetCollectionAddressWarnings,
} from '../src/collection-address.js'

const lane = { list: '/_data/{collection}', record: '/_data/{collection}/{param}' }

describe('resolving a collection to an address', () => {
  it('substitutes the collection name into the declared pattern', () => {
    expect(resolveCollectionAddress('articles', lane)).toBe('/_data/articles')
  })

  it('leaves {param} in place on a record pattern', () => {
    // The route param is not known here, and the framework already has one
    // place that resolves it. Two resolvers for one value is how they drift.
    expect(resolveRecordAddressPattern('articles', lane)).toBe('/_data/articles/{param}')
  })

  it('carries whatever segments the host put in the pattern', () => {
    // The point of a pattern over a base: a site id, a different root for
    // records, an absolute origin — none of it is the framework's business.
    expect(
      resolveCollectionAddress('news', { list: 'https://h.example/s/abc123/c/{collection}.json' })
    ).toBe('https://h.example/s/abc123/c/news.json')
  })

  it('encodes a name that would otherwise break the URL', () => {
    expect(resolveCollectionAddress('a b/c', lane)).toBe('/_data/a%20b%2Fc')
  })
})

describe('falling through to the artifact', () => {
  // Absence is not an error and not a decline — it is the answer for every site
  // with no backend, which is the default rather than a special case.
  it('returns null when no lane is declared', () => {
    expect(resolveCollectionAddress('articles', null)).toBeNull()
    expect(resolveCollectionAddress('articles', undefined)).toBeNull()
    expect(resolveCollectionAddress('articles', {})).toBeNull()
  })

  it('returns null when the lane declares the other half only', () => {
    expect(resolveCollectionAddress('articles', { record: '/x/{param}' })).toBeNull()
    expect(resolveRecordAddressPattern('articles', { list: '/x/{collection}' })).toBeNull()
  })

  it('returns null for a malformed declaration rather than throwing', () => {
    for (const bad of ['a string', [], 42, { list: '' }, { list: 123 }]) {
      expect(resolveCollectionAddress('articles', bad)).toBeNull()
    }
  })

  it('returns null for a missing collection name', () => {
    expect(resolveCollectionAddress('', lane)).toBeNull()
    expect(resolveCollectionAddress(null, lane)).toBeNull()
  })
})

describe('a pattern that would collapse every collection onto one address', () => {
  let warn
  beforeEach(() => {
    _resetCollectionAddressWarnings()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  // Without the placeholder check this substitutes nothing and returns the SAME
  // url for every collection — every schema reading the same records, 200 on
  // each request. Degrading to the artifact is at least correct.
  it('refuses a list pattern with no {collection}', () => {
    expect(resolveCollectionAddress('articles', { list: '/_data/all' })).toBeNull()
    expect(warn.mock.calls.map((c) => String(c[0])).join()).toContain('{collection}')
  })

  it('refuses a record pattern with no {param}', () => {
    expect(resolveRecordAddressPattern('articles', { record: '/_data/{collection}' })).toBeNull()
    expect(warn.mock.calls.map((c) => String(c[0])).join()).toContain('{param}')
  })

  it('warns once per bad pattern, not once per record', () => {
    resolveCollectionAddress('articles', { list: '/_data/all' })
    resolveCollectionAddress('news', { list: '/_data/all' })
    expect(warn.mock.calls).toHaveLength(1)
  })

  it('does not warn on a well-formed pattern', () => {
    // The control: a check that fired on everything would pass the assertions
    // above while making every lane unusable.
    resolveCollectionAddress('articles', lane)
    resolveRecordAddressPattern('articles', lane)
    expect(warn.mock.calls).toHaveLength(0)
  })
})
