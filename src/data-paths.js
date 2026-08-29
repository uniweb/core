/**
 * Compiled-query paths — the ONE home for the URL and directory convention that
 * the build emits and every fetcher requests.
 *
 * ⚠️ `<name>` IS A QUERY'S NAME. `/data/<name>.json` is a named query's
 * MATERIALIZATION — the answer when no host declares a live lane — and never the
 * definition of anything. The records themselves live in `entities/{schema}/`,
 * and `records.yml` decides which of them are published.
 *
 * Why this module exists. The path `/data/<name>.json` was a bare string
 * literal in six places across three packages: the build wrote it
 * (the query processor), the build resolved the query shorthand to it
 * (`data-fetcher.js`), core injected the per-record default
 * (`fetch-config.js applyDeferredDetail`), core gated locale-prefixing on it
 * (`fetch-config.js localizeConfig`), the dev server matched it with a regex
 * (`build/src/site/plugin.js`), and kit's `useEntityDetail` requested it.
 *
 * They drifted. `useEntityDetail` was edited to `/_data/` on its own and
 * nothing else followed, so a public documented hook requested a URL that
 * nothing anywhere emitted or served — broken on every lane, silently,
 * because it has no call site in this workspace to fail. Emit and request
 * had passing tests the whole time; each pinned its own literal.
 *
 * So the invariant is structural, not documented: producers and consumers
 * read the same constant, and a test asserts they agree. Changing the
 * convention is then one edit here rather than a six-site sweep with a
 * silent-failure trap in it (see `localizeConfig` — a missed site there
 * degrades to default-locale content with a 200, not a 404).
 *
 * WHY THIS PATH IS NOT `_data`. The site's other reserved paths are
 * underscore-prefixed — `_search`, `_pages/`, `_importmap/` — and the
 * inconsistency invites a rename. It has been proposed and declined. Those
 * are machinery: an endpoint and bundler artifacts, which no visitor should
 * land on and which an underscore correctly marks as internal. Compiled
 * this JSON is the opposite — it is the site's own content, the same
 * records an agent that found the site through `llms.txt` may reasonably
 * fetch directly. `/data/articles.json` is a legitimate public address, and
 * `data` is a legitimate page route; neither collides with the other, since
 * pages emit `.html` and queries emit `.json`. Prefixing it would say
 * "internal" about something that is not.
 *
 * Zero-dependency leaf, like `./locale-config.js`, so a consumer that must
 * not pull core's graph (semantic-parser, theming) can import the subpath
 * `@uniweb/core/data-paths` directly.
 */

/**
 * The directory segment, for filesystem joins and regex construction.
 * The build writes `<site>/public/<DATA_DIR>/` and copies it to
 * `<dist>/<DATA_DIR>/`.
 */
export const DATA_DIR = 'data'

/**
 * The URL prefix every compiled-query request carries. Note the
 * trailing slash: `isDataUrl` is a prefix test, and without it `/database`
 * would match.
 */
export const DATA_URL_PREFIX = `/${DATA_DIR}/`

/**
 * URL of a query's cascade payload — every record it returns, with
 * `deferred:` fields stripped when the query declares them.
 *
 * @param {string} name - The query name.
 * @returns {string} e.g. `/data/articles.json`
 */
export function queryDataUrl(name) {
  return `${DATA_URL_PREFIX}${name}.json`
}

/**
 * URL of one record's full payload — every field, including deferred ones.
 * Emitted per record only when the query declares `deferred:`.
 *
 * Takes either a concrete slug (kit's `useEntityDetail`, which holds a
 * record) or the literal placeholder `{slug}` (core's `applyDeferredDetail`,
 * which builds a pattern that `substitutePlaceholders` resolves later
 * against the dynamic-route param). Both are plain interpolation; this
 * function does not encode, matching the behavior of the call sites it
 * replaced.
 *
 * @param {string} query - The query name.
 * @param {string} slug - A record slug, or a `{param}` placeholder.
 * @returns {string} e.g. `/data/articles/design-tips.json`
 */
export function recordDataUrl(query, slug) {
  return `${DATA_URL_PREFIX}${query}/${slug}.json`
}

/**
 * The inverse of `queryDataUrl` — recover a query name from a fetch
 * path so a caller can look it up among the declared queries.
 *
 * Best-effort by design, and the caller decides what a miss means: a path
 * outside the compiled tree is returned with only its `.json`
 * suffix removed, which simply will not match any declared query and
 * lets the caller fall through to reading the file. Nested names round-trip
 * (`/data/archive/2024/posts.json` → `archive/2024/posts`).
 *
 * Lives here because it is the *same* convention read backwards. Left at a
 * call site it becomes a regex with the prefix baked in — which is exactly
 * how `validate-data.js` came to hold a sixth copy of it.
 *
 * @param {string} path - A fetch config's `path`.
 * @returns {string} The derived query name.
 */
export function queryNameFromUrl(path) {
  if (typeof path !== 'string') return ''
  // DATA_DIR is a plain identifier segment, so it needs no regex escaping.
  return path.replace(new RegExp(`^/?${DATA_DIR}/`), '').replace(/\.json$/i, '')
}

/**
 * Whether a fetch config's `path` addresses compiled query data.
 *
 * Used to scope behavior that only makes sense for build-emitted files —
 * locale prefixing in particular, which must not touch a remote `url:`
 * source or an author-declared `detailUrl:`.
 *
 * @param {*} path - A fetch config's `path` field.
 * @returns {boolean}
 */
export function isDataUrl(path) {
  return typeof path === 'string' && path.startsWith(DATA_URL_PREFIX)
}
