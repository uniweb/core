import { describe, it, expect } from 'vitest'
import { isFetchRefinement, resolveFetchConfigs } from '../src/fetch-config.js'
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

  it('prefers the collection-declared detailUrl for a remote source', () => {
    const configs = resolveFetchConfigs([cfg], {
      queries: { articles: { deferred: ['body'], detailUrl: '/api/articles/{slug}' } },
    })
    expect(configs.get('articles').detail).toBe('/api/articles/{slug}')
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
    expect(configs.get('articles')).toEqual({ ...cfg, depth: 'full' })
  })
})

describe('resolving a query reference to an address', () => {
  const decl = [{ query: 'articles', as: 'articles' }]
  const lane = { query: '/_records/_query/{locale}' }
  const queries = { articles: { schema: '@x/article' } }
  const get = (options) => resolveFetchConfigs(decl, { defaultLocale: 'en', ...options }).get('articles')

  it('falls through to the compiled artifact when no lane is declared', () => {
    // Not a degraded mode — this is the answer for every site with no backend,
    // which is the framework's default rather than a special case.
    expect(get({})).toMatchObject({ path: '/data/articles.json', as: 'articles' })
    expect(get({}).door).toBeUndefined()
  })

  it('asks the host\'s door when one is declared and the payload carries the Model ref', () => {
    expect(get({ records: lane, queries })).toMatchObject({ door: '/_records/_query/en', schema: '@x/article' })
    expect(get({ records: lane, queries }).path).toBeUndefined()
  })

  it('locale-prefixes the artifact, and asks the door in that locale', () => {
    // The artifact is a file the build emitted per locale, so the locale is
    // part of its path. A door is asked in one locale — it is in its route.
    const opts = { locale: 'fr', defaultLocale: 'en' }
    expect(get(opts).path).toBe('/fr/data/articles.json')
    expect(get({ ...opts, records: lane, queries }).door).toBe('/_records/_query/fr')
  })

  it('⛔ the retired address patterns declare no lane', () => {
    expect(get({ records: { list: '/_data/{path}', record: '/_data/{path}/{param}' }, queries }).path).toBe('/data/articles.json')
  })

  it('outranks a `path` sitting beside it, and drops it', () => {
    // The sync producer emits both — `query` for a consumer that resolves it,
    // `path` for one that cannot. Two addresses on one request would leave the
    // fetcher to break the tie by field order.
    const both = [{ query: 'articles', path: '/data/articles.json', as: 'articles' }]
    const out = resolveFetchConfigs(both, { records: lane, queries, defaultLocale: 'en' }).get('articles')
    expect(out.door).toBe('/_records/_query/en')
    expect(out.path).toBeUndefined()
  })

  it('still resolves to the artifact when both are present and no lane exists', () => {
    const both = [{ query: 'articles', path: '/data/articles.json', as: 'articles' }]
    expect(resolveFetchConfigs(both, {}).get('articles').path).toBe('/data/articles.json')
  })

  it('leaves a config carrying no collection untouched', () => {
    const plain = [{ path: '/data/team.json', as: 'team' }]
    expect(resolveFetchConfigs(plain, { records: lane }).get('team')).toMatchObject({
      path: '/data/team.json',
    })
  })
})

describe('a door answers the record as the list\'s own question — so every door config has a detail source', () => {
  const RECORDS = { query: '/_records/_query/{locale}' }
  const QUERIES = { articles: { schema: '@x/article' } }
  const get = (opts) => resolveFetchConfigs([{ query: 'articles', as: 'articles' }], { defaultLocale: 'en', ...opts }).get('articles')

  it('a door config carries `detail: true` — the record is the same question narrowed by its handle', () => {
    expect(get({ records: RECORDS, queries: QUERIES })).toMatchObject({ door: '/_records/_query/en', detail: true, depth: 'brief' })
  })

  it('an explicit detail on the config is left alone', () => {
    const cfg = resolveFetchConfigs([{ query: 'articles', as: 'articles', detail: false }], { records: RECORDS, queries: QUERIES, defaultLocale: 'en' }).get('articles')
    expect(cfg.detail).toBe(false)
  })

  it('CONTROL — with no lane a non-deferred query has no detail source and is FULL', () => {
    const cfg = get({ queries: QUERIES })
    expect(cfg.detail).toBeUndefined()
    expect(cfg.depth).toBe('full')
  })

  it('⛔ the retired record pattern injects nothing', () => {
    const cfg = get({ records: { list: '/_data/{path}', record: '/_data/{path}/{param}' }, queries: QUERIES })
    expect(cfg.detail).toBeUndefined()
    expect(cfg).not.toHaveProperty('endpoint')
  })
})

describe('resolution says what a config will GET — depth, and the locale a door is asked in', () => {
  const RECORDS = { query: '/_records/_query/{locale}' }
  const QUERIES = { members: { schema: '@std/person' } }
  const door = (extra = {}) => resolveFetchConfigs([{ query: 'members', as: 'members', ...extra.cfg }], { records: RECORDS, queries: QUERIES, defaultLocale: 'en', ...extra.opts }).get('members')

  it('a config with a per-record source is a list of BRIEFS', () => {
    expect(door().depth).toBe('brief')
    const deferred = resolveFetchConfigs([{ query: 'articles', path: '/data/articles.json', as: 'articles' }], {
      queries: { articles: { deferred: ['body'] } },
    }).get('articles')
    expect(deferred.depth).toBe('brief')
  })

  it('a config with no per-record source is FULL', () => {
    const cfg = resolveFetchConfigs([{ query: 'articles', path: '/data/articles.json', as: 'articles' }], {}).get('articles')
    expect(cfg.depth).toBe('full')
  })

  it('an explicit depth on the config wins', () => {
    expect(door({ cfg: { depth: 'full' } }).depth).toBe('full')
  })

  it('a door config carries the locale it is asked in — always; a compiled path does not need to', () => {
    expect(door({ opts: { locale: 'fr' } })).toMatchObject({ door: '/_records/_query/fr', locale: 'fr' })
    expect(door({ opts: { locale: 'en' } })).toMatchObject({ door: '/_records/_query/en', locale: 'en' })
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
    expect(cfg.where).toEqual({ tag: 'rust/2025', $name: 'my-post' })
  })

  it('binds :dir as the whole scope — which a compiled query then evaluates as a path predicate', () => {
    const cfg = resolveFetchConfigs(decl({ scope: ':dir' }), { variables: vars }).get('posts')
    expect(cfg.where).toEqual({ path: { under: 'rust/2025' } })
    expect('scope' in cfg).toBe(false)
  })

  it('⭐ unbound ⇒ the clause DROPS — one saved query serves the list page and the detail page', () => {
    const list = resolveFetchConfigs(decl({ where: { tag: ':dir', published: true }, scope: ':dir' }), {}).get('posts')
    expect(list.where).toEqual({ published: true })
    expect('scope' in list).toBe(false)
    const only = resolveFetchConfigs(decl({ where: { tag: ':dir' } }), {}).get('posts')
    expect('where' in only).toBe(false)
  })

  it('a variable bound to the EMPTY string is bound — :dir under a single-segment capture', () => {
    const cfg = resolveFetchConfigs(decl({ where: { tag: ':dir' } }), { variables: { path: 'x', dir: '', slug: 'x' } }).get('posts')
    expect(cfg.where).toEqual({ tag: '' })
  })

  it('binds inside an operator object and inside composition, dropping what empties', () => {
    const cfg = resolveFetchConfigs(
      decl({ where: { or: [{ tag: ':dir' }, { pinned: true }], year: { gte: ':path' } } }),
      { variables: { path: 'a', dir: 'a', slug: 'a' } },
    ).get('posts')
    expect(cfg.where).toEqual({ or: [{ tag: 'a' }, { pinned: true }], year: { gte: 'a' } })
    const unbound = resolveFetchConfigs(decl({ where: { or: [{ tag: ':dir' }], year: { gte: ':path' } } }), {}).get('posts')
    expect('where' in unbound).toBe(false)
  })

  it('only the three standard names are variables — anything else is a literal value', () => {
    const cfg = resolveFetchConfigs(decl({ where: { tag: ':category', code: 'a:b' } }), { variables: vars }).get('posts')
    expect(cfg.where).toEqual({ tag: ':category', code: 'a:b' })
  })

  it('does not mutate the authored declaration', () => {
    const authored = decl({ where: { tag: ':dir' } })
    resolveFetchConfigs(authored, { variables: vars })
    expect(authored[0].where).toEqual({ tag: ':dir' })
  })
})

describe('scope: on a lane that cannot be asked folds into the path predicate', () => {
  const decl = (extra) => [{ query: 'posts', path: '/data/posts.json', as: 'posts', ...extra }]

  it('becomes where.path.under on a compiled query', () => {
    const cfg = resolveFetchConfigs(decl({ scope: 'field' }), {}).get('posts')
    expect(cfg.where).toEqual({ path: { under: 'field' } })
    expect('scope' in cfg).toBe(false)
  })

  it('conjoins with an authored where', () => {
    const cfg = resolveFetchConfigs(decl({ scope: 'field', where: { published: true } }), {}).get('posts')
    expect(cfg.where).toEqual({ and: [{ published: true }, { path: { under: 'field' } }] })
  })

  it('binds :dir first, then folds — so one query scopes by the URL on both lanes', () => {
    const vars = { path: 'field/river', dir: 'field', slug: 'river' }
    const cfg = resolveFetchConfigs(decl({ scope: ':dir' }), { variables: vars }).get('posts')
    expect(cfg.where).toEqual({ path: { under: 'field' } })
    // and the list page, where :dir is unbound, sees the whole set
    const list = resolveFetchConfigs(decl({ scope: ':dir' }), {}).get('posts')
    expect('where' in list).toBe(false)
    expect('scope' in list).toBe(false)
  })

  it('an empty scope is dropped, never "the root"', () => {
    const cfg = resolveFetchConfigs(decl({ scope: '' }), {}).get('posts')
    expect('where' in cfg).toBe(false)
  })
})
