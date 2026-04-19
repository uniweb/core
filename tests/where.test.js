import { describe, it, expect } from '@jest/globals'
import { evaluate, match } from '../src/where.js'

const records = [
  { slug: 'darwin',  name: 'Charles Darwin',  rank: 'professor', department: 'biology', tenured: true,  start_year: 1855, tags: ['naturalist', 'theorist'] },
  { slug: 'wallace', name: 'Alfred Wallace',  rank: 'associate', department: 'biology', tenured: false, start_year: 1862, tags: ['naturalist'] },
  { slug: 'lyell',   name: 'Charles Lyell',   rank: 'professor', department: 'geology', tenured: true,  start_year: 1830, tags: ['theorist'] },
  { slug: 'humboldt', name: 'Alexander Humboldt', rank: 'professor', department: 'geology', tenured: false, start_year: 1799 },
]

describe('evaluate — equality and bare values', () => {
  it('matches a single bare-value field', () => {
    expect(evaluate({ department: 'biology' }, records[0])).toBe(true)
    expect(evaluate({ department: 'biology' }, records[2])).toBe(false)
  })

  it('matches multiple bare-value fields with implicit AND', () => {
    expect(evaluate({ department: 'biology', tenured: true }, records[0])).toBe(true)
    expect(evaluate({ department: 'biology', tenured: true }, records[1])).toBe(false)
  })

  it('matches null when the field is null or undefined', () => {
    expect(evaluate({ missing: null }, records[0])).toBe(true)
  })

  it('returns false on missing field for non-null bare value', () => {
    expect(evaluate({ missing: 'foo' }, records[0])).toBe(false)
  })

  it('matches a value inside an array field', () => {
    expect(evaluate({ tags: 'naturalist' }, records[0])).toBe(true)
    expect(evaluate({ tags: 'naturalist' }, records[2])).toBe(false)
  })

  it('returns false on type mismatch (array equality not supported in v1)', () => {
    expect(evaluate({ tags: ['naturalist'] }, records[0])).toBe(false)
  })
})

describe('evaluate — comparison operators', () => {
  it('gt / gte / lt / lte against numbers', () => {
    expect(evaluate({ start_year: { gt: 1850 } }, records[0])).toBe(true)
    expect(evaluate({ start_year: { gt: 1860 } }, records[0])).toBe(false)
    expect(evaluate({ start_year: { gte: 1855 } }, records[0])).toBe(true)
    expect(evaluate({ start_year: { lt: 1860 } }, records[0])).toBe(true)
    expect(evaluate({ start_year: { lte: 1855 } }, records[0])).toBe(true)
  })

  it('returns false on type mismatch', () => {
    expect(evaluate({ start_year: { gt: '1850' } }, records[0])).toBe(false)
    expect(evaluate({ name: { gt: 100 } }, records[0])).toBe(false)
  })

  it('returns false when the field is missing', () => {
    expect(evaluate({ missing: { gt: 0 } }, records[0])).toBe(false)
  })

  it('handles ne (not equal)', () => {
    expect(evaluate({ rank: { ne: 'professor' } }, records[0])).toBe(false)
    expect(evaluate({ rank: { ne: 'professor' } }, records[1])).toBe(true)
  })
})

describe('evaluate — set membership', () => {
  it('in matches when the value is in the array', () => {
    expect(evaluate({ rank: { in: ['associate', 'full'] } }, records[1])).toBe(true)
    expect(evaluate({ rank: { in: ['associate', 'full'] } }, records[0])).toBe(false)
  })

  it('nin matches when the value is not in the array', () => {
    expect(evaluate({ rank: { nin: ['associate', 'assistant'] } }, records[0])).toBe(true)
    expect(evaluate({ rank: { nin: ['associate', 'assistant'] } }, records[1])).toBe(false)
  })

  it('in returns false when the operator value is not an array', () => {
    expect(evaluate({ rank: { in: 'professor' } }, records[0])).toBe(false)
  })
})

describe('evaluate — like', () => {
  it('matches glob patterns', () => {
    expect(evaluate({ name: { like: 'Charles*' } }, records[0])).toBe(true)
    expect(evaluate({ name: { like: 'Charles*' } }, records[2])).toBe(true)
    expect(evaluate({ name: { like: 'Charles*' } }, records[1])).toBe(false)
  })

  it('? matches a single character', () => {
    expect(evaluate({ slug: { like: 'lyel?' } }, records[2])).toBe(true)
    expect(evaluate({ slug: { like: 'lye?' } }, records[2])).toBe(false)
  })

  it('escapes regex metacharacters in the literal portion', () => {
    expect(evaluate({ name: { like: 'Charles.Darwin' } }, records[0])).toBe(false)
    expect(evaluate({ name: { like: 'Charles*' } }, records[0])).toBe(true)
  })

  it('returns false for non-string fields or patterns', () => {
    expect(evaluate({ start_year: { like: '18*' } }, records[0])).toBe(false)
  })
})

describe('evaluate — exists', () => {
  it('exists: true matches truthy fields', () => {
    expect(evaluate({ tenured: { exists: true } }, records[0])).toBe(true)
    expect(evaluate({ tenured: { exists: true } }, records[1])).toBe(false)
  })

  it('exists: false matches missing or falsy fields', () => {
    expect(evaluate({ missing: { exists: false } }, records[0])).toBe(true)
    expect(evaluate({ tenured: { exists: false } }, records[1])).toBe(true)
    expect(evaluate({ tenured: { exists: false } }, records[0])).toBe(false)
  })
})

describe('evaluate — composition', () => {
  it('and combines sub-predicates', () => {
    const where = { and: [{ department: 'biology' }, { tenured: true }] }
    expect(evaluate(where, records[0])).toBe(true)
    expect(evaluate(where, records[1])).toBe(false)
  })

  it('or matches if any sub-predicate matches', () => {
    const where = { or: [{ department: 'geology' }, { tenured: true }] }
    expect(evaluate(where, records[0])).toBe(true)
    expect(evaluate(where, records[1])).toBe(false)
    expect(evaluate(where, records[2])).toBe(true)
  })

  it('not inverts a sub-predicate', () => {
    expect(evaluate({ not: { department: 'biology' } }, records[0])).toBe(false)
    expect(evaluate({ not: { department: 'biology' } }, records[2])).toBe(true)
  })

  it('nests and / or / not', () => {
    const where = {
      and: [
        { department: 'biology' },
        { or: [{ rank: 'professor' }, { start_year: { lt: 1850 } }] },
      ],
    }
    expect(evaluate(where, records[0])).toBe(true)
    expect(evaluate(where, records[1])).toBe(false)
  })

  it('combines composition with bare top-level keys (implicit AND)', () => {
    const where = {
      department: 'biology',
      or: [{ rank: 'professor' }, { tenured: false }],
    }
    expect(evaluate(where, records[0])).toBe(true)
    expect(evaluate(where, records[1])).toBe(true)
    expect(evaluate(where, records[2])).toBe(false)
  })

  it('and with non-array operator value fails closed', () => {
    expect(evaluate({ and: 'not-an-array' }, records[0])).toBe(false)
  })
})

describe('evaluate — dotted paths', () => {
  const nested = { id: 1, tenure: { start: 2015, type: 'permanent' }, address: { city: 'Oxford' } }

  it('descends into nested objects', () => {
    expect(evaluate({ 'tenure.start': { gte: 2015 } }, nested)).toBe(true)
    expect(evaluate({ 'tenure.type': 'permanent' }, nested)).toBe(true)
    expect(evaluate({ 'address.city': 'Oxford' }, nested)).toBe(true)
  })

  it('returns false / undefined for paths that hit non-object cursors', () => {
    expect(evaluate({ 'tenure.missing': 'x' }, nested)).toBe(false)
    expect(evaluate({ 'tenure.start.year': 2015 }, nested)).toBe(false)
  })
})

describe('evaluate — edge cases', () => {
  it('empty where matches everything', () => {
    expect(evaluate({}, records[0])).toBe(true)
  })

  it('null where matches everything', () => {
    expect(evaluate(null, records[0])).toBe(true)
  })

  it('undefined where matches everything', () => {
    expect(evaluate(undefined, records[0])).toBe(true)
  })

  it('non-object where returns false', () => {
    expect(evaluate('string', records[0])).toBe(false)
    expect(evaluate(['array'], records[0])).toBe(false)
  })

  it('null / undefined record returns false', () => {
    expect(evaluate({ field: 'value' }, null)).toBe(false)
    expect(evaluate({ field: 'value' }, undefined)).toBe(false)
  })

  it('non-object record returns false', () => {
    expect(evaluate({ field: 'value' }, 'string')).toBe(false)
  })

  it('unknown operator in operator-object fails closed', () => {
    expect(evaluate({ rank: { unknown: 'professor' } }, records[0])).toBe(false)
  })
})

describe('match — filter records by where-object', () => {
  it('returns matching records in source order', () => {
    const result = match({ department: 'biology' }, records)
    expect(result).toHaveLength(2)
    expect(result[0].slug).toBe('darwin')
    expect(result[1].slug).toBe('wallace')
  })

  it('returns all records when where is null/empty', () => {
    expect(match(null, records)).toHaveLength(records.length)
    expect(match({}, records)).toHaveLength(records.length)
  })

  it('returns empty array when no records match', () => {
    expect(match({ department: 'physics' }, records)).toHaveLength(0)
  })

  it('returns empty array when records is not an array', () => {
    expect(match({ department: 'biology' }, null)).toEqual([])
    expect(match({ department: 'biology' }, 'not-array')).toEqual([])
  })

  it('handles realistic compound predicates from the academic-metrics template', () => {
    const tenuredBiology = { department: 'biology', tenured: true }
    expect(match(tenuredBiology, records).map((r) => r.slug)).toEqual(['darwin'])

    const recentHires = { start_year: { gte: 1860 } }
    expect(match(recentHires, records).map((r) => r.slug)).toEqual(['wallace'])

    const professorsOnly = { rank: 'professor' }
    expect(match(professorsOnly, records).map((r) => r.slug)).toEqual(['darwin', 'lyell', 'humboldt'])
  })
})
