/**
 * The record index — records held once, by identity, at the depth they were
 * fetched, and the cache key that keeps a
 * question door's list and record apart (F11).
 */
import { describe, it, expect, vi } from 'vitest'
import DataStore, { deriveCacheKey, recordIdentity } from '../src/datastore.js'

const brief = (uuid, extra = {}) => ({ $uuid: uuid, $name: uuid, title: `Title ${uuid}`, ...extra })
const full = (uuid, extra = {}) => ({ ...brief(uuid), body: `Body ${uuid}`, ...extra })

describe('recordIdentity', () => {
  it('is the $uuid, and nothing else', () => {
    expect(recordIdentity({ $uuid: 'a', slug: 'x' })).toBe('a')
    expect(recordIdentity({ slug: 'x', id: 7 })).toBeNull()
    expect(recordIdentity({ $uuid: '' })).toBeNull()
    expect(recordIdentity(null)).toBeNull()
  })
})

describe('R1 — an entry with a depth and identities is filed by id', () => {
  it('a brief list is indexed, and reads back as the same records', () => {
    const store = new DataStore()
    const list = [brief('a'), brief('b')]
    store.set('k-list', { data: list, meta: { depth: 'brief' } })
    expect(store.get('k-list').data).toEqual(list)
    expect(store.getRecord('a')).toEqual({ depth: 'brief', record: brief('a') })
    expect(store.getRecord('b').depth).toBe('brief')
  })

  it('a single full record is indexed and reads back as the record, not an array', () => {
    const store = new DataStore()
    store.set('k-rec', { data: full('a'), meta: { depth: 'full' } })
    expect(store.get('k-rec').data).toEqual(full('a'))
    expect(store.getRecord('a').depth).toBe('full')
  })

  it('an entry with NO depth is held inline and never indexed — the file lane as it was', () => {
    const store = new DataStore()
    const list = [brief('a'), { slug: 'no-identity' }]
    store.set('k', { data: list })
    expect(store.get('k')).toEqual({ data: list })
    expect(store.getRecord('a')).toBeNull()
  })

  it('a list where ANY record lacks identity is held inline whole — never half-indexed', () => {
    const store = new DataStore()
    const list = [brief('a'), { slug: 'no-identity' }]
    store.set('k', { data: list, meta: { depth: 'brief' } })
    expect(store.get('k').data).toEqual(list)
    expect(store.getRecord('a')).toBeNull()
  })

  it('an empty list stays an empty list, and meta survives', () => {
    const store = new DataStore()
    store.set('k', { data: [], meta: { depth: 'brief' } })
    expect(store.get('k')).toEqual({ data: [], meta: { depth: 'brief' } })
  })
})

describe('R2 — depth is monotonic', () => {
  it('a brief never overwrites a record held in full', () => {
    const store = new DataStore()
    store.set('k-rec', { data: full('a', { title: 'Full title' }), meta: { depth: 'full' } })
    store.set('k-list', { data: [brief('a', { title: 'Brief title' })], meta: { depth: 'brief' } })
    expect(store.getRecord('a').depth).toBe('full')
    expect(store.getRecord('a').record.title).toBe('Full title')
    expect(store.getRecord('a').record.body).toBe('Body a')
    // and the LIST reads the full record, not the brief it was written with
    expect(store.get('k-list').data[0]).toEqual(store.getRecord('a').record)
  })

  it('a fresher copy at the SAME depth replaces', () => {
    const store = new DataStore()
    store.set('k1', { data: [brief('a', { title: 'old' })], meta: { depth: 'brief' } })
    store.set('k2', { data: [brief('a', { title: 'new' })], meta: { depth: 'brief' } })
    expect(store.getRecord('a').record.title).toBe('new')
    expect(store.get('k1').data[0].title).toBe('new')
  })
})

describe('R3 — an upgrade merges, it does not replace', () => {
  it('the full record merges over the brief, so nothing depends on full ⊇ brief', () => {
    const store = new DataStore()
    store.set('k-list', { data: [brief('a', { cardOnly: 'kept' })], meta: { depth: 'brief' } })
    store.set('k-rec', { data: { $uuid: 'a', body: 'Body a', title: 'Full title' }, meta: { depth: 'full' } })
    const held = store.getRecord('a')
    expect(held.depth).toBe('full')
    expect(held.record).toEqual({ $uuid: 'a', $name: 'a', cardOnly: 'kept', title: 'Full title', body: 'Body a' })
  })

  it('every list holding the record sees the upgrade on its next read', () => {
    const store = new DataStore()
    store.set('k-list', { data: [brief('a'), brief('b')], meta: { depth: 'brief' } })
    const before = store.get('k-list').data
    expect(before[0].body).toBeUndefined()
    store.set('k-rec', { data: full('a'), meta: { depth: 'full' } })
    const after = store.get('k-list').data
    expect(after[0].body).toBe('Body a')
    expect(after[1]).toEqual(brief('b'))
    // materialization is cached between index writes
    expect(store.get('k-list')).toBe(store.get('k-list'))
  })
})

describe('the rest of the store is unchanged by the index', () => {
  it('set fires keyed and global listeners for an indexed entry', () => {
    const store = new DataStore()
    const all = vi.fn()
    const keyed = vi.fn()
    store.subscribe(all)
    store.subscribe('k', keyed)
    store.set('k', { data: [brief('a')], meta: { depth: 'brief' } })
    expect(all).toHaveBeenCalledTimes(1)
    expect(keyed).toHaveBeenCalledTimes(1)
  })

  it('clear drops the index too', () => {
    const store = new DataStore()
    store.set('k', { data: [brief('a')], meta: { depth: 'brief' } })
    store.clear()
    expect(store.getRecord('a')).toBeNull()
    expect(store.get('k')).toBeNull()
  })

  it('delete drops the entry and leaves shared records for the others', () => {
    const store = new DataStore()
    store.set('k1', { data: [brief('a')], meta: { depth: 'brief' } })
    store.set('k2', { data: [brief('a')], meta: { depth: 'brief' } })
    store.delete('k1')
    expect(store.get('k1')).toBeNull()
    expect(store.get('k2').data).toEqual([brief('a')])
  })
})

describe('deriveCacheKey — two identities (F11)', () => {
  it('an ADDRESSED request is identified by its address — query and depth do not split it', () => {
    const page = deriveCacheKey({ query: 'articles', path: '/data/articles.json', as: 'articles', depth: 'full' })
    const hook = deriveCacheKey({ path: '/data/articles.json', as: 'articles' })
    // a kit hook asking for { path, as } hits the entry the page's declaration filled
    expect(hook).toBe(page)
  })

  it('an ADDRESS-LESS request — a question — is identified by the question', () => {
    const list = deriveCacheKey({ query: 'articles', as: 'articles', depth: 'brief' })
    const record = deriveCacheKey({ query: 'articles', as: 'articles', depth: 'full', where: { $name: 'ada' } })
    const other = deriveCacheKey({ query: 'news', as: 'articles', depth: 'brief' })
    expect(list).not.toBe(record)
    expect(list).not.toBe(other)
  })

  it('two pages binding one `as` to two queries on a door do not share an entry', () => {
    const a = deriveCacheKey({ query: 'articles', as: 'posts', depth: 'brief' })
    const b = deriveCacheKey({ query: 'news', as: 'posts', depth: 'brief' })
    expect(a).not.toBe(b)
  })

  it('locale splits an entry on both identities', () => {
    expect(deriveCacheKey({ endpoint: '/_records/x', as: 'x', locale: 'fr' }))
      .not.toBe(deriveCacheKey({ endpoint: '/_records/x', as: 'x' }))
    expect(deriveCacheKey({ query: 'x', as: 'x', depth: 'brief', locale: 'fr' }))
      .not.toBe(deriveCacheKey({ query: 'x', as: 'x', depth: 'brief' }))
  })

  it('CONTROL — the addressed key is stable across field order and ignores post-processing', () => {
    expect(deriveCacheKey({ path: '/a', as: 'x', limit: 3 })).toBe(deriveCacheKey({ as: 'x', path: '/a' }))
  })
})
