/**
 * A detail page's title, description and not-found flag come from the record
 * the page is ABOUT — and the probe that finds it has to look where the entity
 * store WROTE it.
 *
 * Two defects, both silent on a visitor's page, both measured 2026-09-04:
 *
 *   1. `_createDynamicPage` peeked the parent's fetch AS AUTHORED while the store
 *      writes under the RESOLVED config. On a live lane (`endpoint`, no `path`)
 *      and on a non-default locale (`/fr/data/…`) the keys differ, so the probe
 *      always missed: no title, no not-found, page never cached.
 *   2. It scanned the LIST only. On a cold load of a detail URL the list is not
 *      cached while the record may be — a live lane's record address, a deferred
 *      query's per-record file — and the scan found nothing (F3).
 */
import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'
import { deriveCacheKey } from '../src/datastore.js'

const RECORDS = { list: '/_records/{path}', record: '/_records/{path}/{param}' }

function site(config = {}) {
  return new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en', ...config },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/blog', title: 'Blog', sections: [], fetch: { query: 'articles', path: '/data/articles.json', as: 'articles' } },
        { route: '/blog/:slug', isDynamic: true, paramName: 'slug', parentSchema: 'articles', title: 'Article', sections: [] },
      ],
    },
  })
}

describe('the probe reads the key the store writes', () => {
  it('on a live lane the list is cached under its `endpoint` — and the title is found there', () => {
    const w = site({ records: RECORDS })
    // What the entity store writes for `{ query: 'articles' }` on this lane.
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', endpoint: '/_records/articles', detail: '/_records/articles/{param}' }), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    const page = w.getPage('/blog/hello')
    expect(page.title).toBe('Hello World')
  })

  it('on a live lane a missing record is a definitive not-found once the list is cached', () => {
    const w = site({ records: RECORDS })
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', endpoint: '/_records/articles', detail: '/_records/articles/{param}' }), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    const page = w.getPage('/blog/nope')
    expect(page.notFound).toBe(true)
    expect(page.title).toBe('Not found')
  })

  it('on a non-default locale the list is cached under its localized path', () => {
    const w = site({ languages: ['en', 'fr'] })
    w.setActiveLocale?.('fr')
    w.activeLocale = 'fr'
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', path: '/fr/data/articles.json' }), {
      data: [{ slug: 'bonjour', title: 'Bonjour' }],
    })
    const page = w.getPage('/fr/blog/bonjour')
    expect(page.title).toBe('Bonjour')
  })

  it('CONTROL — the static lane, default locale, still resolves as before', () => {
    const w = site()
    w.dataStore.set(deriveCacheKey({ query: 'articles', as: 'articles', path: '/data/articles.json' }), {
      data: [{ slug: 'hello', title: 'Hello World' }],
    })
    expect(w.getPage('/blog/hello').title).toBe('Hello World')
  })
})

describe('the page is about one record, so the record is asked first (F3)', () => {
  it('a cold load with the RECORD cached and the list not still titles the page', () => {
    const w = site({ records: RECORDS })
    // Only the detail fetch landed (a live lane answers one record by address).
    w.dataStore.set(deriveCacheKey({ endpoint: '/_records/articles/hello', as: 'articles' }), {
      data: { slug: 'hello', title: 'Hello World', description: 'The one' },
    })
    const page = w.getPage('/blog/hello')
    expect(page.title).toBe('Hello World')
    expect(page.description).toBe('The one')
    expect(page.notFound).toBeFalsy()
  })

  it('and caches the resolved page, since the record was available', () => {
    const w = site({ records: RECORDS })
    w.dataStore.set(deriveCacheKey({ endpoint: '/_records/articles/hello', as: 'articles' }), {
      data: { slug: 'hello', title: 'Hello World' },
    })
    expect(w.getPage('/blog/hello')).toBe(w.getPage('/blog/hello'))
  })

  it('with neither cached, nothing is claimed: no title change, no not-found, page not cached', () => {
    const w = site({ records: RECORDS })
    const first = w.getPage('/blog/hello')
    expect(first.title).toBe('Article')
    expect(first.notFound).toBeFalsy()
    expect(w.getPage('/blog/hello')).not.toBe(first)
  })
})

describe('detailTemplateFor — which field a site routes a key\'s records by', () => {
  it('answers from the template page whose parent query lands under the key', () => {
    const w = site()
    expect(w.detailTemplateFor('articles')).toEqual({ route: '/blog/:slug', paramName: 'slug' })
  })

  it('is null for a key the site routes no detail page over, and for no key', () => {
    const w = site()
    expect(w.detailTemplateFor('people')).toBeNull()
    expect(w.detailTemplateFor(undefined)).toBeNull()
  })

  it('reports the author\'s own param name, not a default', () => {
    const w = new Website({
      content: {
        config: { name: 'T', defaultLanguage: 'en' },
        theme: {},
        pages: [
          { route: '/', isIndex: true, title: 'Home', sections: [] },
          { route: '/products', title: 'P', sections: [], fetch: { query: 'products', path: '/data/products.json', as: 'products' } },
          { route: '/products/:id', isDynamic: true, paramName: 'id', parentSchema: 'products', title: 'Product', sections: [] },
        ],
      },
    })
    expect(w.detailTemplateFor('products')).toEqual({ route: '/products/:id', paramName: 'id' })
  })
})
