import { resolveFetchConfigs } from '../src/fetch-config.js'

/**
 * A named query resolves the same way whichever verb published the site.
 *
 * ## The defect
 *
 * Two producers emitted different shapes for one declaration. The sync lane
 * (`build/src/uwx/site.js`) emitted `{ query, path, schema }`; the build lane
 * (`parseFetchConfig`) emitted `{ path, schema }` with no `query` — while
 * carrying a comment claiming it mirrored the other. `resolveQuerySource` keys
 * on `query`, so it fired for a published site and never for a `--link`-deployed
 * one. Measured 2026-09-02 against a host declaring `config.records`:
 *
 *   --link   door undefined, path /data/articles.json   ← the STATIC file
 *   publish  door /_api/q/en (the query rides in the body)   ← the live lane
 *
 * ⭐ **Same site, same declaration, two verbs, two data sources.** Publishing to
 * a platform that declares a live lane is supposed to read from it; the compiled
 * `/data/*.json` is the escape hatch for entities with no known data schema —
 * the ones that never sync — not a second way to serve the ones that do.
 *
 * ## Why these tests are shaped around a HOST-DECLARED lane
 *
 * The bug is invisible without `config.records`: with no live lane both shapes
 * fall back to the same compiled path, which is why it survived. So every case
 * that matters here supplies one.
 */

// What a host declares when it answers queries live.
const RECORDS = { query: '/_api/q/{locale}' }
const QUERIES = { articles: { schema: '@x/article', deferred: ['body'] } }
const LOCALE = { locale: 'en', defaultLocale: 'en' }

/** The build lane's shape for `fetch: { query: 'articles' }`. */
const buildLane = (over = {}) => ({
  query: 'articles',
  path: '/data/articles.json',
  as: 'articles',
  prerender: true,
  merge: false,
  ...over,
})

describe('a host that declares a live lane', () => {
  it('⭐ asks the live door from the BUILD lane, not just the sync lane', () => {
    const cfg = resolveFetchConfigs([buildLane()], { queries: QUERIES, records: RECORDS, ...LOCALE })
      .get('articles')
    expect(cfg.door).toBe('/_api/q/en')
    expect(cfg.schema).toBe('@x/article')
  })

  it('drops the compiled path once the door answers', () => {
    // Two addresses on one request is an ambiguity the fetcher would break by
    // accident of field order.
    const cfg = resolveFetchConfigs([buildLane()], { queries: QUERIES, records: RECORDS, ...LOCALE })
      .get('articles')
    expect(cfg.path).toBeUndefined()
  })

  it('⛔ still reads the compiled file when NO live lane is declared', () => {
    // The escape hatch, and the default for every site with no backend — which
    // is the framework's normal case, not a degraded one.
    const cfg = resolveFetchConfigs([buildLane()], { queries: QUERIES, ...LOCALE }).get('articles')
    expect(cfg.door).toBeUndefined()
    expect(cfg.path).toBe('/data/articles.json')
  })
})

describe('the binding key and the query name are different things', () => {
  it('⭐ finds `deferred:` by QUERY NAME even when the binding key differs', () => {
    // `fetch: { query: 'articles', as: 'posts' }` is a supported, allow-listed,
    // unwarned form. The lookup used to key on `schema` — the binding key — so it
    // missed, and a detail page rendered the brief without its body, silently.
    const cfg = resolveFetchConfigs([buildLane({ as: 'posts' })], { queries: QUERIES })
      .get('posts')
    expect(cfg.detail).toBe('/data/articles/{slug}.json')
  })

  it('keys the resolved map by the BINDING key, which is what a component reads', () => {
    // The override changes `content.data.<key>` and nothing else. Both halves have
    // to be right at once, which is the whole point of separating them.
    const configs = resolveFetchConfigs([buildLane({ as: 'posts' })], { queries: QUERIES })
    expect([...configs.keys()]).toEqual(['posts'])
  })

  it('CONTROL — without an override, key and query name agree', () => {
    const cfg = resolveFetchConfigs([buildLane()], { queries: QUERIES }).get('articles')
    expect(cfg.detail).toBe('/data/articles/{slug}.json')
  })
})

describe('a source-shape fetch, which has no query at all', () => {
  it('still finds `deferred:` by its inferred schema', () => {
    // ⚖️ This is why the deferred lookup keeps `cfg.query || cfg.schema` while the
    // record-address lookup does not. A `path:` fetch genuinely has one key; the
    // deleted `??` sat where `query` was guaranteed present and pretended
    // otherwise.
    const cfg = resolveFetchConfigs(
      [{ path: '/data/articles.json', as: 'articles', prerender: true }],
      { queries: QUERIES }
    ).get('articles')
    expect(cfg.detail).toBe('/data/articles/{slug}.json')
  })

  it('⛔ gets no door — it named a file, not a query', () => {
    // A host's live lane answers QUERIES. A fetch that points at a path is asking
    // for that artifact, and silently redirecting it would be inventing an
    // identity the author never declared.
    const cfg = resolveFetchConfigs(
      [{ path: '/data/articles.json', as: 'articles' }],
      { queries: QUERIES, records: RECORDS, ...LOCALE }
    ).get('articles')
    expect(cfg.door).toBeUndefined()
    expect(cfg.path).toBe('/data/articles.json')
  })
})
