/**
 * The compiled-collection path convention, and the two consumers inside core
 * that must not carry their own copy of it.
 *
 * These are not literal pins for their own sake. The defect being closed was
 * six copies of `/data/` across three packages, one of which had been edited
 * to `/_data/` on its own — so every copy had a passing test and the system
 * was still broken. What matters here is that `localizeConfig` and
 * `applyDeferredDetail` (both reached through `resolveFetchConfigs`) agree
 * with the exported helpers, so re-inlining a different string in either one
 * fails rather than passes.
 */

import {
  DATA_DIR,
  DATA_URL_PREFIX,
  collectionDataUrl,
  recordDataUrl,
  collectionNameFromUrl,
  isDataUrl
} from '../src/data-paths.js'
import { resolveFetchConfigs } from '../src/fetch-config.js'

describe('data-paths helpers', () => {
  /**
   * ⛔ THE ONE PLACE THE CONVENTION IS PINNED.
   *
   * Every other test in every package derives from the exported helpers, so
   * changing the convention is exactly two edits: `DATA_DIR` in
   * `src/data-paths.js`, and this assertion. If you are renaming and find
   * yourself editing a third test, that test has a second copy of the
   * convention in it — fix the test, not the constant.
   */
  it('pins the current convention', () => {
    expect(DATA_DIR).toBe('data')
  })

  it('derives the URL prefix from the directory segment', () => {
    expect(DATA_URL_PREFIX).toBe(`/${DATA_DIR}/`)
  })

  it('keeps the trailing slash, so the prefix test cannot over-match', () => {
    expect(DATA_URL_PREFIX.endsWith('/')).toBe(true)
    // The reason the trailing slash is load-bearing: without it, a site with a
    // page route or an API path named `/database` would be treated as compiled
    // collection data and get locale-prefixed.
    expect(isDataUrl(`/${DATA_DIR}base/thing.json`)).toBe(false)
  })

  it('builds cascade and per-record URLs under the same prefix', () => {
    expect(collectionDataUrl('articles')).toBe(`${DATA_URL_PREFIX}articles.json`)
    expect(recordDataUrl('articles', 'design-tips')).toBe(
      `${DATA_URL_PREFIX}articles/design-tips.json`
    )
    expect(isDataUrl(collectionDataUrl('articles'))).toBe(true)
    expect(isDataUrl(recordDataUrl('articles', 'x'))).toBe(true)
  })

  it('passes a placeholder through untouched, for the injected detail pattern', () => {
    // core injects `recordDataUrl(schema, '{slug}')` as a pattern that
    // substitutePlaceholders resolves later against the route param. Encoding
    // here would break that.
    expect(recordDataUrl('articles', '{slug}')).toBe(
      `${DATA_URL_PREFIX}articles/{slug}.json`
    )
  })

  it('round-trips a collection name through the URL and back', () => {
    expect(collectionNameFromUrl(collectionDataUrl('articles'))).toBe('articles')
    // Nested names survive, and a leading slash is optional on the way back.
    expect(collectionNameFromUrl('/data/archive/2024/posts.json'.replace('/data/', DATA_URL_PREFIX)))
      .toBe('archive/2024/posts')
  })

  it('leaves a non-collection path unmatched rather than mangling it', () => {
    // The caller (validate-data) relies on this: a miss must not collide with
    // a declared collection name, so it can fall through to reading the file.
    expect(collectionNameFromUrl('/api/config.json')).toBe('/api/config')
    expect(collectionNameFromUrl('')).toBe('')
    expect(collectionNameFromUrl(null)).toBe('')
  })

  it('rejects non-strings rather than throwing', () => {
    expect(isDataUrl(undefined)).toBe(false)
    expect(isDataUrl(null)).toBe(false)
    expect(isDataUrl({})).toBe(false)
  })
})

describe('fetch-config uses the shared convention', () => {
  it('locale-prefixes a compiled-collection path', () => {
    const configs = resolveFetchConfigs(
      [{ schema: 'articles', path: collectionDataUrl('articles') }],
      { locale: 'fr', defaultLocale: 'en' }
    )
    expect(configs.get('articles').path).toBe(`/fr${collectionDataUrl('articles')}`)
  })

  it('leaves a non-collection path alone', () => {
    // A remote source, or an author-declared detailUrl, is the author's
    // business to localize. This is the guard that silently serves
    // default-locale content if the prefix test stops matching.
    const configs = resolveFetchConfigs(
      [{ schema: 'events', path: '/api/events.json' }],
      { locale: 'fr', defaultLocale: 'en' }
    )
    expect(configs.get('events').path).toBe('/api/events.json')
  })

  it('injects the per-record default for a deferred collection', () => {
    const configs = resolveFetchConfigs(
      [{ schema: 'articles', path: collectionDataUrl('articles') }],
      { queries: { articles: { deferred: ['body'] } } }
    )
    expect(configs.get('articles').detail).toBe(recordDataUrl('articles', '{slug}'))
  })

  it('prefers an author-declared detailUrl over the per-record default', () => {
    const configs = resolveFetchConfigs(
      [{ schema: 'articles', path: collectionDataUrl('articles') }],
      {
        queries: {
          articles: { deferred: ['body'], detailUrl: '/api/articles/{slug}' }
        }
      }
    )
    expect(configs.get('articles').detail).toBe('/api/articles/{slug}')
  })
})
