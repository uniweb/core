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

describe('resolving a collection reference to an address', () => {
  const decl = [{ query: 'articles', as: 'articles' }]
  const lane = { list: '/_data/{path}' }
  const get = (options) => resolveFetchConfigs(decl, options).get('articles')

  it('falls through to the compiled artifact when no lane is declared', () => {
    // Not a degraded mode — this is the answer for every site with no backend,
    // which is the framework's default rather than a special case.
    expect(get({})).toMatchObject({ path: '/data/articles.json', as: 'articles' })
    expect(get({}).endpoint).toBeUndefined()
  })

  it('uses the host lane when one is declared', () => {
    expect(get({ records: lane })).toMatchObject({ endpoint: '/_data/articles' })
    expect(get({ records: lane }).path).toBeUndefined()
  })

  it('locale-prefixes the artifact but not the lane', () => {
    // The artifact is a file the build emitted per locale, so the locale is
    // part of its path. A lane answers a query and the host locale-projects,
    // so the locale travels as a request parameter instead.
    const opts = { locale: 'fr', defaultLocale: 'en' }
    expect(get(opts).path).toBe('/fr/data/articles.json')
    expect(get({ ...opts, records: lane }).endpoint).toBe('/_data/articles')
  })

  it('outranks a `path` sitting beside it, and drops it', () => {
    // The sync producer emits both during the transition — `collection` for a
    // consumer that resolves it, `path` for one not taught to yet. Two
    // addresses on one request would leave the fetcher to break the tie by
    // field order. This also matches the build-time parser, which has always
    // returned early on `collection` and ignored any `path` beside it.
    const both = [{ query: 'articles', path: '/data/articles.json', as: 'articles' }]
    const out = resolveFetchConfigs(both, { records: lane }).get('articles')
    expect(out.endpoint).toBe('/_data/articles')
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

describe('a lane\'s record address becomes the detail source', () => {
  const decl = [{ query: 'articles', as: 'articles' }]
  const lane = { list: '/_data/{path}', record: '/_data/{path}/{param}' }

  it('injects the record pattern when the lane declares one', () => {
    // Not gated on `deferred:`. A live lane answers a list at brief depth, so a
    // detail page filtering the list would render the brief and miss the body.
    const cfg = resolveFetchConfigs(decl, { records: lane }).get('articles')
    expect(cfg.detail).toBe('/_data/articles/{param}')
  })

  it('injects nothing when the lane declares only a list', () => {
    const cfg = resolveFetchConfigs(decl, { records: { list: lane.list } }).get('articles')
    expect(cfg.detail).toBeUndefined()
  })

  it('never overrides an author-declared detail', () => {
    const authored = [{ query: 'articles', as: 'articles', detail: 'rest' }]
    expect(resolveFetchConfigs(authored, { records: lane }).get('articles').detail).toBe('rest')
  })

  it('leaves the artifact lane on its own rules — the control', () => {
    // Without a lane, `deferred:` still drives detail injection exactly as
    // before, and a query without it still gets none.
    const withDeferred = { articles: { deferred: ['body'] } }
    expect(resolveFetchConfigs(decl, { queries: withDeferred }).get('articles').detail)
      .toBe('/data/articles/{slug}.json')
    expect(resolveFetchConfigs(decl, {}).get('articles').detail).toBeUndefined()
  })
})

describe('resolution says what a config will GET — depth, and the locale a live address lacks', () => {
  const RECORDS = { list: '/_records/{path}', record: '/_records/{path}/{param}' }

  it('a config with a per-record source is a list of BRIEFS', () => {
    const live = resolveFetchConfigs([{ query: 'members', as: 'members' }], { records: RECORDS }).get('members')
    expect(live.depth).toBe('brief')
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
    const cfg = resolveFetchConfigs([{ query: 'members', as: 'members', depth: 'full' }], { records: RECORDS }).get('members')
    expect(cfg.depth).toBe('full')
  })

  it('a live-lane config carries the non-default locale; a compiled path does not need to', () => {
    const live = resolveFetchConfigs([{ query: 'members', as: 'members' }], { records: RECORDS, locale: 'fr', defaultLocale: 'en' }).get('members')
    expect(live.locale).toBe('fr')
    const liveDefault = resolveFetchConfigs([{ query: 'members', as: 'members' }], { records: RECORDS, locale: 'en', defaultLocale: 'en' }).get('members')
    expect(liveDefault.locale).toBeUndefined()
    const file = resolveFetchConfigs([{ query: 'members', path: '/data/members.json', as: 'members' }], { locale: 'fr', defaultLocale: 'en' }).get('members')
    expect(file.path).toBe('/fr/data/members.json')
    expect(file.locale).toBeUndefined()
  })
})
