import { describe, it, expect } from 'vitest'
import { applyScope, withinScope } from '../src/scope.js'

// A query's `scope:` over records that carry their placement (`path`, the folder
// `records.yml` put them in). It replaced `where: { path: { under } }`, retired
// 2026-09-11 — these are the containment cases that operator's tests pinned.
const records = [
  { slug: 'index',   path: '' },
  { slug: 'spring',  path: '2024' },
  { slug: 'may',     path: '2024/spring' },
  { slug: 'sibling', path: '2024b' },
  { slug: 'older',   path: '2023' },
]
const slugs = (list) => list.map((r) => r.slug)

describe('scope — a folder branch, at segment boundaries', () => {
  it('holds the named folder and every folder below it', () => {
    expect(slugs(applyScope(records, '2024'))).toEqual(['spring', 'may'])
  })

  it('does NOT hold a sibling sharing a string prefix', () => {
    // The classic prefix bug: a bare startsWith would return `2024b` here,
    // silently delivering records from a branch the author never named.
    expect(withinScope('2024b', '2024')).toBe(false)
  })

  it('the root — an empty scope, or none — holds everything', () => {
    expect(slugs(applyScope(records, ''))).toEqual(slugs(records))
    expect(slugs(applyScope(records, undefined))).toEqual(slugs(records))
    expect(withinScope('2024/spring', '')).toBe(true)
  })

  it('tolerates leading and trailing slashes on either side', () => {
    expect(withinScope('2024/spring', '/2024/')).toBe(true)
    expect(withinScope('/2024/spring/', '2024')).toBe(true)
  })

  it('a record with no placement is outside every branch but the root', () => {
    expect(withinScope(undefined, '2024')).toBe(false)
    expect(withinScope(42, '2024')).toBe(false)
    expect(withinScope(undefined, '')).toBe(true)
  })

  it('keeps source order and returns a non-array unchanged', () => {
    expect(slugs(applyScope([...records].reverse(), '2024'))).toEqual(['may', 'spring'])
    expect(applyScope(null, '2024')).toBe(null)
  })
})
