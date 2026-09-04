/**
 * `sort:` — one evaluator, one key.
 *
 * Three evaluators existed before this module (the build's, the fetcher
 * fallback's, the entity store's refine-order one); two honoured a comma-separated
 * multi-key sort that the records door refuses and the ruling dropped [Diego,
 * 2026-09-04]. These pin the language as the INTERSECTION: what parses, what is
 * refused loudly, and the order that comes out.
 */
import { describe, it, expect } from 'vitest'
import { parseSort, sortRecords, sortToWire } from '../src/sort.js'

describe('parseSort — the authored spellings', () => {
  it('a bare field sorts ascending', () => {
    expect(parseSort('date')).toEqual({ field: 'date', desc: false })
  })

  it('`<field> asc` and `<field> desc`, case-insensitively', () => {
    expect(parseSort('date desc')).toEqual({ field: 'date', desc: true })
    expect(parseSort('date ASC')).toEqual({ field: 'date', desc: false })
    expect(parseSort('  title   Desc ')).toEqual({ field: 'title', desc: true })
  })

  it("the door's `-field` spelling round-trips", () => {
    expect(parseSort('-date')).toEqual({ field: 'date', desc: true })
  })

  it('an already-parsed spec passes through', () => {
    expect(parseSort({ field: 'x', desc: true })).toEqual({ field: 'x', desc: true })
    expect(parseSort({ field: 'x' })).toEqual({ field: 'x', desc: false })
    expect(parseSort({ desc: true })).toBeNull()
  })

  it('nothing parses to null', () => {
    expect(parseSort(undefined)).toBeNull()
    expect(parseSort(null)).toBeNull()
    expect(parseSort('')).toBeNull()
    expect(parseSort('   ')).toBeNull()
  })
})

describe('parseSort — what is refused, and loudly', () => {
  // ⛔ This used to be honoured on two lanes and would have been a 400 on the
  // third. A comma is now an error where the author wrote it.
  it('a multi-key sort throws', () => {
    expect(() => parseSort('order asc, title asc')).toThrow(/more than one key/)
    expect(() => parseSort('a,b')).toThrow(/more than one key/)
  })

  it('an unknown direction throws rather than sorting ascending silently', () => {
    expect(() => parseSort('date descending')).toThrow(/asc.*desc/)
  })

  it('a third token throws', () => {
    expect(() => parseSort('date desc nulls')).toThrow(/not `<field>`/)
  })

  it('a bare dash throws', () => {
    expect(() => parseSort('-')).toThrow(/not a field name/)
  })
})

describe('sortToWire — the door spelling', () => {
  it('ascending is the bare field, descending is `-field`', () => {
    expect(sortToWire('date')).toBe('date')
    expect(sortToWire('date asc')).toBe('date')
    expect(sortToWire('date desc')).toBe('-date')
    expect(sortToWire({ field: 'title', desc: true })).toBe('-title')
  })

  it('nothing is null', () => {
    expect(sortToWire(undefined)).toBeNull()
    expect(sortToWire('')).toBeNull()
  })
})

describe('sortRecords', () => {
  const items = [
    { n: 2, s: 'Banana', d: '2026-02-01', nested: { v: 20 } },
    { n: 1, s: 'apple', d: '2026-01-01', nested: { v: 10 } },
    { n: 3, s: 'cherry', d: '2026-03-01', nested: { v: 30 } },
  ]

  it('sorts numbers and ISO dates in both directions', () => {
    expect(sortRecords(items, 'n').map((i) => i.n)).toEqual([1, 2, 3])
    expect(sortRecords(items, 'n desc').map((i) => i.n)).toEqual([3, 2, 1])
    expect(sortRecords(items, 'd desc').map((i) => i.n)).toEqual([3, 2, 1])
  })

  it('compares strings with localeCompare, so case does not scatter the order', () => {
    expect(sortRecords(items, 's').map((i) => i.s)).toEqual(['apple', 'Banana', 'cherry'])
  })

  it('descends a dotted path', () => {
    expect(sortRecords(items, 'nested.v desc').map((i) => i.n)).toEqual([3, 2, 1])
  })

  it('a record missing the key sorts as the empty string — first ascending, last descending', () => {
    const withGap = [{ n: 2 }, { x: 1 }, { n: 1 }]
    expect(sortRecords(withGap, 'n').map((i) => i.n)).toEqual([undefined, 1, 2])
    expect(sortRecords(withGap, 'n desc').map((i) => i.n)).toEqual([2, 1, undefined])
  })

  it('returns a new array and leaves the input untouched', () => {
    const copy = items.slice()
    const out = sortRecords(items, 'n')
    expect(out).not.toBe(items)
    expect(items).toEqual(copy)
  })

  it('is a no-op with no sort, no array, or an empty array', () => {
    expect(sortRecords(items, undefined)).toBe(items)
    expect(sortRecords(null, 'n')).toBeNull()
    const empty = []
    expect(sortRecords(empty, 'n')).toBe(empty)
  })

  it('refuses a multi-key sort at the call site, not silently by the first key', () => {
    expect(() => sortRecords(items, 'n asc, s asc')).toThrow(/more than one key/)
  })
})
