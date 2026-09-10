/**
 * A service can be switched off — `false`, or `{ enabled: false }` — for EVERY
 * name, on either tier.
 *
 * ⛔ THE BUG THIS PINS. Until 2026-09-10 the resolver read `enabled` for no
 * service at all; only `Website.isSearchEnabled` checked it, for search. So:
 *
 *   submit: { endpoint: '/forms', enabled: false }   → drew the form
 *   submit: false                                    → fell through to a host
 *   submit: { enabled: false } + a host offer        → the HOST won
 *
 * The same spelling turned search off and did nothing for anything else.
 */
import { resolveService, readEndpoint } from '../src/services.js'
import { resolveRecordsService } from '../src/records-service.js'

const site = (config) => ({ config, basePath: '' })

describe('switching a service off', () => {
  test('⛔ site tier: { endpoint, enabled: false } is off', () => {
    expect(resolveService(site({ submit: { endpoint: '/forms', enabled: false } }), 'submit'))
      .toEqual({ url: null, source: 'site' })
  })

  test('⛔ site tier: false is off', () => {
    expect(resolveService(site({ submit: false }), 'submit')).toEqual({ url: null, source: 'site' })
  })

  test("⛔ a site's refusal wins over a host's offer", () => {
    const w = site({ submit: { enabled: false }, services: { submit: { endpoint: '/host-forms' } } })
    expect(resolveService(w, 'submit')).toEqual({ url: null, source: 'site' })
  })

  test('host tier: a row carrying enabled: false is a decline', () => {
    expect(resolveService(site({ services: { submit: { endpoint: '/forms', enabled: false } } }), 'submit'))
      .toEqual({ url: null, source: 'host' })
  })

  test('holds for a name the framework ships no client for', () => {
    expect(resolveService(site({ booking: { endpoint: '/book', enabled: false } }), 'booking'))
      .toEqual({ url: null, source: 'site' })
  })

  test('control: enabled: true, or no enabled key, changes nothing', () => {
    expect(resolveService(site({ submit: { endpoint: '/forms', enabled: true } }), 'submit').url).toBe('/forms')
    expect(resolveService(site({ submit: '/forms' }), 'submit')).toEqual({ url: '/forms', source: 'site' })
    expect(resolveService(site({ services: { submit: '/forms' } }), 'submit')).toEqual({ url: '/forms', source: 'host' })
  })

  test('readEndpoint: a refused declaration offers no address', () => {
    expect(readEndpoint({ endpoint: '/x', enabled: false })).toBe('')
    expect(readEndpoint(false)).toBe('')
    expect(readEndpoint({ endpoint: '/x' })).toBe('/x')
  })

  test('records: a refused row resolves exactly like an absent one', () => {
    const absent = resolveRecordsService({}, 'en')
    expect(resolveRecordsService({ records: { endpoint: '/q/{locale}', enabled: false } }, 'en')).toEqual(absent)
    expect(resolveRecordsService({ records: '/q/{locale}' }, 'en')).not.toEqual(absent)
  })
})
