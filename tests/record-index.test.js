/**
 * The record index — records held once, by identity, at the depth they were
 * fetched, and the cache key that keeps a
 * question door's list and record apart (F11).
 */
import { describe, it, expect, vi } from 'vitest'
import DataStore, { deriveCacheKey, recordIdentity } from '../src/datastore.js'
import FetcherDispatcher from '../src/fetcher-dispatcher.js'

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
    store.set('k-list', { data: list, meta: { whole: false } })
    expect(store.get('k-list').data).toEqual(list)
    expect(store.getRecord('a')).toEqual({ whole: false, record: brief('a') })
    expect(store.getRecord('b').whole).toBe(false)
  })

  it('a single full record is indexed and reads back as the record, not an array', () => {
    const store = new DataStore()
    store.set('k-rec', { data: full('a'), meta: { whole: true } })
    expect(store.get('k-rec').data).toEqual(full('a'))
    expect(store.getRecord('a').whole).toBe(true)
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
    store.set('k', { data: list, meta: { whole: false } })
    expect(store.get('k').data).toEqual(list)
    expect(store.getRecord('a')).toBeNull()
  })

  it('an empty list stays an empty list, and meta survives', () => {
    const store = new DataStore()
    store.set('k', { data: [], meta: { whole: false } })
    expect(store.get('k')).toEqual({ data: [], meta: { whole: false } })
  })
})

// ⭐ R2 — a record's brief and its whole record are held APART (ruled 2026-09-27 [Diego]): two
// shapes — a brief's fields at the top, a whole record's sections at the top — so neither is
// merged over the other, and each is replaced only by a fresher copy of its own kind.
// ⛔ Until then a whole record merged over the brief (R3) and every list showed the merge.
const stored = (uuid, extra = {}) => ({ $uuid: uuid, $name: uuid, brief: { title: `Title ${uuid}` }, body: { content: `Body ${uuid}` }, ...extra })

describe('R2 — a brief and a whole record are held apart', () => {
  it('a list of briefs stays briefs when its record is fetched whole', () => {
    const store = new DataStore()
    store.set('k-list', { data: [brief('a'), brief('b')], meta: { whole: false } })
    store.set('k-rec', { data: stored('a'), meta: { whole: true } })
    expect(store.get('k-list').data).toEqual([brief('a'), brief('b')])
    expect(store.get('k-rec').data).toEqual(stored('a'))
  })

  it('the index answers "do I hold this whole?" with the whole record, and a brief only when that is all it holds', () => {
    const store = new DataStore()
    store.set('k-list', { data: [brief('a'), brief('b')], meta: { whole: false } })
    store.set('k-rec', { data: stored('a'), meta: { whole: true } })
    expect(store.getRecord('a')).toEqual({ whole: true, record: stored('a') })
    expect(store.getRecord('b')).toEqual({ whole: false, record: brief('b') })
  })

  it('a brief arriving after the whole record replaces neither the whole nor itself with a merge', () => {
    const store = new DataStore()
    store.set('k-rec', { data: stored('a'), meta: { whole: true } })
    store.set('k-list', { data: [brief('a', { title: 'Brief title' })], meta: { whole: false } })
    expect(store.get('k-list').data[0]).toEqual(brief('a', { title: 'Brief title' }))
    expect(store.getRecord('a').record).toEqual(stored('a'))
  })

  it('a fresher copy of the SAME kind replaces, and every entry holding it reads it', () => {
    const store = new DataStore()
    store.set('k1', { data: [brief('a', { title: 'old' })], meta: { whole: false } })
    store.set('k2', { data: [brief('a', { title: 'new' })], meta: { whole: false } })
    expect(store.getRecord('a').record.title).toBe('new')
    expect(store.get('k1').data[0].title).toBe('new')
    // materialization is cached between index writes
    expect(store.get('k1')).toBe(store.get('k1'))
  })

  it('a list FETCHED after its record was held whole delivers its briefs', async () => {
    const dataStore = new DataStore()
    const answers = {
      rec: { data: stored('a'), meta: { whole: true } },
      list: { data: [brief('a'), brief('b')], meta: { whole: false } },
    }
    const defaultFetcher = { resolve: (req) => Promise.resolve(answers[req.as]) }
    const dispatcher = new FetcherDispatcher({ foundation: null, dataStore, defaultFetcher })
    await dispatcher.dispatch({ url: 'https://h.example/rec', as: 'rec' })
    const list = await dispatcher.dispatch({ url: 'https://h.example/list', as: 'list' })
    expect(list.data).toEqual([brief('a'), brief('b')])
    expect(list.meta).toEqual({ whole: false })
  })
})

describe('the rest of the store is unchanged by the index', () => {
  it('set fires keyed and global listeners for an indexed entry', () => {
    const store = new DataStore()
    const all = vi.fn()
    const keyed = vi.fn()
    store.subscribe(all)
    store.subscribe('k', keyed)
    store.set('k', { data: [brief('a')], meta: { whole: false } })
    expect(all).toHaveBeenCalledTimes(1)
    expect(keyed).toHaveBeenCalledTimes(1)
  })

  it('clear drops the index too', () => {
    const store = new DataStore()
    store.set('k', { data: [brief('a')], meta: { whole: false } })
    store.clear()
    expect(store.getRecord('a')).toBeNull()
    expect(store.get('k')).toBeNull()
  })

  it('delete drops the entry and leaves shared records for the others', () => {
    const store = new DataStore()
    store.set('k1', { data: [brief('a')], meta: { whole: false } })
    store.set('k2', { data: [brief('a')], meta: { whole: false } })
    store.delete('k1')
    expect(store.get('k1')).toBeNull()
    expect(store.get('k2').data).toEqual([brief('a')])
  })
})

describe('deriveCacheKey — two identities (F11)', () => {
  it('an ADDRESSED request is identified by its address — query and depth do not split it', () => {
    const page = deriveCacheKey({ query: 'articles', path: '/data/articles.json', as: 'articles', whole: true })
    const hook = deriveCacheKey({ path: '/data/articles.json', as: 'articles' })
    // a kit hook asking for { path, as } hits the entry the page's declaration filled
    expect(hook).toBe(page)
  })

  it('an ADDRESS-LESS request — a question — is identified by the question', () => {
    const list = deriveCacheKey({ query: 'articles', as: 'articles', whole: false })
    const record = deriveCacheKey({ query: 'articles', as: 'articles', whole: true, where: { $name: 'ada' } })
    const other = deriveCacheKey({ query: 'news', as: 'articles', whole: false })
    expect(list).not.toBe(record)
    expect(list).not.toBe(other)
  })

  it('two pages binding one `as` to two queries on a door do not share an entry', () => {
    const a = deriveCacheKey({ query: 'articles', as: 'posts', whole: false })
    const b = deriveCacheKey({ query: 'news', as: 'posts', whole: false })
    expect(a).not.toBe(b)
  })

  it('locale splits an entry on both identities', () => {
    expect(deriveCacheKey({ url: 'https://h.example/x', as: 'x', locale: 'fr' }))
      .not.toBe(deriveCacheKey({ url: 'https://h.example/x', as: 'x' }))
    expect(deriveCacheKey({ query: 'x', as: 'x', whole: false, locale: 'fr' }))
      .not.toBe(deriveCacheKey({ query: 'x', as: 'x', whole: false }))
  })

  it('CONTROL — the addressed key is stable across field order, and a view is part of it', () => {
    expect(deriveCacheKey({ path: '/a', as: 'x' })).toBe(deriveCacheKey({ as: 'x', path: '/a' }))
    expect(deriveCacheKey({ path: '/a', as: 'x', limit: 3 })).not.toBe(deriveCacheKey({ as: 'x', path: '/a' }))
  })

  it('`narrow` is part of both identities, in one field order — and an empty one is none (2026-09-14)', () => {
    const set = { query: 'articles', as: 'articles', schema: '@std/article', limit: 100 }
    expect(deriveCacheKey({ ...set, narrow: { limit: 3 } })).not.toBe(deriveCacheKey(set))
    expect(deriveCacheKey({ ...set, narrow: { where: { tags: 'x' }, limit: 3 } }))
      .toBe(deriveCacheKey({ ...set, narrow: { limit: 3, where: { tags: 'x' } } }))
    expect(deriveCacheKey({ ...set, narrow: {} })).toBe(deriveCacheKey(set))
    // two records of one set are two entries
    expect(deriveCacheKey({ ...set, narrow: { match: { $name: 'a' } } }))
      .not.toBe(deriveCacheKey({ ...set, narrow: { match: { $name: 'b' } } }))
    const file = { path: '/data/articles.json', as: 'articles' }
    expect(deriveCacheKey({ ...file, narrow: { limit: 3 } })).not.toBe(deriveCacheKey(file))
    // ⭐ a fetch's count is not the query's: the same number at the other level is another question
    expect(deriveCacheKey({ ...file, limit: 3 })).not.toBe(deriveCacheKey({ ...file, narrow: { limit: 3 } }))
  })
})
