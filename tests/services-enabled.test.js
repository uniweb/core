/**
 * Switching a service off — `false`, or `{ enabled: false }` — and who wins.
 *
 * ⛔ THE BUG THIS PINS. Until 2026-09-10 the resolver read `enabled` for no
 * service at all; only `Website.isSearchEnabled` checked it. On a static site,
 * `submit: false` and `submit: { endpoint, enabled: false }` drew the form.
 *
 * ⭐ AND THE PRECEDENCE THAT GOES WITH IT. A site's own ADDRESS outranks the
 * host's. A HOST'S OFFER outranks a site's refusal: a host that returns an
 * address is the authority on what a hosted site is given, and a hosted service
 * is turned off where the host provides it. A site's refusal therefore decides
 * only where no host offers — which on a static site is always.
 */
import { resolveService, readEndpoint } from '../src/services.js'
import { resolveRecordsService } from '../src/records-service.js'

const site = (config) => ({ config, basePath: '' })

describe('switching a service off, on a site no host is offering it to', () => {
  test('⛔ { endpoint, enabled: false } is off', () => {
    expect(resolveService(site({ submit: { endpoint: '/forms', enabled: false } }), 'submit'))
      .toEqual({ url: null, source: 'site' })
  })

  test('⛔ false is off', () => {
    expect(resolveService(site({ submit: false }), 'submit')).toEqual({ url: null, source: 'site' })
  })

  test('holds for a name the framework ships no client for', () => {
    expect(resolveService(site({ booking: { endpoint: '/book', enabled: false } }), 'booking'))
      .toEqual({ url: null, source: 'site' })
  })

  test('a host block that does not offer it leaves the refusal standing', () => {
    const w = site({ submit: { enabled: false }, services: { tracking: '/_e' } })
    expect(resolveService(w, 'submit').url).toBeNull()
  })
})

describe('who wins', () => {
  test("⭐ a host's offer outranks a site's refusal", () => {
    const w = site({ submit: { enabled: false }, services: { submit: { endpoint: '/host-forms' } } })
    expect(resolveService(w, 'submit')).toEqual({ url: '/host-forms', source: 'host' })
  })

  test("the site's own address outranks the host's", () => {
    const w = site({ submit: '/my-forms', services: { submit: '/host-forms' } })
    expect(resolveService(w, 'submit')).toEqual({ url: '/my-forms', source: 'site' })
  })

  test('a host row carrying enabled: false is a decline', () => {
    expect(resolveService(site({ services: { submit: { endpoint: '/forms', enabled: false } } }), 'submit'))
      .toEqual({ url: null, source: 'host' })
  })

  test('control: enabled: true, or no enabled key, changes nothing', () => {
    expect(resolveService(site({ submit: { endpoint: '/forms', enabled: true } }), 'submit').url).toBe('/forms')
    expect(resolveService(site({ services: { submit: '/forms' } }), 'submit')).toEqual({ url: '/forms', source: 'host' })
  })
})

describe('the readers', () => {
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
