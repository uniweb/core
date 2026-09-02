import { describe, it, expect, vi } from 'vitest'
import { resolveRequestStyle } from '../src/index.js'
import { jsonBody } from '../src/request-styles/index.js'

describe('request style — one shipped wire', () => {
  it('resolves json-body by name', () => {
    expect(resolveRequestStyle('json-body')).toBe(jsonBody)
  })

  it('resolves json-body when the name is missing', () => {
    expect(resolveRequestStyle(null)).toBe(jsonBody)
    expect(resolveRequestStyle(undefined)).toBe(jsonBody)
  })

  // A site naming a style the framework does not ship must not be served
  // the default wire silently: json-body's `_where=<JSON>` against a
  // backend that expects another dialect returns the wrong set with a 200.
  // Dev throws so the site does not boot on the wrong wire; production
  // logs once and falls back so the site still renders.
  it('throws in dev on an unknown name, naming transports as the way out', () => {
    expect(() => resolveRequestStyle('strapi', { dev: true })).toThrow(
      /unknown request style "strapi"/,
    )
    expect(() => resolveRequestStyle('strapi', { dev: true })).toThrow(/fetcher\.transports/)
  })

  it('logs an error once and falls back to json-body in production', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveRequestStyle('flat-query')).toBe(jsonBody)
    expect(resolveRequestStyle('flat-query')).toBe(jsonBody)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('unknown request style "flat-query"'),
    )
    expect(warn).not.toHaveBeenCalled()
    error.mockRestore()
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

describe('a new where-operator must never be MIS-encoded', () => {
  // Adding an operator to `@uniweb/core/where` widens the predicate
  // language. json-body carries the predicate as opaque JSON, so a new
  // operator rides verbatim to the backend and nothing here has to know
  // it exists.
  //
  // ⛔ The unsafe outcome is an encoder that emits a wire operator the
  // backend does not implement: the request succeeds, the backend ignores
  // or misreads the clause, and the caller receives a WRONG set with a
  // 200. That is why a vendor dialect is a named transport and not a
  // second built-in style. `under` is the worked example.
  const request = { where: { path: { under: '2024' } } }
  const ctx = { method: 'GET', pushCandidates: new Set(['where']), rename: null }

  it('json-body carries an unknown-to-it operator verbatim — the predicate is opaque JSON', () => {
    const out = jsonBody.encode(request, ctx)
    expect(out.pushed.has('where')).toBe(true)
    expect(out.queryParams).toEqual([['_where', JSON.stringify(request.where)]])
  })
})
