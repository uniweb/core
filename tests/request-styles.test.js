import { describe, it, expect, jest } from '@jest/globals'
import { resolveRequestStyle, listRequestStyleNames } from '../src/index.js'
import { jsonBody, flatQuery, strapi } from '../src/request-styles/index.js'

describe('request-style registry', () => {
  it('lists the shipped styles', () => {
    const names = listRequestStyleNames()
    expect(names).toContain('json-body')
    expect(names).toContain('flat-query')
    expect(names).toContain('strapi')
  })

  it('resolves by name', () => {
    expect(resolveRequestStyle('json-body')).toBe(jsonBody)
    expect(resolveRequestStyle('flat-query')).toBe(flatQuery)
    expect(resolveRequestStyle('strapi')).toBe(strapi)
  })

  it('falls back to json-body when name is missing', () => {
    expect(resolveRequestStyle(null)).toBe(jsonBody)
    expect(resolveRequestStyle(undefined)).toBe(jsonBody)
  })

  it('warns in dev and falls back on unknown name', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const style = resolveRequestStyle('nonexistent-style', { dev: true })
    expect(style).toBe(jsonBody)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown request style "nonexistent-style"'),
    )
    warn.mockRestore()
  })

  it('does not warn in production on unknown name', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    resolveRequestStyle('another-bogus-style') // dev default false
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('json-body style', () => {
  const pushAll = new Set(['where', 'limit', 'sort'])

  describe('GET encoding', () => {
    it('encodes where as JSON under _where', () => {
      const out = jsonBody.encode(
        { where: { dept: 'biology' } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['_where', '{"dept":"biology"}']])
      expect(out.bodyMerge).toBeNull()
      expect(out.pushed).toEqual(new Set(['where']))
    })

    it('encodes limit + sort as plain strings under _limit / _sort', () => {
      const out = jsonBody.encode(
        { limit: 10, sort: 'date desc' },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([
        ['_limit', '10'],
        ['_sort', 'date desc'],
      ])
      expect(out.pushed).toEqual(new Set(['limit', 'sort']))
    })

    it('skips operators not in pushCandidates', () => {
      const out = jsonBody.encode(
        { where: { a: 1 }, limit: 5 },
        {
          method: 'GET',
          pushCandidates: new Set(['limit']), // where excluded
          rename: null,
        },
      )
      expect(out.queryParams).toEqual([['_limit', '5']])
      expect(out.pushed).toEqual(new Set(['limit']))
    })

    it('honors rename for wire-name substitution', () => {
      const out = jsonBody.encode(
        { limit: 10, sort: 'date' },
        {
          method: 'GET',
          pushCandidates: pushAll,
          rename: { limit: 'pageSize', sort: 'orderBy' },
        },
      )
      expect(out.queryParams).toEqual([
        ['pageSize', '10'],
        ['orderBy', 'date'],
      ])
    })

    it('ignores empty-string / non-string rename entries', () => {
      const out = jsonBody.encode(
        { limit: 10 },
        {
          method: 'GET',
          pushCandidates: pushAll,
          rename: { limit: '', sort: 42 },
        },
      )
      expect(out.queryParams).toEqual([['_limit', '10']])
    })
  })

  describe('POST encoding', () => {
    it('merges pushed operators as object body', () => {
      const out = jsonBody.encode(
        { where: { status: 'published' }, limit: 10, sort: 'date desc' },
        { method: 'POST', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([])
      expect(out.bodyMerge).toEqual({
        where: { status: 'published' },
        limit: 10,
        sort: 'date desc',
      })
      expect(out.pushed).toEqual(new Set(['where', 'limit', 'sort']))
    })

    it('returns null bodyMerge when nothing pushed', () => {
      const out = jsonBody.encode(
        {},
        { method: 'POST', pushCandidates: pushAll, rename: null },
      )
      expect(out.bodyMerge).toBeNull()
    })

    it('applies rename on body keys', () => {
      const out = jsonBody.encode(
        { limit: 10 },
        {
          method: 'POST',
          pushCandidates: pushAll,
          rename: { limit: 'pageSize' },
        },
      )
      expect(out.bodyMerge).toEqual({ pageSize: 10 })
    })
  })

  it('returns empty results for unknown methods', () => {
    const out = jsonBody.encode(
      { where: { a: 1 } },
      { method: 'PATCH', pushCandidates: pushAll, rename: null },
    )
    expect(out.queryParams).toEqual([])
    expect(out.bodyMerge).toBeNull()
    expect(out.pushed.size).toBe(0)
  })
})

describe('flat-query style', () => {
  const pushAll = new Set(['where', 'limit', 'sort'])

  describe('where — flat AND of equalities only', () => {
    it('pushes a flat object of string/number/boolean values', () => {
      const out = flatQuery.encode(
        { where: { dept: 'biology', year: 2015, tenured: true } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([
        ['dept', 'biology'],
        ['year', '2015'],
        ['tenured', 'true'],
      ])
      expect(out.pushed.has('where')).toBe(true)
    })

    it('pushes { eq: value } operator shorthand', () => {
      const out = flatQuery.encode(
        { where: { dept: { eq: 'biology' } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['dept', 'biology']])
      expect(out.pushed.has('where')).toBe(true)
    })

    it('skips pushdown on nested operators (runtime fallback)', () => {
      const out = flatQuery.encode(
        { where: { age: { gte: 18 } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([])
      expect(out.pushed.has('where')).toBe(false)
    })

    it('skips pushdown on composition (and/or/not)', () => {
      const out = flatQuery.encode(
        { where: { or: [{ a: 1 }, { b: 2 }] } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.pushed.has('where')).toBe(false)
    })

    it('skips pushdown on dotted field paths', () => {
      const out = flatQuery.encode(
        { where: { 'tenure.start': 2015 } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.pushed.has('where')).toBe(false)
    })
  })

  describe('limit + sort', () => {
    it('encodes limit and single-key sort', () => {
      const out = flatQuery.encode(
        { limit: 10, sort: 'date desc' },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([
        ['limit', '10'],
        ['sort', '-date'],
      ])
    })

    it('encodes multi-key sort with comma separator', () => {
      const out = flatQuery.encode(
        { sort: 'date desc, title asc' },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['sort', '-date,title']])
    })

    it('honors rename for limit/sort wire names', () => {
      const out = flatQuery.encode(
        { limit: 10, sort: 'date' },
        {
          method: 'GET',
          pushCandidates: pushAll,
          rename: { limit: 'pageSize', sort: 'orderBy' },
        },
      )
      expect(out.queryParams).toEqual([
        ['pageSize', '10'],
        ['orderBy', 'date'],
      ])
    })
  })

  describe('method handling', () => {
    it('POST is a no-op (empty pushed)', () => {
      const out = flatQuery.encode(
        { where: { a: 1 }, limit: 10 },
        { method: 'POST', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([])
      expect(out.bodyMerge).toBeNull()
      expect(out.pushed.size).toBe(0)
    })
  })
})

describe('strapi style', () => {
  const pushAll = new Set(['where', 'limit', 'sort'])

  describe('where — full where-object coverage', () => {
    it('implicit equality', () => {
      const out = strapi.encode(
        { where: { dept: 'biology' } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['filters[dept][$eq]', 'biology']])
    })

    it('explicit operator', () => {
      const out = strapi.encode(
        { where: { age: { gte: 18 } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['filters[age][$gte]', '18']])
    })

    it('dotted field path maps to nested brackets', () => {
      const out = strapi.encode(
        { where: { 'tenure.start': { gte: 2015 } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['filters[tenure][start][$gte]', '2015']])
    })

    it('in and nin emit indexed array entries', () => {
      const out = strapi.encode(
        { where: { rank: { in: ['associate', 'full'] } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([
        ['filters[rank][$in][0]', 'associate'],
        ['filters[rank][$in][1]', 'full'],
      ])
    })

    it('nin becomes $notIn', () => {
      const out = strapi.encode(
        { where: { status: { nin: ['draft'] } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['filters[status][$notIn][0]', 'draft']])
    })

    it('exists true → $notNull, exists false → $null', () => {
      const t = strapi.encode(
        { where: { bio: { exists: true } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(t.queryParams).toEqual([['filters[bio][$notNull]', 'true']])
      const f = strapi.encode(
        { where: { bio: { exists: false } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(f.queryParams).toEqual([['filters[bio][$null]', 'true']])
    })

    it('or composition', () => {
      const out = strapi.encode(
        { where: { or: [{ dept: 'biology' }, { dept: 'physics' }] } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([
        ['filters[$or][0][dept][$eq]', 'biology'],
        ['filters[$or][1][dept][$eq]', 'physics'],
      ])
    })

    it('not composition', () => {
      const out = strapi.encode(
        { where: { not: { dept: 'emeritus' } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['filters[$not][dept][$eq]', 'emeritus']])
    })

    it('skips pushdown (runtime fallback) on unknown operator', () => {
      const out = strapi.encode(
        { where: { custom: { between: [1, 10] } } },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([])
      expect(out.pushed.has('where')).toBe(false)
    })
  })

  describe('limit + sort', () => {
    it('limit maps to pagination[limit]', () => {
      const out = strapi.encode(
        { limit: 10 },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['pagination[limit]', '10']])
    })

    it('single-key sort uses bare sort=', () => {
      const out = strapi.encode(
        { sort: 'date desc' },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([['sort', 'date:desc']])
    })

    it('multi-key sort uses indexed sort[i]=', () => {
      const out = strapi.encode(
        { sort: 'date desc, title asc' },
        { method: 'GET', pushCandidates: pushAll, rename: null },
      )
      expect(out.queryParams).toEqual([
        ['sort[0]', 'date:desc'],
        ['sort[1]', 'title:asc'],
      ])
    })
  })

  it('declares the Strapi response envelope by default', () => {
    expect(strapi.defaultEnvelope).toEqual({ collection: 'data', item: 'data' })
  })

  it('POST is a no-op (Strapi REST reads are GET-only)', () => {
    const out = strapi.encode(
      { where: { a: 1 }, limit: 10 },
      { method: 'POST', pushCandidates: pushAll, rename: null },
    )
    expect(out.queryParams).toEqual([])
    expect(out.pushed.size).toBe(0)
  })
})
