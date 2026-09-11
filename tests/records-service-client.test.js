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
  it('composes the whole question: door, schema, the saved query\'s narrowing, depth, locale', () => {
    const cfg = resolveFetchConfigs(authored({ limit: 5 }), opts()).get('members')
    expect(cfg.ask).toBe('/_records/ask/en')
    expect(cfg.schema).toBe('@std/person')
    expect(cfg.where).toEqual({ published: true })
    expect(cfg.sort).toBe('name')
    expect(cfg.limit).toBe(5)
    expect(cfg.whole).toBe(false)
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
    const cfg = resolveFetchConfigs(authored({ scope: 'research' }), opts()).get('members')
    expect(cfg.scope).toBe('research')
    expect(cfg.where).toEqual({ published: true })
  })
})

describe('the record on the service is the same question, narrowed by the handle, in full', () => {
  it('asks the route query unchanged plus `match` — the authored where untouched, sort and limit dropped', () => {
    const list = resolveFetchConfigs(authored({ limit: 5 }), opts()).get('members')
    const rec = buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' })
    expect(rec.ask).toBe('/_records/ask/en')
    expect(rec.schema).toBe('@std/person')
    // ⭐ `where` is the author's and `match` the visitor's (ruled 2026-09-11) —
    // the handle was merged into `where` until then, replacing a condition there
    expect(rec.where).toEqual({ published: true })
    expect(rec.match).toEqual({ [ROUTE_HANDLE_KEY]: 'ada' })
    expect(rec.whole).toBe(true)
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

  it('the folder name picks the key — [slug] the handle, [uuid] the identity, any other the field', () => {
    const list = resolveFetchConfigs(authored({}), opts()).get('members')
    expect(buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' }).match).toEqual({ $name: 'ada' })
    expect(buildDetailConfig(list, { paramName: 'uuid', paramValue: '019e' }).match).toEqual({ $uuid: '019e' })
    expect(buildDetailConfig(list, { paramName: 'id', paramValue: 42 }).match).toEqual({ id: '42' })
  })

  it('a condition the author put on the same key stays — the URL cannot replace it', () => {
    const list = resolveFetchConfigs(authored({ where: { $name: { in: ['ada', 'lin'] } } }), opts()).get('members')
    const rec = buildDetailConfig(list, { paramName: 'slug', paramValue: 'zed' })
    expect(rec.where).toEqual({ $name: { in: ['ada', 'lin'] } })
    expect(rec.match).toEqual({ $name: 'zed' })
  })

  it('two records of one query are two cache entries — `match` is part of the question', () => {
    const list = resolveFetchConfigs(authored({}), opts()).get('members')
    const ada = buildDetailConfig(list, { paramName: 'slug', paramValue: 'ada' })
    const lin = buildDetailConfig(list, { paramName: 'slug', paramValue: 'lin' })
    expect(deriveCacheKey(ada)).not.toBe(deriveCacheKey(lin))
  })
})
