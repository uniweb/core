/**
 * A config's set, then its `narrow` — the one order of work every lane that evaluates
 * locally uses (ruled 2026-09-14 [Diego]). The build and the runtime's default fetcher
 * both call it, and a contract test holds them to the same answers.
 */
import { describe, it, expect } from 'vitest'
import { evaluateQuery } from '../src/query-evaluation.js'

// Ten field notes, newest first by `n`; every other one is about pandas.
const notes = Array.from({ length: 10 }, (_, i) => ({
  slug: `note-${i + 1}`,
  $name: `note-${i + 1}`,
  n: i + 1,
  tags: i % 2 === 0 ? ['field-notes', 'pandas'] : ['field-notes'],
  path: i < 5 ? 'field' : 'lab',
}))
const slugs = (records) => records.map((r) => r.slug)

describe('the set — the query as saved: scope, where, sort, limit', () => {
  it('selects, orders and cuts in that order', () => {
    const set = evaluateQuery(notes, { scope: 'field', where: { tags: 'pandas' }, sort: 'n desc', limit: 2 })
    expect(slugs(set)).toEqual(['note-5', 'note-3'])
  })

  it('returns the records untouched when the config says nothing', () => {
    expect(evaluateQuery(notes, {})).toBe(notes)
    expect(evaluateQuery(notes, { as: 'notes', path: '/data/notes.json' })).toBe(notes)
  })

  it('leaves anything but a list as it is — a single record is not filtered, sorted or cut', () => {
    const record = { slug: 'x' }
    expect(evaluateQuery(record, { where: { slug: 'y' }, limit: 1 })).toBe(record)
    expect(evaluateQuery(null, { limit: 1 })).toBeNull()
  })
})

describe('`narrow` — what a fetch takes of the set, applied after it', () => {
  // the query: the 6 most recent field notes
  const query = { where: { tags: 'field-notes' }, sort: 'n desc', limit: 6 }

  it('⭐ "the latest 3 about pandas, AMONG the query\'s 6" — not the latest 3 about pandas', () => {
    const answer = evaluateQuery(notes, { ...query, narrow: { where: { tags: 'pandas' }, limit: 3 } })
    // the set is notes 10..5; pandas among them are 9, 7, 5
    expect(slugs(answer)).toEqual(['note-9', 'note-7', 'note-5'])
    // CONTROL — merged into one flat question, a pandas note outside the set would come back
    const flat = evaluateQuery(notes, { where: { and: [{ tags: 'field-notes' }, { tags: 'pandas' }] }, sort: 'n desc', limit: 4 })
    expect(slugs(flat)).toContain('note-3')
    expect(slugs(evaluateQuery(notes, { ...query, narrow: { where: { tags: 'pandas' }, limit: 4 } }))).not.toContain('note-3')
  })

  it('a narrowing `limit` never reaches past the set', () => {
    expect(evaluateQuery(notes, { ...query, narrow: { limit: 50 } })).toHaveLength(6)
  })

  it('`narrow.sort` re-orders what is left; without it the set\'s order holds', () => {
    const bySlug = evaluateQuery(notes, { ...query, narrow: { sort: 'n', limit: 2 } })
    // ascending among the set (10..5), not among every note
    expect(slugs(bySlug)).toEqual(['note-5', 'note-6'])
    expect(slugs(evaluateQuery(notes, { ...query, narrow: { limit: 2 } }))).toEqual(['note-10', 'note-9'])
  })

  it('`narrow.match` is the record the set holds, or none — compared as a string', () => {
    expect(slugs(evaluateQuery(notes, { ...query, narrow: { match: { $name: 'note-7' } } }))).toEqual(['note-7'])
    // note-2 is a field note, but not among the 6 most recent: not found
    expect(evaluateQuery(notes, { ...query, narrow: { match: { $name: 'note-2' } } })).toEqual([])
    // a URL segment is text — "7" matches a field holding 7
    expect(slugs(evaluateQuery(notes, { ...query, narrow: { match: { n: '7' } } }))).toEqual(['note-7'])
  })

  it('`narrow.match` reads the same map a route param does — `$name` falls back to a record\'s slug, a list matches member-wise', () => {
    const external = [{ slug: 'a', dept: ['bio', 'geo'] }, { slug: 'b', dept: ['geo'] }]
    expect(slugs(evaluateQuery(external, { narrow: { match: { $name: 'b' } } }))).toEqual(['b'])
    expect(slugs(evaluateQuery(external, { narrow: { match: { dept: 'bio' } } }))).toEqual(['a'])
  })

  it('`narrow.cursor` is not evaluated — no local source issues one', () => {
    expect(evaluateQuery(notes, { ...query, narrow: { cursor: 'opaque', limit: 2 } })).toHaveLength(2)
  })

  it('uses the sort it is handed, with the page\'s locale', () => {
    const seen = []
    const sort = (items, expr, { locale }) => { seen.push([expr, locale]); return items }
    evaluateQuery(notes, { sort: 'n desc', narrow: { sort: 'slug' } }, { sort, locale: 'fr' })
    expect(seen).toEqual([['n desc', 'fr'], ['slug', 'fr']])
  })
})
