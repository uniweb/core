import { describe, it, expect, jest } from '@jest/globals'
import { resolveRequestStyle, listRequestStyleNames } from '../src/index.js'
import { jsonBody } from '../src/request-styles/index.js'

describe('request-style registry', () => {
  it('lists the shipped styles', () => {
    expect(listRequestStyleNames()).toContain('json-body')
  })

  it('resolves by name', () => {
    expect(resolveRequestStyle('json-body')).toBe(jsonBody)
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
