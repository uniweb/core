import { describe, it, expect } from 'vitest'
import { isFetchRefinement, resolveFetchConfigs, routeQuery, pageRouteQuery, routeSelection, sectionFetches, withoutRouteVariables, othersView, othersOf, currentOf } from '../src/fetch-config.js'
// Derived, never re-spelled: the convention is pinned once, in
// `tests/data-paths.test.js`. See the note there before pinning it again.
import { queryDataUrl, recordDataUrl } from '../src/data-paths.js'

/**
 * Direct tests for the shared fetch-config rule.
 *
 * `entity-store.test.js` already covers this logic through the object graph
 * (hierarchy walk, first-match-per-schema, the three localization cases,
 * refine). These tests target the module directly instead, because it
 * is a public export other hosts call with sources assembled from a content
 * document rather than a graph — so the source-shape-agnostic contract and the
 * degradation paths need coverage that does not go through EntityStore.
 *
 * Deferred-detail injection is covered here for the first time; it had none.
 */

describe('isFetchRefinement', () => {
  it('recognizes refine: true, and no longer the removed inherit: true alias', () => {
    expect(isFetchRefinement({ refine: true })).toBe(true)
    expect(isFetchRefinement({ inherit: true })).toBe(false)
  })

  it('is false for a plain source config, and safe on nullish input', () => {
    expect(isFetchRefinement({ as: 'articles' })).toBe(false)
    expect(isFetchRefinement({ refine: false })).toBe(false)
    expect(isFetchRefinement(null)).toBe(false)
    expect(isFetchRefinement(undefined)).toBe(false)
  })
})

describe('resolveFetchConfigs — precedence', () => {
  it('takes the first match per schema, not the first match outright', () => {
    // The page wins `articles`; the site still supplies `authors`. Collapsing
    // to a single winner would drop `authors` entirely.
    const configs = resolveFetchConfigs([
      { as: 'articles', path: '/data/page-articles.json' },
      [
        { as: 'articles', path: '/data/site-articles.json' },
        { as: 'authors', path: '/data/authors.json' },
      ],
    ])

    expect(configs.get('articles').path).toBe('/data/page-articles.json')
    expect(configs.get('authors').path).toBe('/data/authors.json')
    expect(configs.size).toBe(2)
  })

  it('skips falsy sources so callers can pass optional levels directly', () => {
    const configs = resolveFetchConfigs([
      null,
      undefined,
      { as: 'articles', path: '/data/articles.json' },
    ])

    expect(configs.size).toBe(1)
    expect(configs.get('articles').path).toBe('/data/articles.json')
  })

  it('ignores entries with no schema', () => {
    const configs = resolveFetchConfigs([
      { path: '/data/nameless.json' },
      { as: 'articles', path: '/data/articles.json' },
    ])

    expect(configs.size).toBe(1)
    expect(configs.has('articles')).toBe(true)
  })

  it('restricts to the requested schemas when given, collects all when empty', () => {
    const sources = [
      { as: 'articles', path: '/data/articles.json' },
      { as: 'authors', path: '/data/authors.json' },
    ]

    expect([...resolveFetchConfigs(sources, { schemas: ['authors'] }).keys()]).toEqual(['authors'])
    expect(resolveFetchConfigs(sources).size).toBe(2)
  })
})

describe('resolveFetchConfigs — localization', () => {
  const cfg = { as: 'articles', path: queryDataUrl('articles') }

  it('prefixes compiled-collection paths for a non-default locale', () => {
    const configs = resolveFetchConfigs([cfg], { locale: 'fr', defaultLocale: 'en' })
    expect(configs.get('articles').path).toBe(`/fr${queryDataUrl('articles')}`)
  })

  it('leaves the default locale untouched', () => {
    const configs = resolveFetchConfigs([cfg], { locale: 'en', defaultLocale: 'en' })
    expect(configs.get('articles').path).toBe(queryDataUrl('articles'))
  })

  it('does not localize remote urls', () => {
    const remote = { as: 'articles', url: 'https://api.example.com/articles' }
    const configs = resolveFetchConfigs([remote], { locale: 'fr', defaultLocale: 'en' })
    expect(configs.get('articles').url).toBe('https://api.example.com/articles')
    expect(configs.get('articles').path).toBeUndefined()
  })

  it('does not localize local paths outside the compiled-collection tree', () => {
    const other = { as: 'articles', path: '/custom/articles.json' }
    const configs = resolveFetchConfigs([other], { locale: 'fr', defaultLocale: 'en' })
    expect(configs.get('articles').path).toBe('/custom/articles.json')
  })

  it('does not mutate the source config', () => {
    const source = { as: 'articles', path: queryDataUrl('articles') }
    resolveFetchConfigs([source], { locale: 'fr', defaultLocale: 'en' })
    expect(source.path).toBe(queryDataUrl('articles'))
  })
})

describe('resolveFetchConfigs — deferred detail', () => {
  const cfg = { as: 'articles', path: queryDataUrl('articles') }

  it('injects the per-record file pattern for a deferred file-backed collection', () => {
    const configs = resolveFetchConfigs([cfg], {
      queries: { articles: { deferred: ['body'] } },
    })
    expect(configs.get('articles').detail).toBe(recordDataUrl('articles', '{slug}'))
  })

  it('⛔ ignores a retired `detailUrl` — the per-record file answers', () => {
    const configs = resolveFetchConfigs([cfg], {
      queries: { articles: { deferred: ['body'], detailUrl: '/api/articles/{slug}' } },
    })
    expect(configs.get('articles').detail).toBe(recordDataUrl('articles', '{slug}'))
  })

  it('leaves an author-supplied detail alone', () => {
    const authored = { as: 'articles', path: '/data/articles.json', detail: 'rest' }
    const configs = resolveFetchConfigs([authored], {
      queries: { articles: { deferred: ['body'] } },
    })
    expect(configs.get('articles').detail).toBe('rest')
  })

  it('injects nothing when the collection declares no deferred fields', () => {
    const configs = resolveFetchConfigs([cfg], {
      queries: { articles: { path: 'collections/articles' } },
    })
    expect(configs.get('articles').detail).toBeUndefined()
  })

  it('degrades to a usable config when no collections map is available', () => {
    // A host whose content projection carries no collection metadata still
    // gets a fetchable config — injection is an enhancement, not a
    // correctness requirement.
    const configs = resolveFetchConfigs([cfg], { collections: null })
    // `depth` is the one field resolution always adds (what the fetch will GET,
    // for the record index); everything authored is untouched.
    expect(configs.get('articles')).toEqual({ ...cfg, whole: true })
  })
})

describe('resolving a query reference to an address', () => {
  const decl = [{ query: 'articles', as: 'articles' }]
  const services = { records: '/_records/_query/{locale}' }
  const queries = { articles: { schema: '@x/article' } }
  const get = (options) => resolveFetchConfigs(decl, { defaultLocale: 'en', ...options }).get('articles')

  it('falls through to the compiled artifact when no lane is declared', () => {
    // Not a degraded mode — this is the answer for every site with no backend,
    // which is the framework's default rather than a special case.
    expect(get({})).toMatchObject({ path: '/data/articles.json', as: 'articles' })
    expect(get({}).ask).toBeUndefined()
  })

  it('asks the host\'s door when one is declared and the payload carries the Model ref', () => {
    expect(get({ services: services, queries })).toMatchObject({ ask: '/_records/_query/en', schema: '@x/article' })
    expect(get({ services: services, queries }).path).toBeUndefined()
  })

  it('locale-prefixes the artifact, and asks the door in that locale', () => {
    // The artifact is a file the build emitted per locale, so the locale is
    // part of its path. A door is asked in one locale — it is in its route.
    const opts = { locale: 'fr', defaultLocale: 'en' }
    expect(get(opts).path).toBe('/fr/data/articles.json')
    expect(get({ ...opts, services: services, queries }).ask).toBe('/_records/_query/fr')
  })

  it('⛔ the retired address patterns declare no lane', () => {
    expect(get({ records: { list: '/_data/{path}', record: '/_data/{path}/{param}' }, queries }).path).toBe('/data/articles.json')
  })

  it('outranks a `path` sitting beside it, and drops it', () => {
    // The sync producer emits both — `query` for a consumer that resolves it,
    // `path` for one that cannot. Two addresses on one request would leave the
    // fetcher to break the tie by field order.
    const both = [{ query: 'articles', path: '/data/articles.json', as: 'articles' }]
    const out = resolveFetchConfigs(both, { services: services, queries, defaultLocale: 'en' }).get('articles')
    expect(out.ask).toBe('/_records/_query/en')
    expect(out.path).toBeUndefined()
  })

  it('still resolves to the artifact when both are present and no lane exists', () => {
    const both = [{ query: 'articles', path: '/data/articles.json', as: 'articles' }]
    expect(resolveFetchConfigs(both, {}).get('articles').path).toBe('/data/articles.json')
  })

  it('leaves a config carrying no collection untouched', () => {
    const plain = [{ path: '/data/team.json', as: 'team' }]
    expect(resolveFetchConfigs(plain, { services: services }).get('team')).toMatchObject({
      path: '/data/team.json',
    })
  })
})

describe('a door answers the record as the list\'s own question — so every door config has a detail source', () => {
  const SERVICES = { records: '/_records/_query/{locale}' }
  const QUERIES = { articles: { schema: '@x/article' } }
  const get = (opts) => resolveFetchConfigs([{ query: 'articles', as: 'articles' }], { defaultLocale: 'en', ...opts }).get('articles')

  it('a door config carries `detail: true` — the record is the same question narrowed by its handle', () => {
    expect(get({ services: SERVICES, queries: QUERIES })).toMatchObject({ ask: '/_records/_query/en', detail: true, whole: false })
  })

  it('⛔ a `detail` a stale binding carries is not read — the resolver decides', () => {
    const cfg = resolveFetchConfigs([{ query: 'articles', as: 'articles', detail: false }], { services: SERVICES, queries: QUERIES, defaultLocale: 'en' }).get('articles')
    expect(cfg.detail).toBe(true)
  })

  it('CONTROL — with no lane a non-deferred query has no detail source and is FULL', () => {
    const cfg = get({ queries: QUERIES })
    expect(cfg.detail).toBeUndefined()
    expect(cfg.whole).toBe(true)
  })

  it('⛔ the retired record pattern injects nothing', () => {
    const cfg = get({ records: { list: '/_data/{path}', record: '/_data/{path}/{param}' }, queries: QUERIES })
    expect(cfg.detail).toBeUndefined()
    expect(cfg).not.toHaveProperty('endpoint')
  })
})

describe('resolution says what a config will GET — depth, and the locale a door is asked in', () => {
  const SERVICES = { records: '/_records/_query/{locale}' }
  const QUERIES = { members: { schema: '@std/person' } }
  const door = (extra = {}) => resolveFetchConfigs([{ query: 'members', as: 'members', ...extra.cfg }], { services: SERVICES, queries: QUERIES, defaultLocale: 'en', ...extra.opts }).get('members')

  it('a config with a per-record source is a list of BRIEFS', () => {
    expect(door().whole).toBe(false)
    const deferred = resolveFetchConfigs([{ query: 'articles', path: '/data/articles.json', as: 'articles' }], {
      queries: { articles: { deferred: ['body'] } },
    }).get('articles')
    expect(deferred.whole).toBe(false)
  })

  it('a config with no per-record source is FULL', () => {
    const cfg = resolveFetchConfigs([{ query: 'articles', path: '/data/articles.json', as: 'articles' }], {}).get('articles')
    expect(cfg.whole).toBe(true)
  })

  it('an explicit depth on the config wins', () => {
    expect(door({ cfg: { whole: true } }).whole).toBe(true)
  })

  it('a door config carries the locale it is asked in — always; a compiled path does not need to', () => {
    expect(door({ opts: { locale: 'fr' } })).toMatchObject({ ask: '/_records/_query/fr', locale: 'fr' })
    expect(door({ opts: { locale: 'en' } })).toMatchObject({ ask: '/_records/_query/en', locale: 'en' })
    const file = resolveFetchConfigs([{ query: 'members', path: '/data/members.json', as: 'members' }], { locale: 'fr', defaultLocale: 'en' }).get('members')
    expect(file.path).toBe('/fr/data/members.json')
    expect(file.locale).toBeUndefined()
  })
})

describe('route variables reach a query as placeholders — and an unbound one drops its clause', () => {
  const vars = { path: 'rust/2025/my-post', dir: 'rust/2025', slug: 'my-post' }
  const decl = (extra) => [{ query: 'posts', path: '/data/posts.json', as: 'posts', ...extra }]

  it('binds :dir / :path / :slug as VALUES in where', () => {
    const cfg = resolveFetchConfigs(decl({ where: { tag: ':dir', $name: ':slug' } }), { variables: vars }).get('posts')
    expect(cfg.narrow.where).toEqual({ tag: 'rust/2025', $name: 'my-post' })
  })

  it('binds on both levels — the query\'s where and the fetch\'s own, in `narrow`', () => {
    const queries = { posts: { schema: '@/post', where: { tag: ':dir' } } }
    const cfg = resolveFetchConfigs(decl({ where: { $name: { ne: ':slug' } } }), { queries, variables: vars }).get('posts')
    expect(cfg.where).toEqual({ tag: 'rust/2025' })
    expect(cfg.narrow.where).toEqual({ $name: { ne: 'my-post' } })
  })

  // `scope` is the query's (ruled 2026-09-13), so a routed one is declared there
  const routedScope = { posts: { schema: '@/post', scope: ':dir' } }

  it('binds :dir as the whole scope — a field of its own, never folded into where', () => {
    const cfg = resolveFetchConfigs(decl(), { queries: routedScope, variables: vars }).get('posts')
    expect(cfg.scope).toBe('rust/2025')
    expect('where' in cfg).toBe(false)
  })

  it('⭐ unbound ⇒ the clause DROPS — one saved query serves the list page and the detail page', () => {
    const list = resolveFetchConfigs(decl({ where: { tag: ':dir', published: true } }), { queries: routedScope }).get('posts')
    expect(list.narrow.where).toEqual({ published: true })
    expect('scope' in list).toBe(false)
    // a `narrow` left with nothing in it is no `narrow` — the same entry as the whole set
    const only = resolveFetchConfigs(decl({ where: { tag: ':dir' } }), {}).get('posts')
    expect('narrow' in only).toBe(false)
    expect('where' in only).toBe(false)
  })

  it('⭐ an EMPTY variable drops its clause too — :dir on a one-segment URL means no directory (ruled 2026-09-11)', () => {
    const one = { path: 'x', dir: '', slug: 'x' }
    const cfg = resolveFetchConfigs(decl({ where: { tag: ':dir', published: true } }), { variables: one }).get('posts')
    expect(cfg.narrow.where).toEqual({ published: true })
    const scoped = resolveFetchConfigs(decl(), { queries: routedScope, variables: one }).get('posts')
    expect('scope' in scoped).toBe(false)
  })

  it('binds inside an operator object and inside composition, dropping what empties', () => {
    const cfg = resolveFetchConfigs(
      decl({ where: { or: [{ tag: ':dir' }, { pinned: true }], year: { gte: ':path' } } }),
      { variables: { path: 'a', dir: 'a', slug: 'a' } },
    ).get('posts')
    expect(cfg.narrow.where).toEqual({ or: [{ tag: 'a' }, { pinned: true }], year: { gte: 'a' } })
    const unbound = resolveFetchConfigs(decl({ where: { or: [{ tag: ':dir' }], year: { gte: ':path' } }, limit: 3 }), {}).get('posts')
    // the where emptied out; the rest of the narrowing stays
    expect(unbound.narrow).toEqual({ limit: 3 })
  })

  it('only the three standard names are variables — anything else is a literal value', () => {
    const cfg = resolveFetchConfigs(decl({ where: { tag: ':category', code: 'a:b' } }), { variables: vars }).get('posts')
    expect(cfg.narrow.where).toEqual({ tag: ':category', code: 'a:b' })
  })

  it('does not mutate the authored declaration', () => {
    const authored = decl({ where: { tag: ':dir' } })
    resolveFetchConfigs(authored, { variables: vars })
    expect(authored[0].where).toEqual({ tag: ':dir' })
  })
})

describe('scope: is its own field on both lanes — `where.path.under` is retired (2026-09-11)', () => {
  const decl = (extra) => [{ query: 'posts', path: '/data/posts.json', as: 'posts', ...extra }]
  const scoped = (scope) => ({ posts: { schema: '@/post', scope } })

  it('stays `scope` on a compiled query — the evaluator applies it, where is left alone', () => {
    const cfg = resolveFetchConfigs(decl(), { queries: scoped('field') }).get('posts')
    expect(cfg.scope).toBe('field')
    expect('where' in cfg).toBe(false)
  })

  it('sits beside a fetch\'s where, each at its own level, both as written', () => {
    const cfg = resolveFetchConfigs(decl({ where: { published: true } }), { queries: scoped('field') }).get('posts')
    expect(cfg.scope).toBe('field')
    expect('where' in cfg).toBe(false)
    expect(cfg.narrow.where).toEqual({ published: true })
  })

  it('binds :dir — and the list page, where :dir is unbound, sees the whole set', () => {
    const vars = { path: 'field/river', dir: 'field', slug: 'river' }
    expect(resolveFetchConfigs(decl(), { queries: scoped(':dir'), variables: vars }).get('posts').scope).toBe('field')
    const list = resolveFetchConfigs(decl(), { queries: scoped(':dir') }).get('posts')
    expect('where' in list).toBe(false)
    expect('scope' in list).toBe(false)
  })

  it('an empty scope — the root — is no scope, and is dropped', () => {
    const cfg = resolveFetchConfigs(decl(), { queries: scoped('') }).get('posts')
    expect('where' in cfg).toBe(false)
    expect('scope' in cfg).toBe(false)
  })
})

describe('a named query\'s routed clauses reach the compiled file\'s config — and are bound per page', () => {
  // ⛔ Measured before this existed: a named query's `scope: :dir` was ignored on
  // the file lane, and `where: { tag: :dir }` was applied at build to the literal
  // `':dir'`, compiling to no records. The build now applies only the fixed
  // `where`; the query's scope and its routed clauses travel here and bind.
  const vars = { path: 'field/river', dir: 'field', slug: 'river' }
  const ref = (extra = {}) => [{ query: 'posts', path: '/data/posts.json', as: 'posts', ...extra }]

  it('carries the named query\'s scope, bound on the parametric page and dropped on the list page', () => {
    const queries = { posts: { schema: '@/post', scope: ':dir' } }
    const page = resolveFetchConfigs(ref(), { queries, variables: vars }).get('posts')
    expect(page).toMatchObject({ path: '/data/posts.json', scope: 'field' })
    const list = resolveFetchConfigs(ref(), { queries }).get('posts')
    expect('scope' in list).toBe(false)
  })

  it('carries only the ROUTED clauses of its where — the fixed ones were applied at build', () => {
    const queries = { posts: { schema: '@/post', where: { tag: ':dir', published: true } } }
    const page = resolveFetchConfigs(ref(), { queries, variables: vars }).get('posts')
    expect(page.where).toEqual({ tag: 'field' })
    const list = resolveFetchConfigs(ref(), { queries }).get('posts')
    expect('where' in list).toBe(false)
  })

  it('carries a FIXED scope too — the build never applies scope', () => {
    const queries = { posts: { schema: '@/post', scope: 'field' } }
    expect(resolveFetchConfigs(ref(), { queries }).get('posts')).toMatchObject({ path: '/data/posts.json', scope: 'field' })
  })

  it('⛔ a binding\'s own `scope` is not read — the query\'s arrives (ruled 2026-09-13)', () => {
    // It REPLACED the query's until then; the build refuses it on a binding now.
    const queries = { posts: { schema: '@/post', scope: 'field' } }
    expect(resolveFetchConfigs(ref({ scope: 'lab' }), { queries }).get('posts').scope).toBe('field')
    expect('scope' in resolveFetchConfigs(ref({ scope: 'lab' }), {}).get('posts')).toBe(false)
  })

  it('a fetch\'s where narrows the set the routed clauses make — each at its own level', () => {
    const queries = { posts: { schema: '@/post', scope: ':dir', where: { tag: ':dir' } } }
    const cfg = resolveFetchConfigs(ref({ where: { pinned: true } }), { queries, variables: vars }).get('posts')
    expect(cfg.scope).toBe('field')
    expect(cfg.where).toEqual({ tag: 'field' })
    expect(cfg.narrow).toEqual({ where: { pinned: true } })
  })
})

describe('a fetch narrows its query\'s set and never reaches past it — the same two levels on both lanes (ruled 2026-09-14)', () => {
  // ⛔ Measured before 2026-09-13: a binding REPLACED the query's where, sort and limit
  // on the records service, while the static build had baked the query's into the
  // file. ⛔ From then until 2026-09-14 the two were MERGED into one flat question — the
  // fetch's where joined the query's with `and`, and its sort and limit replaced the
  // query's — so "the latest 3 among the query's 100" was asked as "the latest 3".
  const SERVICES = { records: '/_records/ask/{locale}' }
  const ref = (extra = {}) => [{ query: 'posts', path: '/data/posts.json', as: 'posts', ...extra }]
  const onFile = (queries, extra, variables = null) =>
    resolveFetchConfigs(ref(extra), { queries, variables }).get('posts')
  const asked = (queries, extra, variables = null) =>
    resolveFetchConfigs(ref(extra), { queries, variables, services: SERVICES, locale: 'en' }).get('posts')

  it('the service is asked the query\'s where as the set, and the fetch\'s in `narrow`', () => {
    const queries = { posts: { schema: '@/post', where: { published: true } } }
    const cfg = asked(queries, { where: { tag: 'x' } })
    expect(cfg.where).toEqual({ published: true })
    expect(cfg.narrow).toEqual({ where: { tag: 'x' } })
    // either alone is itself
    expect(asked(queries, {}).where).toEqual({ published: true })
    expect(asked(queries, {})).not.toHaveProperty('narrow')
    const bare = asked({ posts: { schema: '@/post' } }, { where: { tag: 'x' } })
    expect(bare).not.toHaveProperty('where')
    expect(bare.narrow).toEqual({ where: { tag: 'x' } })
  })

  it('the compiled file carries no fixed clause of the query\'s where — the build applied it — and the fetch\'s in `narrow`', () => {
    const queries = { posts: { schema: '@/post', where: { published: true } } }
    const cfg = onFile(queries, { where: { tag: 'x' } })
    expect(cfg).not.toHaveProperty('where')
    expect(cfg.narrow).toEqual({ where: { tag: 'x' } })
  })

  it('sort and limit: the query\'s define the set, the fetch\'s narrow it — on both lanes', () => {
    const queries = { posts: { schema: '@/post', sort: 'date desc', limit: 3 } }
    for (const lane of [onFile, asked]) {
      expect(lane(queries, {})).toMatchObject({ sort: 'date desc', limit: 3 })
      expect(lane(queries, {})).not.toHaveProperty('narrow')
      // a larger count is asked as written — it cannot reach past the set, which holds 3
      expect(lane(queries, { limit: 5 })).toMatchObject({ sort: 'date desc', limit: 3, narrow: { limit: 5 } })
      expect(lane(queries, { sort: 'title' })).toMatchObject({ sort: 'date desc', limit: 3, narrow: { sort: 'title' } })
    }
  })

  it('⭐ PARITY — one fetch of a query whose where is routed asks both lanes the same two levels', () => {
    const queries = { posts: { schema: '@/post', scope: ':dir', where: { tag: ':dir' }, sort: 'date desc', limit: 10 } }
    const vars = { path: 'field/river', dir: 'field', slug: 'river' }
    const binding = { where: { featured: true }, limit: 3 }
    const pick = ({ scope, where, sort, limit, narrow }) => ({ scope, where, sort, limit, narrow })
    expect(pick(onFile(queries, binding, vars))).toEqual(pick(asked(queries, binding, vars)))
    expect(pick(onFile(queries, binding, vars))).toEqual({
      scope: 'field', where: { tag: 'field' }, sort: 'date desc', limit: 10, narrow: { where: { featured: true }, limit: 3 },
    })
  })

  it('on the list page, where the query\'s clause is unbound, the set has no where and the fetch\'s is its narrowing', () => {
    const queries = { posts: { schema: '@/post', where: { tag: ':dir' } } }
    for (const lane of [onFile, asked]) {
      const cfg = lane(queries, { where: { featured: true } })
      expect(cfg).not.toHaveProperty('where')
      expect(cfg.narrow).toEqual({ where: { featured: true } })
    }
  })

  it('⛔ a `narrow`, `match` or `cursor` a stale fetch carries is not read — the resolver and the client compose them', () => {
    const queries = { posts: { schema: '@/post' } }
    for (const lane of [onFile, asked]) {
      const cfg = lane(queries, { narrow: { limit: 1 }, match: { $name: 'x' }, cursor: 'c', limit: 4 })
      expect(cfg.narrow).toEqual({ limit: 4 })
      expect(cfg).not.toHaveProperty('match')
      expect(cfg).not.toHaveProperty('cursor')
    }
  })
})

describe('routeSelection — the set: the query as saved, without the fetch\'s `narrow` (ruled 2026-09-14)', () => {
  it('drops `narrow` and keeps the query\'s sort AND limit — a query\'s count is part of what it selects', () => {
    expect(routeSelection({ path: '/data/posts.json', as: 'posts', sort: 'date desc', limit: 100, narrow: { where: { tag: 'x' }, limit: 3 } }))
      .toEqual({ path: '/data/posts.json', as: 'posts', sort: 'date desc', limit: 100 })
  })

  it('is the config itself when there is no narrow — the same cache entry, no second read', () => {
    const cfg = { path: '/data/posts.json', as: 'posts', limit: 100 }
    expect(routeSelection(cfg)).toBe(cfg)
  })
})

describe('withoutRouteVariables — a named query\'s narrowing that is fixed for every page', () => {
  it('keeps the fixed clauses and a fixed scope, drops what the route binds', () => {
    expect(withoutRouteVariables({ where: { tag: ':dir', published: true }, scope: 'field' }))
      .toEqual({ where: { published: true }, scope: 'field' })
    expect(withoutRouteVariables({ where: { tag: ':dir' }, scope: ':dir' })).toEqual({ where: null, scope: null })
  })

  it('splits at the TOP level — an `or` holding a variable goes to the runtime whole', () => {
    // Applying half of it at build would drop records the bound `or` keeps.
    expect(withoutRouteVariables({ where: { or: [{ tag: ':dir' }, { pinned: true }], year: 2025 } }))
      .toEqual({ where: { year: 2025 }, scope: null })
  })

  it('an empty or absent query is nothing to apply', () => {
    expect(withoutRouteVariables({})).toEqual({ where: null, scope: null })
    expect(withoutRouteVariables({ scope: '' })).toEqual({ where: null, scope: null })
  })
})

describe('routeQuery — the query a parametric page\'s URL names one record of (ruled 2026-09-11)', () => {
  const q = (name, extra = {}) => ({ query: name, as: name, ...extra })

  it('the page\'s own query first, then its parent\'s, then the site\'s', () => {
    expect(routeQuery({ page: q('own'), parent: q('parent'), site: q('site') })).toMatchObject({ key: 'own', level: 'page' })
    expect(routeQuery({ parent: q('parent'), site: q('site') })).toMatchObject({ key: 'parent', level: 'parent' })
    expect(routeQuery({ site: q('site') })).toMatchObject({ key: 'site', level: 'site' })
  })

  it('the first `as` of the chosen level wins', () => {
    expect(routeQuery({ parent: [q('members'), q('events')] }).key).toBe('members')
  })

  it('a query two levels up is not chosen — the caller passes only the parent', () => {
    // `routeQuery` has no grandparent slot: what sections cannot receive, the URL
    // cannot narrow. The old `parentSchema` reached any depth.
    expect(routeQuery({ page: null, parent: null, site: null })).toBeNull()
  })

  it('with no page-level query, the key the page\'s sections all declare', () => {
    const sections = sectionFetches([{ fetch: q('members') }, { fetch: { refine: true, detail: false } }, { subsections: [{ fetch: q('members', { limit: 3 }) }] }])
    expect(routeQuery({ sections })).toMatchObject({ key: 'members', level: 'sections' })
  })

  it('sections that disagree name no route query', () => {
    const sections = sectionFetches([{ fetch: q('members') }, { fetch: q('events') }])
    expect(routeQuery({ sections })).toBeNull()
  })

  it('a page-level query outranks the sections — a section\'s own other query is not the route query', () => {
    const sections = sectionFetches([{ fetch: q('events') }])
    expect(routeQuery({ parent: q('members'), sections }).key).toBe('members')
  })

  it('a section binding with `current:` declares its key like any other', () => {
    const sections = [{ query: 'members', as: 'members' }, { query: 'members', as: 'members', current: 'exclude' }]
    expect(routeQuery({ sections })).toMatchObject({ key: 'members', level: 'sections' })
  })

  it('returns the declaration it chose, so a caller can read its query name', () => {
    expect(routeQuery({ parent: { query: 'articles', as: 'posts' } }).config.query).toBe('articles')
  })
})

describe('pageRouteQuery — the route query is chosen at the page that captured the variable (ruled 2026-09-13)', () => {
  // content-document shape: routes, declared parents, fetches, raw sections
  const q = (name) => ({ query: name, as: name })
  const pages = [
    { route: '/members', fetch: q('members') },
    { route: '/members/:slug', fetch: null, sections: [] },
    { route: '/members/:slug/cv', fetch: q('publications'), sections: [] },
    { route: '/members/:slug/cv/2020', fetch: null, sections: [] },
    { route: '/about', fetch: q('team') },
  ]
  const byRoute = new Map(pages.map((p) => [p.route, p]))
  const access = {
    routeOf: (p) => p.route,
    parentOf: (p) => byRoute.get(p.route.slice(0, p.route.lastIndexOf('/'))) ?? null,
    fetchOf: (p) => p.fetch,
    sectionsOf: (p) => p.sections,
  }

  it('the capturing page itself: its parent\'s query', () => {
    expect(pageRouteQuery(byRoute.get('/members/:slug'), access)).toMatchObject({ key: 'members', level: 'parent', nested: false })
  })

  it('a nested page: the SAME answer, found at the capturing page — its own `publications` changes nothing', () => {
    const found = pageRouteQuery(byRoute.get('/members/:slug/cv'), access)
    expect(found).toMatchObject({ key: 'members', level: 'parent', nested: true })
    expect(found.capturing.route).toBe('/members/:slug')
  })

  it('any depth below it', () => {
    expect(pageRouteQuery(byRoute.get('/members/:slug/cv/2020'), access)).toMatchObject({ key: 'members', nested: true })
  })

  it('CONTROL — a page on no parametric route has none', () => {
    expect(pageRouteQuery(byRoute.get('/about'), access)).toBeNull()
  })
})

describe('othersView / othersOf — `current: exclude`', () => {
  const records = ['a', 'b', 'c', 'd'].map((slug) => ({ slug }))
  const isB = (r) => r.slug === 'b'

  it('asks the fetch\'s `narrow.limit` one higher, so removing the record still leaves `limit`', () => {
    expect(othersView({ as: 'x', limit: 100, narrow: { where: { y: 1 }, limit: 2 } }))
      .toEqual({ as: 'x', limit: 100, narrow: { where: { y: 1 }, limit: 3 } })
    const cfg = { as: 'x' }
    expect(othersView(cfg)).toBe(cfg)
    // ⛔ a query's `limit` defines the set and is never raised — the others do not reach past it
    const set = { as: 'x', limit: 5 }
    expect(othersView(set)).toBe(set)
  })

  it('removes the page\'s record — the first match only — and cuts to the fetch\'s limit', () => {
    expect(othersOf(records, { narrow: { limit: 2 } }, isB)).toEqual([{ slug: 'a' }, { slug: 'c' }])
    expect(othersOf([...records, { slug: 'b' }], {}, isB)).toEqual([{ slug: 'a' }, { slug: 'c' }, { slug: 'd' }, { slug: 'b' }])
    expect(othersOf(records, {}, (r) => r.slug === 'z')).toEqual(records)
    // the set's own `limit` was applied where the records were selected; it cuts nothing here
    expect(othersOf(records, { limit: 2 }, isB)).toEqual([{ slug: 'a' }, { slug: 'c' }, { slug: 'd' }])
  })

  it('currentOf reads the three modes, and `only` for anything else', () => {
    expect(['only', 'exclude', 'include', undefined, 'other'].map((current) => currentOf({ current })))
      .toEqual(['only', 'exclude', 'include', 'only', 'only'])
  })
})

describe('an external query — a query with `url:` (ruled 2026-09-13)', () => {
  const SERVICES = { records: '/_records/ask/{locale}' }
  const QUERIES = {
    items: { url: 'https://api.test/items', transform: 'results', where: { published: true }, sort: 'date desc' },
    gql: { url: 'https://api.test/graphql', method: 'POST', body: { query: '{ items { id } }' }, transform: 'data.items' },
    posts: { schema: '@/post' },
  }
  const resolve = (binding, extra = {}) =>
    resolveFetchConfigs([{ as: binding.as ?? binding.query, ...binding }], { queries: QUERIES, locale: 'en', defaultLocale: 'en', ...extra }).get(binding.as ?? binding.query)

  it('is fetched from its own address, with its transform, method and body', () => {
    expect(resolve({ query: 'items' })).toMatchObject({ url: 'https://api.test/items', transform: 'results' })
    expect(resolve({ query: 'gql' })).toMatchObject({ url: 'https://api.test/graphql', method: 'POST', body: { query: '{ items { id } }' }, transform: 'data.items' })
    expect(resolve({ query: 'items' }).path).toBeUndefined()
  })

  it('⛔ is never asked of the records service — even where a host offers one', () => {
    const cfg = resolve({ query: 'items' }, { services: SERVICES })
    expect(cfg.ask).toBeUndefined()
    expect(cfg.url).toBe('https://api.test/items')
    // CONTROL — a query over the site's records is asked
    expect(resolve({ query: 'posts' }, { services: SERVICES }).ask).toBe('/_records/ask/en')
  })

  it('a fetch narrows it as it narrows any query — the set, then `narrow`, over what `transform` picked', () => {
    const cfg = resolve({ query: 'items', where: { tag: 'x' }, limit: 3 })
    expect(cfg).toMatchObject({ where: { published: true }, sort: 'date desc', narrow: { where: { tag: 'x' }, limit: 3 } })
    expect(cfg).not.toHaveProperty('limit')
  })

  it('is the browser\'s to fetch unless the binding says otherwise', () => {
    expect(resolve({ query: 'items' }).prerender).toBe(false)
    expect(resolve({ query: 'items', prerender: true }).prerender).toBe(true)
  })

  it('⛔ a stale binding\'s own url, transform, method, body or detail is not read — the query supplies them', () => {
    const cfg = resolve({ query: 'items', url: 'https://evil.test', transform: 'x', method: 'PUT', body: 'b', detail: 'rest', envelope: { item: 'd' } })
    expect(cfg).toMatchObject({ url: 'https://api.test/items', transform: 'results' })
    expect(cfg.method).toBeUndefined()
    expect(cfg.body).toBeUndefined()
    expect(cfg.detail).toBeUndefined()
    expect(cfg.envelope).toBeUndefined()
    // and on a query over the site's records, a stale transform no longer unwraps the compiled file into nothing
    expect(resolve({ query: 'posts', transform: 'data.items' }).transform).toBeUndefined()
  })
})
