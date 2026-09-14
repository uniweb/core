/**
 * The QUESTION door — a host that answers a query instead of serving a path
 * (the records contract). ⚠️ Nothing here is live: no host stamps
 * the service yet, and the stamp key this client reads (`config.services.records`) is
 * provisional. These pin what framework will SEND and how it degrades, so the
 * client can go live by a stamp alone.
 */
import { describe, it, expect } from 'vitest'
import { resolveFetchConfigs } from '../src/fetch-config.js'
import { buildDetailConfig, ROUTE_HANDLE_KEY } from '../src/detail-url.js'
import { resolveRecordsService, _resetRecordsServiceWarnings } from '../src/records-service.js'
import { deriveCacheKey } from '../src/datastore.js'

const SERVICES = { records: '/_records/ask/{locale}' }
const QUERIES = { members: { name: 'members', schema: '@std/person', sort: 'name', where: { published: true } } }
const authored = (extra = {}) => [{ query: 'members', path: '/data/members.json', as: 'members', ...extra }]
const opts = (extra = {}) => ({ services: SERVICES, queries: QUERIES, locale: 'en', defaultLocale: 'en', ...extra })

describe('resolveRecordsService — the stamp, and the locale as a route segment', () => {
  it('substitutes the locale into the endpoint', () => {
    expect(resolveRecordsService(SERVICES, 'fr')).toBe('/_records/ask/fr')
  })

  it('is null with no records row stamped, or no locale to name', () => {
    expect(resolveRecordsService({ list: '/_records/{path}' }, 'en')).toBeNull()
    expect(resolveRecordsService(SERVICES, null)).toBeNull()
    expect(resolveRecordsService(null, 'en')).toBeNull()
  })

  it('refuses an endpoint with no {locale} slot — the locale cannot be omitted there', () => {
    _resetRecordsServiceWarnings()
    const warn = []
    const orig = console.warn
    console.warn = (m) => warn.push(String(m))
    try {
      expect(resolveRecordsService({ records: '/_records/ask' }, 'en')).toBeNull()
    } finally { console.warn = orig }
    expect(warn.some((m) => m.includes('{locale}'))).toBe(true)
  })
})

describe('a query resolves to the service when the host offers one AND the payload carries the Model ref', () => {
  it('composes the whole question: door, schema, the query as saved, the fetch\'s narrow, depth, locale', () => {
    const queries = { members: { ...QUERIES.members, limit: 100 } }
    const cfg = resolveFetchConfigs(authored({ limit: 5 }), opts({ queries })).get('members')
    expect(cfg.ask).toBe('/_records/ask/en')
    expect(cfg.schema).toBe('@std/person')
    // the top level is the query as saved — the set, its `limit` included
    expect(cfg.where).toEqual({ published: true })
    expect(cfg.sort).toBe('name')
    expect(cfg.limit).toBe(100)
    // the fetch's count is its narrowing of the set
    expect(cfg.narrow).toEqual({ limit: 5 })
    expect(cfg.whole).toBe(false)
    expect(cfg.locale).toBe('en')
    expect(cfg.detail).toBe(true)
    expect(cfg.path).toBeUndefined()
    expect(cfg.endpoint).toBeUndefined()
  })

  it('a fetch\'s where, sort and limit are its `narrow` — the query\'s stay as saved (ruled 2026-09-14)', () => {
    // ⛔ The fetch's where REPLACED the query's until 2026-09-13, so a page could ask the
    // service for records the query leaves out; until 2026-09-14 it joined the query's with
    // `and` and its sort and limit replaced the query's, in one flat question.
    const cfg = resolveFetchConfigs(authored({ where: { featured: true }, sort: 'date desc', limit: 3 }), opts()).get('members')
    expect(cfg.where).toEqual({ published: true })
    expect(cfg.sort).toBe('name')
    expect(cfg).not.toHaveProperty('limit')
    expect(cfg.narrow).toEqual({ where: { featured: true }, sort: 'date desc', limit: 3 })
  })

  it('a fetch that takes the whole set carries no `narrow`', () => {
    expect(resolveFetchConfigs(authored(), opts()).get('members')).not.toHaveProperty('narrow')
    // an empty where, or a count of 0, narrows nothing
    expect(resolveFetchConfigs(authored({ where: {}, limit: 0 }), opts()).get('members')).not.toHaveProperty('narrow')
  })

  it('⛔ a stamped service with no Model ref for the query is an asked config with `schema: null` — loud downstream, never a fallthrough', () => {
    // Until 2026-09-04 this fell back to the retired GET lane. That lane is gone by
    // ruling; a payload that offers the service and carries no `config.queries` entry
    // is a producer defect, and the fetcher says so per key without a request.
    const cfg = resolveFetchConfigs(authored(), opts({ queries: null })).get('members')
    expect(cfg.ask).toBe('/_records/ask/en')
    expect(cfg.schema).toBeNull()
    expect(cfg.path).toBeUndefined()
    expect(cfg).not.toHaveProperty('endpoint')
  })

  it('falls back to the compiled file when no lane is declared at all — CONTROL', () => {
    const cfg = resolveFetchConfigs(authored(), { queries: QUERIES }).get('members')
    expect(cfg.ask).toBeUndefined()
    expect(cfg.path).toBe('/data/members.json')
  })

  it('an asked config is keyed by the QUESTION, and two locales never share an entry', () => {
    const en = resolveFetchConfigs(authored(), opts()).get('members')
    const fr = resolveFetchConfigs(authored(), opts({ locale: 'fr' })).get('members')
    expect(deriveCacheKey(en)).not.toBe(deriveCacheKey(fr))
    const other = resolveFetchConfigs([{ query: 'members', as: 'members', where: { x: 1 } }], opts()).get('members')
    expect(deriveCacheKey(en)).not.toBe(deriveCacheKey(other))
  })

  it('an asked config keeps scope as the door\'s own field — no fold into where', () => {
    const queries = { members: { ...QUERIES.members, scope: 'research' } }
    const cfg = resolveFetchConfigs(authored(), opts({ queries })).get('members')
    expect(cfg.scope).toBe('research')
    expect(cfg.where).toEqual({ published: true })
  })

  it('⛔ a binding\'s own scope is not asked — scope is the query\'s (ruled 2026-09-13)', () => {
    const queries = { members: { ...QUERIES.members, scope: 'research' } }
    expect(resolveFetchConfigs(authored({ scope: 'teaching' }), opts({ queries })).get('members').scope).toBe('research')
    expect(resolveFetchConfigs(authored({ scope: 'teaching' }), opts()).get('members')).not.toHaveProperty('scope')
  })
})

describe('the record on the service is the query\'s set, narrowed by the handle, in full', () => {
  it('asks the route query as saved plus `narrow.match` — its where, sort and limit kept, so the answer checks the set', () => {
    const queries = { members: { ...QUERIES.members, limit: 100 } }
    const list = resolveFetchConfigs(authored({ limit: 5 }), opts({ queries })).get('members')
    const rec = buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' })
    expect(rec.ask).toBe('/_records/ask/en')
    expect(rec.schema).toBe('@std/person')
    // ⭐ `where` is the author's and `match` the visitor's (ruled 2026-09-11) —
    // the handle was merged into `where` until then, replacing a condition there
    expect(rec.where).toEqual({ published: true })
    // ⭐ the query's `sort` and `limit` define its set, so the record question carries
    // them (ruled 2026-09-14) — it dropped both until then, and a record outside the
    // 100 had a page
    expect(rec.sort).toBe('name')
    expect(rec.limit).toBe(100)
    expect(rec.narrow).toEqual({ match: { [ROUTE_HANDLE_KEY]: 'ada' } })
    expect(rec).not.toHaveProperty('match')
    expect(rec.whole).toBe(true)
    expect(rec.dynamicContext).toEqual({ paramName: 'slug', paramValue: 'ada' })
    expect(rec.as).toBe('members')
    expect(rec.locale).toBe('en')
    // and it has its own key — list (brief) and record (full) never collide
    expect(deriveCacheKey(rec)).not.toBe(deriveCacheKey(list))
  })

  it('the handle key is ONE constant — the spelling moved four times in a day', () => {
    expect(ROUTE_HANDLE_KEY).toBe('$name')
  })

  it('the folder name picks the key — [slug] the handle, [uuid] the identity, any other the field', () => {
    const list = resolveFetchConfigs(authored({}), opts()).get('members')
    expect(buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' }).narrow.match).toEqual({ $name: 'ada' })
    expect(buildDetailConfig(list, { paramName: 'uuid', paramValue: '019e' }).narrow.match).toEqual({ $uuid: '019e' })
    expect(buildDetailConfig(list, { paramName: 'id', paramValue: 42 }).narrow.match).toEqual({ id: '42' })
  })

  it('a condition the query puts on the same key stays — the URL cannot replace it', () => {
    const queries = { members: { ...QUERIES.members, where: { published: true, $name: { in: ['ada', 'lin'] } } } }
    const list = resolveFetchConfigs(authored(), opts({ queries })).get('members')
    const rec = buildDetailConfig(list, { paramName: 'slug', paramValue: 'zed' })
    expect(rec.where).toEqual({ published: true, $name: { in: ['ada', 'lin'] } })
    expect(rec.narrow).toEqual({ match: { $name: 'zed' } })
  })

  it('⭐ a fetch\'s own narrowing never decides which records have pages — it drops from the record question', () => {
    // Which pages exist is the query's to say, never a list's (ruled 2026-09-14).
    const narrowed = resolveFetchConfigs(authored({ where: { $name: { in: ['ada', 'lin'] } }, sort: 'date desc', limit: 1 }), opts()).get('members')
    const rec = buildDetailConfig(narrowed, { paramName: 'slug', paramValue: 'zed' })
    expect(rec.where).toEqual({ published: true })
    expect(rec.sort).toBe('name')
    expect(rec.narrow).toEqual({ match: { $name: 'zed' } })
    // so every section that asks the page's record asks ONE question, whatever it narrows
    const plain = buildDetailConfig(resolveFetchConfigs(authored(), opts()).get('members'), { paramName: 'slug', paramValue: 'zed' })
    expect(deriveCacheKey(rec)).toBe(deriveCacheKey(plain))
  })

  it('two records of one query are two cache entries — `match` is part of the question', () => {
    const list = resolveFetchConfigs(authored({}), opts()).get('members')
    const ada = buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' })
    const lin = buildDetailConfig(list, { paramName: 'slug', paramValue: 'lin' })
    expect(deriveCacheKey(ada)).not.toBe(deriveCacheKey(lin))
  })
})
