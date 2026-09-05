/**
 * The QUESTION door — a host that answers a query instead of serving a path
 * (the records door's contract). ⚠️ Nothing here is live: no host stamps
 * the door yet, and the stamp key this client reads (`config.records.query`) is
 * provisional. These pin what framework will SEND and how it degrades, so the
 * client can go live by a stamp alone.
 */
import { describe, it, expect } from 'vitest'
import { resolveFetchConfigs } from '../src/fetch-config.js'
import { buildDetailConfig, ROUTE_HANDLE_KEY } from '../src/detail-url.js'
import { resolveQueryDoor, _resetQueryAddressWarnings } from '../src/query-address.js'
import { deriveCacheKey } from '../src/datastore.js'

const LANE = { list: '/_records/{path}', record: '/_records/{path}/{param}', query: '/_records/ask/{locale}' }
const QUERIES = { members: { name: 'members', schema: '@std/person', sort: 'name', where: { published: true } } }
const authored = (extra = {}) => [{ query: 'members', path: '/data/members.json', as: 'members', ...extra }]
const opts = (extra = {}) => ({ records: LANE, queries: QUERIES, locale: 'en', defaultLocale: 'en', ...extra })

describe('resolveQueryDoor — the stamp, and the locale as a route segment', () => {
  it('substitutes the locale into the door pattern', () => {
    expect(resolveQueryDoor(LANE, 'fr')).toBe('/_records/ask/fr')
  })

  it('is null with no door stamped, or no locale to name', () => {
    expect(resolveQueryDoor({ list: '/_records/{path}' }, 'en')).toBeNull()
    expect(resolveQueryDoor(LANE, null)).toBeNull()
    expect(resolveQueryDoor(null, 'en')).toBeNull()
  })

  it('refuses a door pattern with no {locale} slot — the locale cannot be omitted there', () => {
    _resetQueryAddressWarnings()
    const warn = []
    const orig = console.warn
    console.warn = (m) => warn.push(String(m))
    try {
      expect(resolveQueryDoor({ query: '/_records/ask' }, 'en')).toBeNull()
    } finally { console.warn = orig }
    expect(warn.some((m) => m.includes('{locale}'))).toBe(true)
  })
})

describe('a query resolves to the door when the host stamps one AND the payload carries the Model ref', () => {
  it('composes the whole question: door, schema, the saved query\'s narrowing, depth, locale', () => {
    const cfg = resolveFetchConfigs(authored({ limit: 5 }), opts()).get('members')
    expect(cfg.door).toBe('/_records/ask/en')
    expect(cfg.schema).toBe('@std/person')
    expect(cfg.where).toEqual({ published: true })
    expect(cfg.sort).toBe('name')
    expect(cfg.limit).toBe(5)
    expect(cfg.depth).toBe('brief')
    expect(cfg.locale).toBe('en')
    expect(cfg.detail).toBe(true)
    expect(cfg.path).toBeUndefined()
    expect(cfg.endpoint).toBeUndefined()
  })

  it('the fetch\'s own narrowing wins over the saved query\'s', () => {
    const cfg = resolveFetchConfigs(authored({ where: { featured: true }, sort: 'date desc' }), opts()).get('members')
    expect(cfg.where).toEqual({ featured: true })
    expect(cfg.sort).toBe('date desc')
  })

  it('⛔ a stamped door with no Model ref for the query is a door config with `schema: null` — loud downstream, never a fallthrough', () => {
    // Until 2026-09-04 this fell back to the ADDRESS door. That lane is gone by
    // ruling; a payload that stamps a door and carries no `config.queries` entry
    // is a producer defect, and the fetcher says so per key without a request.
    const cfg = resolveFetchConfigs(authored(), opts({ queries: null })).get('members')
    expect(cfg.door).toBe('/_records/ask/en')
    expect(cfg.schema).toBeNull()
    expect(cfg.path).toBeUndefined()
    expect(cfg).not.toHaveProperty('endpoint')
  })

  it('falls back to the compiled file when no lane is declared at all — CONTROL', () => {
    const cfg = resolveFetchConfigs(authored(), { queries: QUERIES }).get('members')
    expect(cfg.door).toBeUndefined()
    expect(cfg.path).toBe('/data/members.json')
  })

  it('a door config is keyed by the QUESTION, and two locales never share an entry', () => {
    const en = resolveFetchConfigs(authored(), opts()).get('members')
    const fr = resolveFetchConfigs(authored(), opts({ locale: 'fr' })).get('members')
    expect(deriveCacheKey(en)).not.toBe(deriveCacheKey(fr))
    const other = resolveFetchConfigs([{ query: 'members', as: 'members', where: { x: 1 } }], opts()).get('members')
    expect(deriveCacheKey(en)).not.toBe(deriveCacheKey(other))
  })

  it('a door config keeps scope as the door\'s own field — no fold into where', () => {
    const cfg = resolveFetchConfigs(authored({ scope: 'research' }), opts()).get('members')
    expect(cfg.scope).toBe('research')
    expect(cfg.where).toEqual({ published: true })
  })
})

describe('the record on a door is the same question, narrowed by the handle, in full', () => {
  it('binds the route param under the handle key beside the authored where, drops sort and limit', () => {
    const list = resolveFetchConfigs(authored({ limit: 5 }), opts()).get('members')
    const rec = buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' })
    expect(rec.door).toBe('/_records/ask/en')
    expect(rec.schema).toBe('@std/person')
    expect(rec.where).toEqual({ published: true, [ROUTE_HANDLE_KEY]: 'ada' })
    expect(rec.depth).toBe('full')
    expect(rec.dynamicContext).toEqual({ paramName: 'slug', paramValue: 'ada' })
    expect(rec.sort).toBeUndefined()
    expect(rec.limit).toBeUndefined()
    expect(rec.as).toBe('members')
    expect(rec.locale).toBe('en')
    // and it has its own key — list (brief) and record (full) never collide
    expect(deriveCacheKey(rec)).not.toBe(deriveCacheKey(list))
  })

  it('the handle key is ONE constant — the spelling moved four times in a day', () => {
    expect(ROUTE_HANDLE_KEY).toBe('$name')
  })
})
