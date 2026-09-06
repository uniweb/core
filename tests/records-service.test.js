import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveRecordsService, RECORDS_SERVICE, _resetRecordsServiceWarnings } from '../src/records-service.js'

// The ONE address a host can declare for a query: the `records` service row.
// ⛔ It is a SERVICE — `config.services.records` — not a lane object of its own
// (2026-09-06). The `config.records` wrapper it replaced held one surviving key
// after the GET lane went, and a wrapper with one key is not a shape.
const services = { records: '/_records/_query/{locale}' }

describe('resolveRecordsService', () => {
  let warn
  beforeEach(() => { _resetRecordsServiceWarnings(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => warn.mockRestore())

  it('substitutes the one slot — the locale — and nothing else', () => {
    expect(RECORDS_SERVICE).toBe('records')
    expect(resolveRecordsService(services, 'en')).toBe('/_records/_query/en')
    expect(resolveRecordsService(services, 'fr-CA')).toBe('/_records/_query/fr-CA')
  })

  it('reads BOTH service declaration forms — the shorthand and the object', () => {
    // `readEndpoint` is the shared rule every service is read with; the records
    // row gets it for free, which is the point of making it a service.
    expect(resolveRecordsService({ records: { endpoint: '/q/{locale}' } }, 'en')).toBe('/q/en')
  })

  it('carries whatever segments the host put in the pattern', () => {
    expect(resolveRecordsService({ records: 'https://h.example/s/abc123/q/{locale}' }, 'en'))
      .toBe('https://h.example/s/abc123/q/en')
  })

  it('is null with no services, no records row, or no locale to ask in', () => {
    expect(resolveRecordsService(null, 'en')).toBeNull()
    expect(resolveRecordsService(undefined, 'en')).toBeNull()
    expect(resolveRecordsService({}, 'en')).toBeNull()
    expect(resolveRecordsService(services, null)).toBeNull()
    expect(resolveRecordsService(services, '')).toBeNull()
  })

  it('⛔ reads only its own row — another service is not a records lane', () => {
    expect(resolveRecordsService({ search: '/_search', submit: '/_submit' }, 'en')).toBeNull()
  })

  it('a row present with no address is a decline — the same answer as absent', () => {
    expect(resolveRecordsService({ records: {} }, 'en')).toBeNull()
    expect(resolveRecordsService({ records: '' }, 'en')).toBeNull()
  })

  it('returns null for a malformed declaration rather than throwing', () => {
    for (const bad of ['string', 42, [], { records: 7 }, { records: '' }]) {
      expect(resolveRecordsService(bad, 'en')).toBeNull()
    }
  })

  it('refuses an endpoint with no {locale} slot, warning once per pattern', () => {
    expect(resolveRecordsService({ records: '/_records/_query' }, 'en')).toBeNull()
    expect(resolveRecordsService({ records: '/_records/_query' }, 'fr')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/\{locale\}/)
  })

  it('does not warn on a well-formed pattern', () => {
    resolveRecordsService(services, 'en')
    expect(warn).not.toHaveBeenCalled()
  })
})
