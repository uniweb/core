import { describe, it, expect } from 'vitest'
import { evaluate, match, whereOutsideLanguage } from '../src/where.js'

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

  it('not_in matches when the value is none of the listed values', () => {
    expect(evaluate({ rank: { not_in: ['associate', 'assistant'] } }, records[0])).toBe(true)
    expect(evaluate({ rank: { not_in: ['associate', 'assistant'] } }, records[1])).toBe(false)
  })

  it('in with a value that is not a list is outside the language — no match', () => {
    expect(evaluate({ rank: { in: 'professor' } }, records[0])).toBe(false)
  })
})

describe('evaluate — text operators (plain text, case-insensitive)', () => {
  it('starts_with and ends_with', () => {
    expect(match({ name: { starts_with: 'charles' } }, records).map((r) => r.slug)).toEqual(['darwin', 'lyell'])
    expect(match({ name: { ends_with: 'WALLACE' } }, records).map((r) => r.slug)).toEqual(['wallace'])
  })

  it('takes the argument literally — no wildcards', () => {
    expect(match({ name: { starts_with: 'Charles*' } }, records)).toEqual([])
  })

  it('contains a piece of a text, or an item of a list', () => {
    expect(match({ name: { contains: 'LES D' } }, records).map((r) => r.slug)).toEqual(['darwin'])
    expect(match({ tags: { contains: 'theorist' } }, records).map((r) => r.slug)).toEqual(['darwin', 'lyell'])
  })

  it('an item of a list is matched whole, and a number or boolean is not text', () => {
    expect(match({ tags: { contains: 'theor' } }, records)).toEqual([])
    expect(match({ start_year: { contains: '18' } }, records)).toEqual([])
    expect(match({ tenured: { starts_with: 't' } }, records)).toEqual([])
  })

  it('a list field matches starts_with when any member does', () => {
    expect(match({ tags: { starts_with: 'nat' } }, records).map((r) => r.slug)).toEqual(['darwin', 'wallace'])
  })
})

describe('evaluate — exists means "has a value"', () => {
  const vals = [
    { id: 'zero', v: 0 },
    { id: 'false', v: false },
    { id: 'text', v: 'x' },
    { id: 'empty-text', v: '' },
    { id: 'empty-list', v: [] },
    { id: 'null', v: null },
    { id: 'missing' },
  ]

  it('exists: true — not missing, null, "" or []; 0 and false are values', () => {
    expect(match({ v: { exists: true } }, vals).map((r) => r.id)).toEqual(['zero', 'false', 'text'])
  })

  it('exists: false — the rest', () => {
    expect(match({ v: { exists: false } }, vals).map((r) => r.id)).toEqual(['empty-text', 'empty-list', 'null', 'missing'])
  })

  it('takes true or false only', () => {
    expect(match({ v: { exists: 1 } }, vals)).toEqual([])
  })
})

describe('evaluate — a list field holds a condition when any member does', () => {
  it('ne is "does not have", not_in is "has none of"', () => {
    expect(match({ tags: { ne: 'naturalist' } }, records).map((r) => r.slug)).toEqual(['lyell', 'humboldt'])
    expect(match({ tags: { not_in: ['naturalist', 'theorist'] } }, records).map((r) => r.slug)).toEqual(['humboldt'])
  })

  it('a comparison holds for some member', () => {
    const scored = [{ id: 'a', s: [1, 5] }, { id: 'b', s: [2] }]
    expect(match({ s: { gt: 4 } }, scored).map((r) => r.id)).toEqual(['a'])
  })

  it('values stay typed', () => {
    expect(match({ tags: 3 }, [{ tags: ['3'] }])).toEqual([])
  })
})

describe('evaluate — a missing field', () => {
  it('satisfies ne and not_in, and fails eq, in, contains and comparisons', () => {
    const r = [{ id: 'x' }]
    expect(match({ status: { ne: 'archived' } }, r)).toHaveLength(1)
    expect(match({ status: { not_in: ['archived'] } }, r)).toHaveLength(1)
    expect(match({ status: 'archived' }, r)).toHaveLength(0)
    expect(match({ status: { in: ['archived'] } }, r)).toHaveLength(0)
    expect(match({ status: { contains: 'a' } }, r)).toHaveLength(0)
    expect(match({ status: { gt: 'a' } }, r)).toHaveLength(0)
  })
})

describe('a where outside the language selects no records', () => {
  it('retired operators, named with their replacement', () => {
    expect(match({ rank: { nin: ['associate'] } }, records)).toEqual([])
    expect(whereOutsideLanguage({ rank: { nin: ['associate'] } })).toMatch(/`nin` is spelled `not_in`/)
    expect(match({ name: { like: 'Charles*' } }, records)).toEqual([])
    expect(whereOutsideLanguage({ name: { like: 'Charles*' } })).toMatch(/`like` is retired/)
  })

  it('an empty and / or, an empty text argument, contains ""', () => {
    expect(match({ and: [] }, records)).toEqual([])
    expect(match({ or: [] }, records)).toEqual([])
    expect(match({ name: { starts_with: '' } }, records)).toEqual([])
    expect(match({ name: { contains: '' } }, records)).toEqual([])
    expect(whereOutsideLanguage({ or: [] })).toMatch(/non-empty list/)
  })

  it('never widens: `not` over a condition outside the language still selects nothing', () => {
    expect(match({ not: { rank: { like: 'x' } } }, records)).toEqual([])
    expect(match({ not: { and: [] } }, records)).toEqual([])
  })

  it('a where inside the language says so', () => {
    expect(whereOutsideLanguage({ a: 1, b: { in: [1] }, or: [{ c: { exists: true } }], not: { d: { starts_with: 'x' } } })).toBe(null)
    expect(whereOutsideLanguage(null)).toBe(null)
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

  it('and with a value that is not a list is outside the language — no match', () => {
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

  it('descends into each item of a list, reading what it reaches as a list field', () => {
    const cvs = [
      { id: 'ada', education: [{ degree: 'PhD', year: 1840 }, { degree: 'BA', year: 1835 }] },
      { id: 'alan', education: [{ degree: 'BA', year: 1934 }] },
      { id: 'none', education: [] },
    ]
    expect(match({ 'education.degree': 'PhD' }, cvs).map((r) => r.id)).toEqual(['ada'])
    expect(match({ 'education.year': { lt: 1836 } }, cvs).map((r) => r.id)).toEqual(['ada'])
    expect(match({ 'education.degree': { ne: 'PhD' } }, cvs).map((r) => r.id)).toEqual(['alan', 'none'])
    expect(match({ 'education.degree': { exists: false } }, cvs).map((r) => r.id)).toEqual(['none'])
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

  it('an unknown operator is outside the language — no match', () => {
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

describe('under — retired (2026-09-11): a folder branch is `scope:`, not a where operator', () => {
  const pages = [
    { slug: 'spring', path: '2024' },
    { slug: 'may',    path: '2024/spring' },
  ]

  it('is not an operator any more — an object carrying it matches nothing', () => {
    // The build refuses `under` with a message naming `scope:`; this pins that the
    // evaluator no longer honours it, so nothing depends on the retired form.
    expect(match({ path: { under: '2024' } }, pages)).toEqual([])
  })

  it('plain equality on `path` still selects one level', () => {
    expect(match({ path: '2024' }, pages).map((r) => r.slug)).toEqual(['spring'])
    expect(match({ path: '' }, [{ slug: 'index', path: '' }, ...pages]).map((r) => r.slug)).toEqual(['index'])
  })
})
