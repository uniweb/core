/**
 * The surface a LIVE-PINNED consumer reads off `resolveFetchConfigs`.
 *
 * A consumer that bundles this package by workspace link gets a rename at commit
 * time, with no version to pin against — so the names below are pinned HERE,
 * where the change happens, and the assertion message says who to tell.
 *
 * History, because it is why this file exists: the field was renamed once
 * (`collection` → `query`) and a consumer's resolved address silently became
 * `undefined` — no error, no records, a page that rendered nothing. And on
 * 2026-09-04 the surface moved again, by ruling: the ADDRESS door (`endpoint`,
 * composed from `config.records.list` / `.record`) was retired, and the one live
 * shape is the QUESTION door — `door`, `schema`, `detail: true`.
 */

import { describe, it, expect } from 'vitest'
import { resolveFetchConfigs, isFetchRefinement } from '../src/fetch-config.js'

const WHO =
  'A live-pinned consumer reads this name. See ' +
  'framework/_contracts/live-pinned-consumers.json for who, and say "live now" — ' +
  'they bundle the clone, so this is already broken for them at commit time.'

// A records lane exactly as a host stamps it onto the payload — the door, plus the
// two retired address patterns a host may still stamp and this resolver ignores.
const RECORDS = {
  query: '/_records/_query/{locale}',
  list: '/_records/{path}',
  record: '/_records/{path}/{param}',
}
const QUERIES = { members: { schema: '@std/person' } }
const LOCALE = { locale: 'en', defaultLocale: 'en' }

const authored = (extra) => [{ path: '/data/members.json', as: 'members', ...extra }]

describe('resolveFetchConfigs — the live-pinned surface', () => {
  it('the OPTIONS are `records` and `queries`, and together they turn a query into a door question', () => {
    const [cfg] = [...resolveFetchConfigs(authored({ query: 'members' }), { records: RECORDS, queries: QUERIES, ...LOCALE }).values()]
    expect(cfg.door, WHO).toBe('/_records/_query/en')
    expect(cfg.schema, WHO).toBe('@std/person')
  })

  it('the FIELD is `cfg.query` — the one that broke a consumer on 2026-08-29', () => {
    const withField = resolveFetchConfigs(authored({ query: 'members' }), { records: RECORDS, queries: QUERIES, ...LOCALE })
    const withoutField = resolveFetchConfigs(authored({ collection: 'members' }), { records: RECORDS, queries: QUERIES, ...LOCALE })
    expect([...withField.values()][0].door, WHO).toBe('/_records/_query/en')
    expect([...withoutField.values()][0].door).toBeUndefined()
  })

  it('the retired FIELD `collection:` resolves nothing — silently, which is why it is pinned', () => {
    const [cfg] = [...resolveFetchConfigs(authored({ collection: 'members' }), { records: RECORDS, queries: QUERIES, ...LOCALE }).values()]
    expect(cfg.door).toBeUndefined()
    expect(cfg.path).toBe('/data/members.json')
  })

  it('the RETURN keys are `door`, `schema`, `detail` and `depth` — and `path` is dropped once the door answers', () => {
    const [cfg] = [...resolveFetchConfigs(authored({ query: 'members' }), { records: RECORDS, queries: QUERIES, ...LOCALE }).values()]
    expect(Object.keys(cfg), WHO).toEqual(expect.arrayContaining(['door', 'schema', 'detail', 'depth', 'locale']))
    expect(cfg.path).toBeUndefined()
    // ⛔ and never `endpoint`: the address door is gone
    expect(cfg).not.toHaveProperty('endpoint')
  })

  it('⛔ the retired address patterns alone declare NO lane — the compiled file answers', () => {
    const [cfg] = [...resolveFetchConfigs(authored({ query: 'members' }), { records: { list: RECORDS.list, record: RECORDS.record }, queries: QUERIES, ...LOCALE }).values()]
    expect(cfg.door).toBeUndefined()
    expect(cfg).not.toHaveProperty('endpoint')
    expect(cfg.path).toBe('/data/members.json')
  })

  it('`isFetchRefinement` is still exported under that name', () => {
    expect(typeof isFetchRefinement, WHO).toBe('function')
  })
})
