import { describe, it, expect } from 'vitest'
import { isFetchRefinement, resolveFetchConfigs } from '../src/fetch-config.js'

/**
 * Direct tests for the shared fetch-config rule.
 *
 * `entity-store.test.js` already covers this logic through the object graph
 * (hierarchy walk, first-match-per-schema, the three localization cases,
 * refine/inherit). These tests target the module directly instead, because it
 * is a public export other hosts call with sources assembled from a content
 * document rather than a graph — so the source-shape-agnostic contract and the
 * degradation paths need coverage that does not go through EntityStore.
 *
 * Deferred-detail injection is covered here for the first time; it had none.
 */

describe('isFetchRefinement', () => {
  it('recognizes both the canonical and the legacy spelling', () => {
    expect(isFetchRefinement({ refine: true })).toBe(true)
    expect(isFetchRefinement({ inherit: true })).toBe(true)
  })

  it('is false for a plain source config, and safe on nullish input', () => {
    expect(isFetchRefinement({ schema: 'articles' })).toBe(false)
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
      { schema: 'articles', path: '/data/page-articles.json' },
      [
        { schema: 'articles', path: '/data/site-articles.json' },
        { schema: 'authors', path: '/data/authors.json' },
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
      { schema: 'articles', path: '/data/articles.json' },
    ])

    expect(configs.size).toBe(1)
    expect(configs.get('articles').path).toBe('/data/articles.json')
  })

  it('ignores entries with no schema', () => {
    const configs = resolveFetchConfigs([
      { path: '/data/nameless.json' },
      { schema: 'articles', path: '/data/articles.json' },
    ])

    expect(configs.size).toBe(1)
    expect(configs.has('articles')).toBe(true)
  })

  it('restricts to the requested schemas when given, collects all when empty', () => {
    const sources = [
      { schema: 'articles', path: '/data/articles.json' },
      { schema: 'authors', path: '/data/authors.json' },
    ]

    expect([...resolveFetchConfigs(sources, { schemas: ['authors'] }).keys()]).toEqual(['authors'])
    expect(resolveFetchConfigs(sources).size).toBe(2)
  })
})

describe('resolveFetchConfigs — localization', () => {
  const cfg = { schema: 'articles', path: '/data/articles.json' }

  it('prefixes /data/ paths for a non-default locale', () => {
    const configs = resolveFetchConfigs([cfg], { locale: 'fr', defaultLocale: 'en' })
    expect(configs.get('articles').path).toBe('/fr/data/articles.json')
  })

  it('leaves the default locale untouched', () => {
    const configs = resolveFetchConfigs([cfg], { locale: 'en', defaultLocale: 'en' })
    expect(configs.get('articles').path).toBe('/data/articles.json')
  })

  it('does not localize remote urls', () => {
    const remote = { schema: 'articles', url: 'https://api.example.com/articles' }
    const configs = resolveFetchConfigs([remote], { locale: 'fr', defaultLocale: 'en' })
    expect(configs.get('articles').url).toBe('https://api.example.com/articles')
    expect(configs.get('articles').path).toBeUndefined()
  })

  it('does not localize local paths outside /data/', () => {
    const other = { schema: 'articles', path: '/custom/articles.json' }
    const configs = resolveFetchConfigs([other], { locale: 'fr', defaultLocale: 'en' })
    expect(configs.get('articles').path).toBe('/custom/articles.json')
  })

  it('does not mutate the source config', () => {
    const source = { schema: 'articles', path: '/data/articles.json' }
    resolveFetchConfigs([source], { locale: 'fr', defaultLocale: 'en' })
    expect(source.path).toBe('/data/articles.json')
  })
})

describe('resolveFetchConfigs — deferred detail', () => {
  const cfg = { schema: 'articles', path: '/data/articles.json' }

  it('injects the per-record file pattern for a deferred file-backed collection', () => {
    const configs = resolveFetchConfigs([cfg], {
      collections: { articles: { deferred: ['body'] } },
    })
    expect(configs.get('articles').detail).toBe('/data/articles/{slug}.json')
  })

  it('prefers the collection-declared detailUrl for a remote source', () => {
    const configs = resolveFetchConfigs([cfg], {
      collections: { articles: { deferred: ['body'], detailUrl: '/api/articles/{slug}' } },
    })
    expect(configs.get('articles').detail).toBe('/api/articles/{slug}')
  })

  it('leaves an author-supplied detail alone', () => {
    const authored = { schema: 'articles', path: '/data/articles.json', detail: 'rest' }
    const configs = resolveFetchConfigs([authored], {
      collections: { articles: { deferred: ['body'] } },
    })
    expect(configs.get('articles').detail).toBe('rest')
  })

  it('injects nothing when the collection declares no deferred fields', () => {
    const configs = resolveFetchConfigs([cfg], {
      collections: { articles: { path: 'collections/articles' } },
    })
    expect(configs.get('articles').detail).toBeUndefined()
  })

  it('degrades to a usable config when no collections map is available', () => {
    // A host whose content projection carries no collection metadata still
    // gets a fetchable config — injection is an enhancement, not a
    // correctness requirement.
    const configs = resolveFetchConfigs([cfg], { collections: null })
    expect(configs.get('articles')).toEqual(cfg)
  })
})
