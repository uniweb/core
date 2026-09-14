import { describe, it, expect } from 'vitest'
import { declaredKeys, sameSchema, fillDeclaredKeys } from '../src/data-keys.js'

describe('declaredKeys — what a section\'s component receives (ruled 2026-09-14)', () => {
  it('the component\'s keys in order, then its foundation\'s, each with its schema ref', () => {
    expect(declaredKeys(
      { post: '@std/article', form: { fields: [{ id: 'name' }] }, team: { schema: '@/member' } },
      { profile: '@/profile' },
    )).toEqual([['post', '@std/article'], ['form', null], ['team', '@/member'], ['profile', '@/profile']])
  })

  it('a key both declare is the component\'s', () => {
    expect(declaredKeys({ profile: '@/cv' }, { profile: '@/profile', site: {} })).toEqual([['profile', '@/cv'], ['site', null]])
  })

  it('reads the build\'s lean map as it reads the authored one', () => {
    expect(declaredKeys({ post: '@std/article', notes: null })).toEqual([['post', '@std/article'], ['notes', null]])
  })

  it('`data: false`, no `data:`, or a list declare nothing — the foundation\'s keys still reach the section', () => {
    expect(declaredKeys(false)).toEqual([])
    expect(declaredKeys(undefined)).toEqual([])
    expect(declaredKeys(['articles'])).toEqual([])
    expect(declaredKeys(false, { profile: '@/profile' })).toEqual([['profile', '@/profile']])
  })
})

describe('sameSchema — a local `@/` ref matches any scope with the same name', () => {
  it('matches as written', () => {
    expect(sameSchema('@std/article', '@std/article')).toBe(true)
  })

  it('a local ref matches a scoped one of the same name, either way round', () => {
    expect(sameSchema('@/member', '@acme/member')).toBe(true)
    expect(sameSchema('@acme/member', '@/member')).toBe(true)
    expect(sameSchema('@/member', '@/member')).toBe(true)
  })

  it('two scopes that differ do not match, and nor do two names', () => {
    expect(sameSchema('@std/person', '@acme/person')).toBe(false)
    expect(sameSchema('@/member', '@/person')).toBe(false)
  })

  it('CONTROL — a missing ref matches nothing', () => {
    expect(sameSchema(null, '@std/article')).toBe(false)
    expect(sameSchema('@std/article', undefined)).toBe(false)
    expect(sameSchema('article', 'article')).toBe(true)
    expect(sameSchema('article', '@/article')).toBe(false)
  })
})

describe('fillDeclaredKeys — automatic `as` (ruled 2026-09-14)', () => {
  // `/blog/:slug`, whose route query `articles` (`@std/article`) its parent page declares
  const queries = { articles: { schema: '@std/article' }, news: { schema: '@std/article' }, people: { schema: '@std/person' } }
  const parent = { query: 'articles', as: 'articles' }
  const fills = (declared, levels, held) => {
    const map = fillDeclaredKeys(declaredKeys(declared), levels, { queries, held })
    return Object.fromEntries([...map].map(([key, { fetch, level }]) => [key, `${fetch.as}@${level}${fetch.current ? `:${fetch.current}` : ''}`]))
  }

  describe('the plan\'s table, row by row (§2.5)', () => {
    it('1 — `articles` declared: the fetch fills its own key', () => {
      expect(fills({ articles: '@std/article' }, [null, null, parent])).toEqual({ articles: 'articles@2' })
    })

    it('2 — `post` declared: the undeclared `articles` fills the first key of its schema', () => {
      expect(fills({ post: '@std/article' }, [null, null, parent])).toEqual({ post: 'articles@2' })
    })

    it('3 — `related` declared, the section\'s own exclude fetch fills it, and the page\'s fetch fills nothing', () => {
      const own = { query: 'articles', current: 'exclude', limit: 3 }
      expect(fills({ related: '@std/article' }, [own, null, parent])).toEqual({ related: 'articles@0:exclude' })
    })

    it('4 — `article` and `related` declared: the record under the first key, nothing under the other', () => {
      expect(fills({ article: '@std/article', related: '@std/article' }, [null, null, parent])).toEqual({ article: 'articles@2' })
    })

    it('5 — `as: related` on the section\'s own fetch fills `related`, and the page\'s fetch fills `article`', () => {
      const own = { query: 'articles', as: 'related', current: 'exclude', limit: 3 }
      expect(fills({ article: '@std/article', related: '@std/article' }, [own, null, parent])).toEqual({ article: 'articles@2', related: 'related@0:exclude' })
    })
  })

  it('within a level the fetches fill keys in the order written, the keys in the order declared', () => {
    const level = [{ query: 'news' }, { query: 'articles' }]
    expect(fills({ first: '@std/article', second: '@std/article' }, [level])).toEqual({ first: 'news@0', second: 'articles@0' })
  })

  it('a key filled at one level is not refilled by a less specific one', () => {
    const own = { query: 'news', as: 'posts' }
    expect(fills({ posts: '@std/article' }, [own, { query: 'articles', as: 'posts' }])).toEqual({ posts: 'posts@0' })
  })

  it('a fetch filling its own key goes before one filling a key by schema — at the same level', () => {
    const level = [{ query: 'news', as: 'feed' }, { query: 'articles', as: 'post' }]
    expect(fills({ post: '@std/article', other: '@std/article' }, [level])).toEqual({ post: 'post@0', other: 'feed@0' })
  })

  it('a key the section holds — a tagged block — is filled first, and no fetch fills it', () => {
    expect(fills({ post: '@std/article', other: '@std/article' }, [null, null, parent], ['post'])).toEqual({ other: 'articles@2' })
  })

  it('a fetch whose key is declared fills that key or nothing — never another of its schema', () => {
    expect(fills({ articles: '@std/article', post: '@std/article' }, [null, null, parent], ['articles'])).toEqual({})
  })

  it('a query of another schema fills nothing, and an inline key only by its own name', () => {
    expect(fills({ post: '@std/article', form: null }, [[{ query: 'people' }, { path: '/x.json', as: 'form' }]])).toEqual({ form: 'form@0' })
  })

  it('a local ref matches the site\'s qualified one — `@/member` and `@acme/member`', () => {
    const map = fillDeclaredKeys([['team', '@/member']], [{ query: 'members' }], { queries: { members: { schema: '@acme/member' } } })
    expect(map.get('team')?.fetch.query).toBe('members')
  })

  it('a string entry is a query name', () => {
    expect(fills({ post: '@std/article' }, ['articles'])).toEqual({ post: 'articles@0' })
  })

  it('CONTROL — nothing declared, nothing filled', () => {
    expect(fills({}, [parent])).toEqual({})
  })
})
