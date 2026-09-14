/**
 * Fetch-config resolution — the shared rule, in one place.
 *
 * "Which fetch configs apply here?" is a framework concept. Authors declare
 * `fetch:` at the section, page, folder and site levels; the framework decides
 * which declaration wins per schema, how a local data path is localized, and
 * when a query with deferred fields gets a detail pattern injected.
 *
 * Every host that renders a page needs that answer — the browser runtime, the
 * build-time prerenderer, and any server-side renderer. The rule had grown
 * more than one implementation, and they had diverged in both directions (each
 * carrying a level or a semantic the other lacked). This module is the single
 * definition they call.
 *
 * INTENTIONALLY A LEAF: safe to load anywhere — including environments with no
 * DOM, no filesystem, and a hard bundle-size ceiling. The rule that protects
 * that is **import nothing from the package root** (which pulls semantic-parser
 * and theming) and nothing that reaches it transitively.
 *
 * ⚠️ **This said "and nothing that itself imports — `./data-paths.js` is the
 * only one taken", and both halves had stopped being true.** `query-address.js`
 * was added as an import and itself imports; on 2026-09-06 it became
 * `records-service.js` and the chain grew again. **The admissible set, named
 * rather than counted:**
 *
 *     fetch-config → data-paths                                    (leaf)
 *                  → route-match                                   (leaf)
 *                  → records-service → substitute-placeholders     (leaf)
 *                                    → services → base-path        (leaf)
 *
 * Every module in it is pure JS with no `node:*`, no DOM and no package-root
 * import — the property that actually matters. "Depth 1" was a proxy for it
 * that stopped holding without anything failing, which is why the rule is now
 * stated as the property.
 *
 * ⛔ **Two edges are deliberate and must not be inlined**, for one reason:
 * `data-paths.js` holds the `/data/<name>.json` convention, which has to be
 * identical here and in the build that emits the files; `services.js` holds
 * `readEndpoint`, the ONE rule for reading a service declaration. A second copy
 * of either is precisely the drift this module exists to prevent. ⇒ **If you
 * add an edge, say here why it holds.**
 *
 * WHAT THIS DOES NOT OWN: where the sources come from. A caller holding a live
 * object graph reads them off the graph; a caller holding a content document
 * reads them off the JSON. Both hand the same ordered array to
 * `resolveFetchConfigs`. That difference is real and stays with the caller —
 * but WHICH page is the parent is not: every caller finds it by one rule,
 * `parentRouteOf` in `./route-match.js`. ⛔ Five places found it four ways until
 * 2026-09-11, and a prefetch that read one field while the SPA inferred the rest
 * prefetched nothing for a parametric page.
 */

import { queryDataUrl, isDataUrl, recordDataUrl } from './data-paths.js'
import { resolveRecordsService } from './records-service.js'
// A leaf that imports nothing — `recordRouteBase` is the one rule for which page
// addresses a record, and a route query is chosen at exactly that page.
import { recordRouteBase } from './route-match.js'

/**
 * ⭐ HOW A SECTION ON A PARAMETRIC PAGE USES THE PAGE'S RECORD — `current:` on its
 * binding under the page's route key, ruled 2026-09-13 [Diego]:
 *
 *   - `only` — the record, as a list of one. The default: every section gets it;
 *   - `exclude` — the route query's records without it: "related", "more articles";
 *   - `include` — all of them, the record among them: a previous / next pager.
 *
 * ⛔ It replaces `refine: true` and `detail: false`, a flag three methods consulted
 * separately, which delivered `exclude` and nothing else, and whose `sort` and
 * `where` changed nothing (measured 2026-09-13). The build refuses both.
 */
export const CURRENT_MODES = Object.freeze(['only', 'exclude', 'include'])

/**
 * Does a declaration still say `refine: true`?
 *
 * ⛔ `refine` is RETIRED (2026-09-13, for `current:` above): the build refuses it and
 * nothing in the framework calls this. ⚠️ It stays exported because a consumer that
 * bundles this clone read it through `./fetch-config` (pinned by
 * `tests/fetch-config-live-contract.test.js`, 2026-09-02) — removing a name a reader
 * imports breaks them at the commit, so it goes when that reader says it has.
 *
 * @param {Object} cfg - a fetch declaration
 * @returns {boolean}
 */
export function isFetchRefinement(cfg) {
  return cfg?.refine === true
}

/** A resolved config's `current:` — `only` when it says nothing, or something else. */
export function currentOf(cfg) {
  return CURRENT_MODES.includes(cfg?.current) ? cfg.current : 'only'
}

/**
 * The list a `current: exclude` section asks for: its own view, with `narrow.limit`
 * one higher, so that removing the page's record still leaves `limit` others. The
 * order is the set, then the fetch's `where` and `sort`, remove the record, `limit` —
 * so a fetch's `limit` counts the others.
 *
 * ⚠️ Only the fetch's own `limit` is raised. A query's `limit` defines its set (ruled
 * 2026-09-14 [Diego]), so the others never reach past it: with no `limit` of the
 * fetch's own, the section gets the set without the page's record.
 *
 * @param {Object} cfg - a resolved config under the route key
 * @returns {Object}
 */
export function othersView(cfg) {
  const limit = cfg?.narrow?.limit
  if (typeof limit !== 'number' || limit <= 0) return cfg
  return { ...cfg, narrow: { ...cfg.narrow, limit: limit + 1 } }
}

/**
 * The records a `current: exclude` section receives, from what `othersView` asked:
 * the list without the page's record — the first that matches the route's value, the
 * one `only` delivers — cut to the fetch's `narrow.limit`.
 *
 * @param {Array|*} records - what `othersView(cfg)` answered
 * @param {Object} cfg - the section's resolved config
 * @param {(record: Object) => boolean} isCurrent - matches the page's record
 * @returns {Array|*}
 */
export function othersOf(records, cfg, isCurrent) {
  if (!Array.isArray(records)) return records
  const at = records.findIndex(isCurrent)
  const others = at < 0 ? records : [...records.slice(0, at), ...records.slice(at + 1)]
  const limit = cfg?.narrow?.limit
  return typeof limit === 'number' && limit > 0 ? others.slice(0, limit) : others
}

/**
 * Localize a fetch config that reads a local data path.
 *
 * Non-default locales get `/{locale}` prefixed onto `/data/` paths so the
 * caller reads the translated JSON (`/fr/data/articles.json`). Configs with no
 * `path` (remote `url:` sources), or paths outside `/data/`, pass through
 * untouched — a remote endpoint's localization is the author's business.
 *
 * @param {Object} cfg
 * @param {string|null} locale - the locale being rendered
 * @param {string|null} defaultLocale - the site's default locale
 * @returns {Object} the original config, or a localized copy
 */
function localizeConfig(cfg, locale, defaultLocale) {
  if (!cfg.path) return cfg
  if (!locale || locale === defaultLocale) return cfg
  if (!isDataUrl(cfg.path)) return cfg
  return { ...cfg, path: `/${locale}${cfg.path}` }
}

/**
 * Say whether a resolved config has a PER-RECORD source — `detail` — so a
 * parametric page asks for its record on its own rather than finding it in the list.
 *
 *   - the records service → `true`: the record is the route query's set narrowed
 *     by the URL's value (`buildDetailConfig`);
 *   - an external query declaring `record:` → `true`: its own request;
 *   - a query declaring `deferred:` → `/data/<query>/{slug}.json`, the per-record
 *     file the build emits beside the lean list. Per-record files are keyed by the
 *     record's slug, and are not localized.
 *
 * ⛔ `detail:` is no longer AUTHORED (retired 2026-09-13 [Diego]; the build refuses
 * it): its `rest`, `query`, pattern and `{ body, envelope }` forms are an external
 * query's `record:` now, and `detailUrl:` went the same way. The field survives only
 * as this resolved flag.
 *
 * With no `queries` map available the config passes through untouched — a caller
 * that has no query metadata still gets a usable config.
 *
 * @param {Object} cfg
 * @param {Object|null} queries - the site's `config.queries` map
 * @returns {Object} the original config, or a copy carrying `detail`
 */
function applyDeferredDetail(cfg, queries) {
  if (cfg.detail !== undefined) return cfg

  // The records service answers a RECORD by the query's set narrowed to it, so
  // every asked config has a detail source; `buildDetailConfig` composes it.
  if (cfg.ask) return { ...cfg, detail: true }
  // An external query's `record:` request.
  if (cfg.record && typeof cfg.record === 'object') return { ...cfg, detail: true }


  // ⛔ **`config.queries` is keyed by QUERY NAME, so look it up by the query.**
  // This read `cfg.schema` — the BINDING KEY, which merely defaults to the query
  // name. `fetch: { query: 'articles', schema: 'posts' }` is a supported, allow-
  // listed, unwarned form (`RECOGNIZED_FETCH_KEYS.query`), and under it the lookup
  // missed and a detail page silently rendered the brief without its body.
  // Measured 2026-09-01, control passing: `{query:'articles'}` resolved
  // `/data/articles/{slug}.json`; `{query:'articles',schema:'posts'}` resolved
  // nothing, from the same file.
  //
  // ⚖️ The `|| cfg.schema` is NOT the vestige deleted above. A source-shape fetch
  // (`{ path: … }`) has no query at all, and its schema — inferred from the path —
  // is the only key there is. Two shapes, two answers; the deleted one had one
  // shape and pretended otherwise.
  const queryName = cfg.query || bindingKey(cfg)
  if (!queryName || !queries) return cfg
  const collConfig = queries[queryName]
  if (!collConfig || typeof collConfig !== 'object') return cfg
  const deferred = Array.isArray(collConfig.deferred) ? collConfig.deferred : null
  if (!deferred || deferred.length === 0) return cfg
  return { ...cfg, detail: recordDataUrl(queryName, '{slug}') }
}

/**
 * ⭐ AN EXTERNAL QUERY — a named query with `url:`, ruled 2026-09-13 [Diego]: *"Setting
 * `url` would classify it as external."* A public, keyless endpoint, fetched from its
 * own address by the visitor's browser or a host's prerender, and NEVER asked of the
 * records service. It carries `method`, `body` and `transform`, and `record:` for one
 * record on a parametric page. An API needing a key, headers or paging is a foundation
 * transport, not this.
 *
 * @param {Object|null} decl - a query declaration
 * @returns {boolean}
 */
export function isExternalQuery(decl) {
  return Boolean(decl) && typeof decl === 'object' && typeof decl.url === 'string' && decl.url.length > 0
}

/** Keys a binding may not carry, whatever a stale payload holds — the query supplies them. */
const QUERY_SUPPLIED = ['scope', 'url', 'method', 'body', 'transform', 'record', 'detail', 'envelope']

/**
 * Resolve a query reference to something the fetcher can call.
 *
 * ⭐ ONE NAME END TO END. The author writes `query:` in queries.yml, the wire
 * carries `query`, and this reads `query`. It said `collection` on the wire for
 * a while, on the belief that the field was the backend's to name — measured
 * otherwise: `fetch` is a blob they carry, not one they model.
 *
 * The author names a query; this decides where its records live, and there are
 * exactly two answers:
 *
 *   - a host offers the `records` service (`config.services.records`) → an
 *     `ask` address, and the whole query goes to it (`schema` from the
 *     payload's `config.queries`; an `ask` with no Model ref is a loud per-key
 *     error, never a fallthrough);
 *   - nobody does → the `path` of the artifact the build emitted.
 *
 * ⛔ There is no third answer, and there has not been one since the GET lane
 * the runtime evaluated locally was retired (2026-09-04). `records-service.js`
 * says why the wrapper it lived in went with it.
 *
 * ⭐ The second is not a fallback in the apologetic sense. It is the answer for
 * every site with no backend, which is the framework's default rather than a
 * degraded mode — so an absent lane is silent, not warned.
 *
 * ⭐ `query` OUTRANKS a `path` sitting beside it, which matters because the sync
 * producer emits both — `query` for a consumer that resolves it, `path` as the
 * artifact address for one that cannot. Resolving whenever `query` is present is
 * also what the build-time parser does (`parseFetchConfig` returns early on
 * `query`, ignoring any `path`), so the two agree rather than disagreeing on a
 * shape nobody hand-writes.
 */
function resolveQuerySource(cfg, services, { queries = null, locale = null, defaultLocale = null } = {}) {
  if (typeof cfg.query !== 'string' || cfg.query.length === 0) return cfg
  const decl = queries && typeof queries === 'object' && queries[cfg.query] && typeof queries[cfg.query] === 'object'
    ? queries[cfg.query]
    : null

  // ⛔ A BINDING ADAPTS ITS QUERY WITH `where`, `sort` AND `limit`, AND NOTHING ELSE —
  // ruled 2026-09-13 [Diego]. Its own `scope` is not read (*"it belongs to the
  // query"*; it REPLACED the query's until then), and neither is a source of its own —
  // `url`, `method`, `body`, `transform`, a `detail` form — which an external query
  // declares instead. The build refuses all of them on a binding; a payload that still
  // carries one gets the query's. Dropped from a COPY on every branch below, so the
  // config itself is read exactly as it was.

  // ⭐ AN EXTERNAL QUERY answers from its own address, on every lane.
  if (isExternalQuery(decl)) {
    const { path, url, ...rest } = cfg
    for (const key of QUERY_SUPPLIED) delete rest[key]
    const out = { ...rest, url: decl.url }
    if (typeof decl.method === 'string' && decl.method) out.method = decl.method
    if (decl.body !== undefined && decl.body !== null) out.body = decl.body
    if (typeof decl.transform === 'string' && decl.transform) out.transform = decl.transform
    if (decl.record && typeof decl.record === 'object') out.record = decl.record
    // a live endpoint is the browser's to fetch, unless the binding says otherwise
    if (out.prerender === undefined) out.prerender = false
    return setAndNarrow(out, decl, decl.where)
  }

  // ⭐ THE SERVICE FIRST. A host that answers questions gets the query as saved —
  // `schema`, `scope`, `where`, `sort`, `limit` — and the fetch's `narrow` beside it,
  // and composes no per-query address at all (the records contract, §2). It needs
  // the query's MODEL REF, which lives on the site's `config.queries` declaration; a
  // payload that offers the service but carries no declaration cannot ask, and
  // says so. ⚠️ Dark until a host stamps the row; see `resolveRecordsService`.
  const ask = resolveRecordsService(services, locale ?? defaultLocale)
  if (ask) {
    const schema = typeof decl?.schema === 'string' && decl.schema ? decl.schema : null
    // Drop the transitional `path`: two addresses on one request is an
    // ambiguity the fetcher would have to break by accident of field order.
    const { path, url, ...rest } = cfg
    for (const key of QUERY_SUPPLIED) delete rest[key]
    if (!schema) {
      // ⛔ LOUD, not a fallthrough. A payload that offers the service and carries no
      // Model ref for the query cannot ask, and reading the compiled file
      // instead would turn a producer defect into a 404 that names the wrong
      // thing. The fetcher refuses an asked request with no `schema` before any
      // request is made, and the block's `dataError` says exactly this.
      return setAndNarrow({ ...rest, ask, schema: null }, decl, decl?.where ?? null)
    }
    return setAndNarrow({ ...rest, ask, schema }, decl, decl.where)
  }

  // ⭐ THE COMPILED FILE. The build applied the named query's fixed `where` when it
  // wrote `/data/<query>.json`, in its `sort`; what it could NOT apply is a clause
  // bound to the route (`where: { tag: :dir }`) — a file is written once and the
  // route differs per page — and it applies neither `scope` nor `limit`. So the
  // runtime makes the set per page from what travels here — `scope`, the routed
  // clauses, the query's `sort` in the page's locale, its `limit` — exactly as the
  // service makes it (`bindRouteVariables`, below; `evaluateQuery`). ⛔ Until
  // 2026-09-11 nothing travelled: a named query's `scope: :dir` was ignored on this
  // lane and `where: { tag: :dir }` was applied at build to the literal `':dir'`,
  // compiling to no records (measured).
  const out = { ...cfg, path: queryDataUrl(cfg.query) }
  for (const key of QUERY_SUPPLIED) delete out[key]
  return setAndNarrow(out, decl, decl ? routeVariableClauses(decl.where) : null)
}

/**
 * ⭐ A FETCH IS ITS QUERY'S SET, AND WHAT IT TAKES OF THE SET — two levels, ruled
 * 2026-09-14 [Diego]:
 *
 *   - **the top level is the query as saved** — its `scope`, `where`, `sort` and
 *     `limit`. They define THE SET: the records its `scope` and `where` select, in its
 *     `sort`, up to its `limit`. A query's `limit` is part of what it selects, so a
 *     parametric page has a URL for each record of its route query's set, and no other;
 *   - **`narrow` is the fetch's own `where`, `sort` and `limit`**, applied to the set:
 *     its `where` filters what the set holds, its `sort` re-orders what is left, and its
 *     `limit` cuts the rest — never past the set. Absent when the fetch takes the whole
 *     set.
 *
 * Every lane evaluates the set first and then `narrow` — the records service at the
 * source, the default fetcher and the build over a file or a response
 * (`@uniweb/core`'s `evaluateQuery`) — and every question about one query carries the
 * same top level, so a record question checks the set with the query's own `sort` and
 * `limit` (`buildDetailConfig` adds `narrow.match`).
 *
 * ⛔ Until 2026-09-14 the two levels were MERGED into one flat question — the fetch's
 * `where` joined the query's with `and`, and its `sort` and `limit` replaced the
 * query's. So *"the latest 3 about pandas, among the query's 100 most recent"* was
 * asked as *"the latest 3 about pandas"*, whether or not they were among the 100; a
 * fetch's `limit` could exceed its query's; and a record question dropped the query's
 * `sort` and `limit`, so a record outside the 100 still had a page.
 *
 * A config that names a query ALWAYS carries the fetch's adaptations in `narrow`, with
 * a declaration for the query or without one, so the top level never holds a
 * fetch's field. A `narrow`, `match` or `cursor` a stale binding carries is not read:
 * the resolver and the client compose those.
 *
 * @param {Object} out - the fetch, addressed
 * @param {Object|null} decl - the query's declaration, when the payload carries one
 * @param {Object|null} queryWhere - the part of the query's `where` this lane still
 *   applies: all of it on the service and for an external query, the routed clauses on
 *   the compiled file
 * @returns {Object}
 */
function setAndNarrow(out, decl, queryWhere) {
  const { where, sort, limit, narrow: _narrow, match: _match, cursor: _cursor, ...next } = out
  if (decl) {
    if (typeof decl.scope === 'string') next.scope = decl.scope
    if (someWhere(queryWhere)) next.where = queryWhere
    if (decl.sort !== undefined && decl.sort !== null) next.sort = decl.sort
    if (isCount(decl.limit)) next.limit = decl.limit
  }
  const narrow = {}
  if (someWhere(where)) narrow.where = where
  if (sort !== undefined && sort !== null && sort !== '') narrow.sort = sort
  if (isCount(limit)) narrow.limit = limit
  if (Object.keys(narrow).length > 0) next.narrow = narrow
  return next
}

/** A where-object that says something: a non-empty plain object. */
function someWhere(where) {
  return Boolean(where) && typeof where === 'object' && !Array.isArray(where) && Object.keys(where).length > 0
}

/** A `limit` that cuts: a number above 0. `0` and anything else mean every record. */
function isCount(limit) {
  return typeof limit === 'number' && limit > 0
}

/**
 * The binding key of a fetch config — the `content.data.<key>` a component reads.
 *
 * ⭐ **`as` is the name.** It was called `schema` until 2026-09-02, which
 * collided with the MODEL REF of the same name on a `queries` declaration — one
 * word for two things, which is what let a binding-key override silently break
 * detail resolution.
 *
 * ⛔ **The `?? cfg.schema` alias that briefly rode alongside it is GONE**
 * (2026-09-02, ruled by Diego: *"they are not in prod so I saw no point in it.
 * We need to move forward."*). It was removed in the same pass as frontend's and
 * hosting's, and every producer here now emits `as` alone.
 *
 * ⚠️ **The consequence, stated plainly: a payload synced before that carries
 * `schema` and resolves to NOTHING here.** No data, no error — this is the
 * silent class, and the remedy is a re-push, not a code change. If a
 * seed or a dev site renders a section empty, check what its stored payload
 * spells before looking anywhere else.
 *
 * ⭐ The one place `schema` is still read is `parseFetchConfig` in
 * `@uniweb/build`, and it is a different thing: normalizing an AUTHOR's older
 * spelling in a content file at the boundary, so that one name travels inside.
 *
 * @param {Object} cfg
 * @returns {string|undefined}
 */
function bindingKey(cfg) {
  return cfg?.as
}

/**
 * One fetch entry as the runtime reads it. ⭐ **A STRING IS A QUERY NAME, and `as`
 * DEFAULTS TO THE QUERY'S NAME — on every lane** (ruled 2026-09-13 [Diego]: *"a string
 * is a query name, so, `fetch: "members"` … means `fetch: {query: "members"}`"*, and
 * *"`as` defaults to `query`"*). The build writes both out when it parses a content
 * file (`parseFetchConfig`), so a static payload never needs this. A payload a backend
 * publishes carries a page's and a section's `fetch` as stored — where a bare `"people"`
 * and a `{ query }` with no `as` are ordinary — and ⛔ **both were skipped here, for
 * having no `as`, until 2026-09-14** (measured): a hosted section bound that way
 * received nothing, and a parametric page whose parent named its query that way had no
 * route query.
 *
 * A string that is not a query name — a path, a data file — is not one: `/data/…` is
 * never authored (the build refuses it), and guessing at it here would fetch a file no
 * query declares.
 *
 * @param {*} entry - a string, an object, or anything else a stored `fetch` holds
 * @returns {Object|null} the entry with its `as`, or null when it is not a fetch
 */
function fetchEntry(entry) {
  if (typeof entry === 'string') {
    const name = entry.trim()
    return name && !/[\\/]|\.(json|ya?ml)$/i.test(name) ? { query: name, as: name } : null
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  if (entry.as === undefined && typeof entry.query === 'string' && entry.query) return { ...entry, as: entry.query }
  return entry
}

/**
 * A `fetch` as the runtime reads it — one entry, several, or none — each through
 * `fetchEntry`, so a string and a `{ query }` with no `as` are read as the query they name.
 *
 * @param {*} fetch - a level's `fetch`, as a payload carries it
 * @returns {Array<Object>}
 */
export function fetchEntries(fetch) {
  if (!fetch) return []
  return (Array.isArray(fetch) ? fetch : [fetch]).map(fetchEntry).filter(Boolean)
}

/**
 * Resolve the applicable fetch configs from an ordered list of sources.
 *
 * The rule: walk the sources in precedence order and take the FIRST match per
 * schema. Sources are the framework's cascade, most specific first — typically
 * section → page → parent page → site. A source may be a single config or an
 * array of them; arrays are walked in order.
 *
 * First-match-per-schema (rather than first-match-wins-outright) is what lets
 * a page needing two schemas inherit one from the site and declare the other
 * itself. Collapsing that to a single winner is a real behavior change, not a
 * simplification.
 *
 * @param {Array<Object|Array<Object>>} sources - ordered, most specific first.
 *   Falsy entries are skipped, so callers can pass optional levels directly.
 * @param {Object} [options]
 * @param {string[]} [options.schemas] - restrict to these schema names.
 *   Empty (the default) collects every schema found.
 * @param {string|null} [options.locale] - the locale being rendered
 * @param {string|null} [options.defaultLocale] - the site's default locale
 * @param {Object|null} [options.queries] - the site's `config.queries`
 * @param {Object|null} [options.services] - the site's `config.services`. The
 *   `records` row is a host's live-records lane; absent means the compiled
 *   artifact answers, which is the whole of what a site with no backend needs.
 * @param {Object|null} [options.variables] - the route's variables on a parametric
 *   page (`routeBinding` in `./route-match.js`: `{ path, dir, slug }` under every
 *   folder form); a `:path` / `:dir` / `:slug` placeholder in `where:` or
 *   `scope:` binds to them, and an unbound or empty one drops its clause. Null
 *   off a parametric page.
 * @returns {Map<string, Object>} schema name → resolved config
 */
export function resolveFetchConfigs(sources, options = {}) {
  const {
    schemas = [],
    locale = null,
    defaultLocale = null,
    queries = null,
    services = null,
    variables = null,
  } = options

  const configs = new Map()
  const collectAll = schemas.length === 0

  for (const source of sources) {
    for (const cfg of fetchEntries(source)) {
      const key = bindingKey(cfg)
      if (!key) continue
      if (configs.has(key)) continue
      if (!collectAll && !schemas.includes(key)) continue
      // Address first: localization and deferred-detail both key on `path`,
      // which a query ref does not have until this runs.
      const sourced = resolveQuerySource(cfg, services, { queries, locale, defaultLocale })
      const localized = localizeConfig(sourced, locale, defaultLocale)
      const bound = dropRootScope(bindRouteVariables(localized, variables))
      configs.set(key, stampDepthAndLocale(applyDeferredDetail(bound, queries), locale, defaultLocale))
    }
  }

  return configs
}

/**
 * The three route variables a query may reference, and only these — `:path`,
 * `:dir`, `:slug` — as a VALUE in `where:` or as the whole `scope:`. Ruled
 * 2026-09-04 [Diego] and again 2026-09-11 (no `:name` under a `[name]` folder):
 * standard names, never author-chosen; a placeholder fills a value, never a key
 * or an operator, never `schema`.
 */
const ROUTE_VARIABLE = /^:(path|dir|slug)$/

/** A variable with no value, or an empty one, binds nothing: its clause drops. */
function unset(value) {
  return value === undefined || value === null || value === ''
}

/**
 * Bind a query's route placeholders from the page's variables.
 *
 * ⭐ UNBOUND ⇒ THE CLAUSE DROPS. That is what lets ONE saved query serve both
 * the list page and the parametric page: `where: { tag: :dir }` narrows on
 * `/blog/rust/my-post` and vanishes on `/blog`, where there is no `:dir`. ⭐ **An
 * EMPTY variable drops its clause too** *(ruled 2026-09-11 [Diego])* — `:dir` on a
 * one-segment URL means "no directory", not "a directory named nothing". It bound
 * the empty string until then, so `where: { tag: :dir }` filtered `tag == ''` on
 * `/blog/my-post`, and `scope: :dir` split a cache entry the list page shared.
 *
 * ⚠️ The price, stated where it is paid: a MISSPELLED variable is byte-identical
 * to an intentional list page. Only an authoring surface can catch that; this
 * function cannot.
 *
 * ⭐ Both levels bind: the query's `scope` and `where`, and the fetch's own `where`
 * inside `narrow` — a variable may be a value in either (`setAndNarrow`). A `narrow`
 * left with nothing in it is dropped, so it cannot split a cache entry from the fetch
 * that takes the whole set.
 *
 * @param {Object} cfg - a resolved config
 * @param {Object|null} variables - `{ path, dir, slug, … }` from the route, or null off a parametric page
 * @returns {Object} the config, with placeholders bound or their clauses dropped
 */
function bindRouteVariables(cfg, variables) {
  let out = cfg
  if (typeof cfg.scope === 'string' && ROUTE_VARIABLE.test(cfg.scope)) {
    const name = cfg.scope.slice(1)
    const value = variables?.[name]
    const { scope, ...rest } = out
    out = unset(value) ? rest : { ...rest, scope: String(value) }
  }
  if (cfg.where && typeof cfg.where === 'object') {
    const bound = bindWhere(cfg.where, variables)
    if (bound !== cfg.where) {
      const { where, ...rest } = out
      out = bound === null ? rest : { ...rest, where: soleMember(bound) }
    }
  }
  const narrowWhere = cfg.narrow?.where
  if (narrowWhere && typeof narrowWhere === 'object') {
    const bound = bindWhere(narrowWhere, variables)
    if (bound !== narrowWhere) {
      const { where, ...narrowRest } = out.narrow
      const narrow = bound === null ? narrowRest : { ...narrowRest, where: soleMember(bound) }
      const { narrow: _unbound, ...rest } = out
      out = Object.keys(narrow).length > 0 ? { ...rest, narrow } : rest
    }
  }
  return out
}

/**
 * An `and` or `or` left holding ONE member once its unbound clauses dropped is that
 * member — so an authored `{ and: [ { tag: :dir }, { featured: true } ] }` asks the
 * list page, where `:dir` is unbound, `{ featured: true }`: the same question, and the
 * same cache entry, as the where written without the routed clause.
 */
function soleMember(where) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return where
  const keys = Object.keys(where)
  if (keys.length !== 1 || (keys[0] !== 'and' && keys[0] !== 'or')) return where
  const members = where[keys[0]]
  return Array.isArray(members) && members.length === 1 ? members[0] : where
}

/** Walk a where-object: bind `:var` VALUES, drop clauses whose variable is unbound. */
function bindWhere(where, variables) {
  if (Array.isArray(where)) {
    let changed = false
    const next = []
    for (const item of where) {
      const b = item && typeof item === 'object' ? bindWhere(item, variables) : item
      if (b !== item) changed = true
      if (b !== null) next.push(b)
    }
    if (!changed) return where
    return next.length ? next : null
  }
  if (!where || typeof where !== 'object') return where
  let changed = false
  const next = {}
  for (const [key, value] of Object.entries(where)) {
    if (typeof value === 'string' && ROUTE_VARIABLE.test(value)) {
      const bound = variables?.[value.slice(1)]
      changed = true
      if (unset(bound)) continue // unbound or empty ⇒ drop
      next[key] = String(bound)
      continue
    }
    if (value && typeof value === 'object') {
      const b = bindWhere(value, variables)
      if (b !== value) changed = true
      if (b === null) continue // an operator object or sub-predicate emptied out
      next[key] = b
      continue
    }
    next[key] = value
  }
  if (!changed) return where
  return Object.keys(next).length ? next : null
}

/**
 * ⭐ `scope:` IS ITS OWN FIELD, on both lanes. The service takes it natively; on
 * the compiled file the evaluators apply it to each record's placement (`path`,
 * the folder `records.yml` put it in) — `@uniweb/core`'s `applyScope`, the one the
 * build uses too. ⛔ Until 2026-09-11 it was folded here into
 * `where: { path: { under } }`, an authored form that is now retired in its
 * favour [Diego]: a branch is a scope, and `where` stays the author's predicate.
 *
 * The root contains everything, so an empty scope is no scope — dropped rather
 * than carried, so it cannot split a cache entry from the same query without one.
 */
function dropRootScope(cfg) {
  if (typeof cfg.scope !== 'string' || cfg.scope.replace(/^\/+|\/+$/g, '') !== '') return cfg
  const { scope, ...rest } = cfg
  return rest
}

/** Does this where-value hold a route variable anywhere inside it? */
function holdsRouteVariable(value) {
  if (typeof value === 'string') return ROUTE_VARIABLE.test(value)
  if (Array.isArray(value)) return value.some(holdsRouteVariable)
  if (value && typeof value === 'object') return Object.values(value).some(holdsRouteVariable)
  return false
}

/**
 * The part of a where-object that depends on the route — its top-level clauses
 * holding a route variable anywhere inside them — or null. The compiled file's
 * build cannot evaluate those (a file is written once; the route differs per
 * page), so the runtime applies them, bound per page.
 *
 * @param {Object|null} where
 * @returns {Object|null}
 */
function routeVariableClauses(where) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return null
  const out = {}
  for (const [key, value] of Object.entries(where)) {
    if (holdsRouteVariable(value)) out[key] = value
  }
  return Object.keys(out).length ? out : null
}

/**
 * A named query's narrowing that is FIXED for every page — the top-level `where`
 * clauses that hold no route variable, and its `scope` unless that is routed. The
 * build applies the `where` part when it compiles `/data/<query>.json` (it leaves
 * `scope` to the runtime, which applies it with the rest of the query); the rest is exactly
 * `routeVariableClauses`, which the runtime binds per page (`resolveQuerySource`
 * carries it there). A clause is split at the TOP level and never inside: an `or`
 * holding one variable goes to the runtime whole, because applying half of it at
 * build would drop records the bound `or` keeps.
 *
 * @param {{ where?: Object, scope?: string }} query
 * @returns {{ where: Object|null, scope: string|null }}
 */
export function withoutRouteVariables({ where = null, scope = null } = {}) {
  let fixed = null
  if (where && typeof where === 'object' && !Array.isArray(where)) {
    const out = {}
    for (const [key, value] of Object.entries(where)) {
      if (!holdsRouteVariable(value)) out[key] = value
    }
    fixed = Object.keys(out).length ? out : null
  }
  const fixedScope = typeof scope === 'string' && !ROUTE_VARIABLE.test(scope) && scope.replace(/^\/+|\/+$/g, '') !== ''
    ? scope
    : null
  return { where: fixed, scope: fixedScope }
}

/**
 * ⭐ THE SET — the records a route query selects, and the list a parametric page finds
 * its record in and its pages are made from: the config as the query saved it, without
 * the fetch's `narrow`. Its `sort` and `limit` are the query's and stay, because a
 * query's `limit` is part of what it selects (ruled 2026-09-14 [Diego]): a parametric
 * page has a URL for each record of its route query's set, and no other — a field
 * note older than the 100 most recent has no page under a query of the 100 most
 * recent. A fetch's narrowing never decides which pages exist: `limit: 3` on `/blog`
 * leaves `/blog/d` a record, when the query selects it.
 *
 * ⛔ Until 2026-09-14 this dropped the `limit` of a merged config instead — the fetch's
 * or the query's, indistinguishable once merged — so every record the query's `where`
 * selected had a page, whatever its `limit`, and a fetch's `where` did decide. The
 * records service's record question dropped `sort` and `limit` to the same effect.
 *
 * @param {Object} cfg - a resolved config
 * @returns {Object} the config itself when it has no `narrow`, else a copy without it
 */
export function routeSelection(cfg) {
  if (!cfg || typeof cfg !== 'object' || cfg.narrow === undefined) return cfg
  const { narrow, ...set } = cfg
  return set
}

/**
 * ⭐ DOES THE SITE'S BINDING REACH THIS PAGE'S SECTIONS? — ruled 2026-09-13 [Diego]:
 * *"Site is basically a virtual root page"*, *"meant to reach the layout pseudo-pages
 * and sections because they belong to the site. and it's meant to reach the root
 * pages."* So it reaches what a page's binding would if the site were the parent of
 * the pages directly under it: a page with no parent page — a top-level page, the
 * homepage included — and a layout area, which has none either. ⛔ Until then it
 * reached every section on every page.
 *
 * Nothing is restructured: every lane keeps the site's fetch as the last level of
 * its walk, and passes it for these pages only.
 *
 * @param {Object|null|undefined} parent - the page's parent page (by `parentRouteOf`), or null
 * @returns {boolean}
 */
export function siteReaches(parent) {
  return !parent
}

/** A `fetch` as a list: one declaration, several, or none — each read as the runtime reads it. */
function fetchList(fetch) {
  return fetchEntries(fetch)
}

/**
 * Every section-level `fetch` on a page, nested sections included — the input
 * `routeQuery` falls back to. Plain data, so a caller holding a content document
 * and a caller holding the object graph (`page._bodySections`) pass the same thing.
 *
 * @param {Array<Object>|undefined} sections - a page's raw sections
 * @returns {Array<Object|Object[]>}
 */
export function sectionFetches(sections) {
  const out = []
  const walk = (list) => {
    for (const s of list || []) {
      if (!s || typeof s !== 'object') continue
      if (s.fetch) out.push(s.fetch)
      if (Array.isArray(s.subsections)) walk(s.subsections)
    }
  }
  walk(sections)
  return out
}

/**
 * ⭐ THE ROUTE QUERY of a parametric page — the query its URL names ONE record of,
 * and so the binding key the record is delivered under. The rule, ruled
 * 2026-09-11 [Diego]:
 *
 *   1. the page's own query, else its parent page's, else the site's — the first
 *      `as` of the closest of those that declares one;
 *   2. if none does, the key the page's own sections declare, when they all
 *      declare the same one;
 *   3. otherwise none: the page has no record, and nothing narrows.
 *
 * ⭐ WHY THE PAGE LEVEL CHOOSES, not each section: which URLs exist, the page's
 * title, not-found, the static build's expansion and a host's record index each
 * need ONE answer per page. Who RECEIVES the record is the four-level cascade: a
 * section the route key reaches — its own declaration of that key included —
 * gets the record, and its own query under another key is left as declared.
 *
 * ⛔ This replaces `parentSchema`, which our build computed from the closest
 * ancestor page with a query at ANY depth and never from the page's own query or
 * the site's — a different rule from the one sections are fed by, so the URL
 * narrowed nothing, or a key no section received (measured 2026-09-10).
 *
 * Plain data in, so every lane — the entity store, the SPA's parametric page, the
 * prefetch, the static build, a host — calls this and computes no copy.
 *
 * @param {Object} levels
 * @param {Object|Object[]|null} [levels.page] - the page's own `fetch`
 * @param {Object|Object[]|null} [levels.parent] - its parent page's `fetch` (by `parentRouteOf`)
 * @param {Object|Object[]|null} [levels.site] - the site's `fetch`
 * @param {Array<Object|Object[]>} [levels.sections] - the page's section `fetch`es (`sectionFetches`)
 * @returns {{ key: string, config: Object, level: 'page'|'parent'|'site'|'sections' } | null}
 */
export function routeQuery({ page = null, parent = null, site = null, sections = [] } = {}) {
  for (const [level, fetch] of [['page', page], ['parent', parent], ['site', site]]) {
    for (const cfg of fetchList(fetch)) {
      const key = bindingKey(cfg)
      if (key) return { key, config: cfg, level }
    }
  }
  let found = null
  for (const fetch of sections || []) {
    for (const cfg of fetchList(fetch)) {
      const key = bindingKey(cfg)
      if (!key) continue
      if (found && found.key !== key) return null // the sections disagree: no route query
      if (!found) found = { key, config: cfg, level: 'sections' }
    }
  }
  return found
}

/**
 * ⭐ THE ROUTE QUERY OF ANY PAGE ON A PARAMETRIC ROUTE — a nested one included.
 *
 * A route variable is captured by exactly one page: the `[slug]` or `[...path]`
 * folder's, whose route ends in it. A page nested inside that one —
 * `pages/members/[slug]/cv/`, routed `/members/:slug/cv` — names the same record,
 * so its route query is found by `routeQuery` AT THE CAPTURING PAGE: that page's own
 * query, its parent's, the site's, or its sections' shared key. Ruled 2026-09-13
 * [Diego]: *"a nested page shares the route query of the page that captured its
 * variable"*. ⛔ Until then every lane looked one parent up from the nested page,
 * found no query on the `[slug]` page, and `/members/alice/cv` had no record.
 *
 * A query the nested page declares under another key is its own data and changes
 * nothing about what `:slug` names. The caller hands the route binding to the nested
 * page's sections (`nested`), since the cascade reaches only one parent up.
 *
 * ⭐ THE SITE IS THE VIRTUAL ROOT PAGE (ruled 2026-09-13 [Diego]), so the site's
 * binding is a route query only for a capturing page with no parent page — a
 * top-level parametric page — the way a page's binding is its children's
 * (`siteReaches`). ⛔ Until then it was every parametric page's last fallback.
 *
 * Shape-agnostic: the object graph and a content document hand in their own
 * accessors, and every lane climbs by the one parent rule (`parentRouteOf`).
 *
 * @param {Object} page - the page, in the caller's shape
 * @param {Object} access
 * @param {(page: Object) => string} access.routeOf - its route PATTERN (a concrete page's template route)
 * @param {(page: Object) => Object|null} access.parentOf - its parent page, or null
 * @param {(page: Object) => Object|Object[]|null} access.fetchOf - its `fetch`
 * @param {(page: Object) => Array<Object>|undefined} access.sectionsOf - its raw sections
 * @param {Object|Object[]|null} [access.site] - the site's `fetch`
 * @returns {{ key: string, config: Object, level: string, capturing: Object, nested: boolean } | null}
 *   null off a parametric route, or when the capturing page has no route query
 */
export function pageRouteQuery(page, { routeOf, parentOf, fetchOf, sectionsOf, site = null }) {
  let capturing = page
  for (let depth = 0; capturing && recordRouteBase(routeOf(capturing)) === null; depth++) {
    if (depth > 64) return null // a parent cycle in a malformed payload
    capturing = parentOf(capturing)
  }
  if (!capturing) return null
  const parent = parentOf(capturing)
  const found = routeQuery({
    page: fetchOf(capturing),
    parent: parent ? fetchOf(parent) : null,
    site: parent ? null : site,
    sections: sectionFetches(sectionsOf(capturing)),
  })
  return found ? { ...found, capturing, nested: capturing !== page } : null
}

/**
 * ⭐ THE PAGE A QUERY'S RECORDS LINK TO — ruled 2026-09-14 [Diego]: *a rendered record
 * links to its query's page.* For each query, the parametric page whose ROUTE QUERY is
 * that query (`routeQuery`), the first in page order:
 *
 *   - **by the query's name, never by its schema** — a page over the same schema may not
 *     select the record, so its URL could name a record it answers "not found" for;
 *   - **a page nested inside a parametric page is not a record's page** — its route does
 *     not end in the parameter (`recordRouteBase`), so a record cannot fill it;
 *   - **no page, no link** — a query absent from the map has none.
 *
 * A fetch picks another page with `detailPage:`, which the caller resolves; this is
 * the page with none. ⛔ It replaces `route:` on a query, which the build baked into
 * compiled records as `route` — a field in the author's namespace, overwritten.
 *
 * Shape-agnostic, like `pageRouteQuery`: the object graph and a content document hand in
 * their own accessors, so the runtime, a host and the editor get one answer.
 *
 * @param {Array<Object>} pages - every page, in page order, in the caller's shape
 * @param {Object} access
 * @param {(page: Object) => string} access.routeOf - its route pattern
 * @param {(page: Object) => Object|null} access.parentOf - its parent page, or null
 * @param {(page: Object) => *} access.fetchOf - its `fetch`
 * @param {(page: Object) => Array<Object>|undefined} access.sectionsOf - its raw sections
 * @param {*} [access.site] - the site's `fetch`
 * @returns {Map<string, { page: Object, route: string, key: string }>} query name → its
 *   record page: the page, its route pattern, and the key its record is delivered under
 */
export function recordPages(pages, { routeOf, parentOf, fetchOf, sectionsOf, site = null }) {
  const out = new Map()
  for (const page of pages || []) {
    const route = routeOf(page)
    if (recordRouteBase(route) === null) continue
    const parent = parentOf(page)
    const found = routeQuery({
      page: fetchOf(page),
      parent: parent ? fetchOf(parent) : null,
      // the site's binding is a route query for a top-level page only (`siteReaches`)
      site: siteReaches(parent) ? site : null,
      sections: sectionFetches(sectionsOf(page)),
    })
    const name = found?.config?.query
    if (typeof name !== 'string' || !name || out.has(name)) continue
    out.set(name, { page, route, key: found.key })
  }
  return out
}

/**
 * Say what a resolved config will GET, so the record index can file it.
 *
 * `depth` — `brief` when the config has a per-record source (`detail`), because
 * a list with a separate record address is a list of partial records: a live
 * lane answers a list at brief depth and a record in full, and a `deferred:`
 * query's compiled file is the stripped list. `full` otherwise. An explicit
 * `depth` on the config wins (the records service's client sets it).
 *
 * `locale` — stamped on an ASKED config only. A compiled path already carries
 * its locale (`/fr/data/…`); the service is asked in one locale (it is in the
 * route), and two locales' answers must not share a cache entry.
 */
function stampDepthAndLocale(cfg, locale, defaultLocale) {
  let out = cfg
  if (typeof out.whole !== 'boolean') {
    out = { ...out, whole: !out.detail }
  }
  // The service is asked in exactly one locale — it is in the route — so the config
  // carries it whatever the locale is; two locales' answers never share an entry.
  if (out.ask && out.locale === undefined) {
    const asked = locale ?? defaultLocale
    if (asked) out = { ...out, locale: asked }
  }
  return out
}
