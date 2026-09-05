import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveQueryDoor, QUERY_DOOR_KEY, _resetQueryAddressWarnings } from '../src/query-address.js'

// The ONE address a host can declare for a query: the question door. The
// address door — `list` / `record` patterns, retired 2026-09-04 — is not read.
const lane = { query: '/_records/_query/{locale}', list: '/_records/{path}', record: '/_records/{path}/{param}' }

describe('resolveQueryDoor', () => {
  let warn
  beforeEach(() => { _resetQueryAddressWarnings(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => warn.mockRestore())

  it('substitutes the one slot — the locale — and nothing else', () => {
    expect(QUERY_DOOR_KEY).toBe('query')
    expect(resolveQueryDoor(lane, 'en')).toBe('/_records/_query/en')
    expect(resolveQueryDoor(lane, 'fr-CA')).toBe('/_records/_query/fr-CA')
  })

  it('carries whatever segments the host put in the pattern', () => {
    expect(resolveQueryDoor({ query: 'https://h.example/s/abc123/q/{locale}' }, 'en'))
      .toBe('https://h.example/s/abc123/q/en')
  })

  it('is null with no lane, no door on the lane, or no locale to ask in', () => {
    expect(resolveQueryDoor(null, 'en')).toBeNull()
    expect(resolveQueryDoor(undefined, 'en')).toBeNull()
    expect(resolveQueryDoor({}, 'en')).toBeNull()
    expect(resolveQueryDoor(lane, null)).toBeNull()
    expect(resolveQueryDoor(lane, '')).toBeNull()
  })

  it('⛔ does not read the retired address patterns — a lane with only list / record has no door', () => {
    expect(resolveQueryDoor({ list: '/_records/{path}', record: '/_records/{path}/{param}' }, 'en')).toBeNull()
  })

  it('returns null for a malformed declaration rather than throwing', () => {
    for (const bad of ['string', 42, [], { query: 7 }, { query: '' }]) {
      expect(resolveQueryDoor(bad, 'en')).toBeNull()
    }
  })

  it('refuses a door with no {locale} slot, warning once per pattern', () => {
    expect(resolveQueryDoor({ query: '/_records/_query' }, 'en')).toBeNull()
    expect(resolveQueryDoor({ query: '/_records/_query' }, 'fr')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/\{locale\}/)
  })

  it('does not warn on a well-formed pattern', () => {
    resolveQueryDoor(lane, 'en')
    expect(warn).not.toHaveBeenCalled()
  })
})
