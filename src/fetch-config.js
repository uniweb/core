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

/**
 * Is this fetch declaration a per-instance *refinement* of an ancestor's
 * config rather than a new source of its own?
 *
 * The spelling is `refine: true`. Its earlier alias, `inherit: true`, was
 * accepted with a warning from April 2026 and removed on 2026-09-02: the build
 * refuses it with an error, and `EntityStore` refuses it in dev. This predicate
 * stays silent so it is safe in any environment.
 *
 * @param {Object} cfg - a fetch declaration
 * @returns {boolean}
 */
export function isFetchRefinement(cfg) {
  return cfg?.refine === true
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
 * Auto-inject `detail:` on a query ref whose query declares
 * `deferred:` fields.
 *
 * A deferred query ships a lean list payload, so the full record has to
 * come from somewhere else. Two patterns, picked by what the query
 * declares:
 *
 *   - the query has `detailUrl:` → use it verbatim (a remote source);
 *   - otherwise → `/data/<schema>/{slug}.json`, the per-record file emitted
 *     alongside the lean list.
 *
 * Conventions carried from the original implementation:
 *   - Per-record sources are keyed by `item.slug`, and the injected pattern
 *     uses the `{slug}` placeholder. Substitution works when the dynamic
 *     route's paramName is `slug` (the documented convention); a route using
 *     another param name needs an explicit author-written `detail:`.
 *   - Per-record files are not currently localized. A site needing localized
 *     a deferred query writes its own `detail:` URL.
 *
 * An author-supplied `cfg.detail` always wins; this only fills the default.
 * With no `queries` map available the config passes through untouched —
 * deferred-detail injection is an enhancement, never a correctness
 * requirement, so a caller that does not have query metadata still gets
 * a usable config. That matters for hosts whose content projection may not
 * carry query metadata at all.
 *
 * @param {Object} cfg
 * @param {Object|null} queries - the site's `config.queries` map
 * @returns {Object} the original config, or a copy carrying `detail`
 */
function applyDeferredDetail(cfg, queries) {
  if (cfg.detail !== undefined) return cfg

  // The records service answers a RECORD by the same question narrowed to it,
  // so every asked config has a detail source; `buildDetailConfig` composes it.
  if (cfg.ask) return { ...cfg, detail: true }


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
  const pattern = typeof collConfig.detailUrl === 'string'
    ? collConfig.detailUrl
    : recordDataUrl(queryName, '{slug}')
  return { ...cfg, detail: pattern }
}

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

  // ⭐ THE SERVICE FIRST. A host that answers questions gets the whole query —
  // `schema`, `scope`, `where`, `sort`, `limit`, `depth` — and composes no
  // per-query address at all (the records contract, §2). It needs the query's
  // MODEL REF, which lives on the site's `config.queries` declaration; a
  // payload that offers the service but carries no declaration cannot ask, and
  // says so. ⚠️ Dark until a host stamps the row; see `resolveRecordsService`.
  const ask = resolveRecordsService(services, locale ?? defaultLocale)
  if (ask) {
    const schema = typeof decl?.schema === 'string' && decl.schema ? decl.schema : null
    // Drop the transitional `path`: two addresses on one request is an
    // ambiguity the fetcher would have to break by accident of field order.
    const { path, url, ...rest } = cfg
    if (!schema) {
      // ⛔ LOUD, not a fallthrough. A payload that offers the service and carries no
      // Model ref for the query cannot ask, and reading the compiled file
      // instead would turn a producer defect into a 404 that names the wrong
      // thing. The fetcher refuses an asked request with no `schema` before any
      // request is made, and the block's `dataError` says exactly this.
      return { ...rest, ask, schema: null }
    }
    const asked = { ...rest, ask, schema }
    // A saved query's own narrowing applies unless the fetch overrides it.
    if (asked.scope === undefined && typeof decl.scope === 'string') asked.scope = decl.scope
    if (asked.where === undefined && decl.where && typeof decl.where === 'object') asked.where = decl.where
    if (asked.sort === undefined && decl.sort !== undefined && decl.sort !== null) asked.sort = decl.sort
    if (asked.limit === undefined && typeof decl.limit === 'number' && decl.limit > 0) asked.limit = decl.limit
    return asked
  }

  // ⭐ THE COMPILED FILE. The build applied the named query's fixed `where` when it
  // wrote `/data/<query>.json`; what it could NOT apply is a clause bound to the
  // route (`where: { tag: :dir }`) — a file is written once and the route differs
  // per page — and it never applies `scope`, fixed or routed. So those travel here
  // and are bound per page, exactly as they are on the service
  // (`bindRouteVariables`, below). A fetch's own `scope` / `where` win, as they do
  // there. ⛔ Until 2026-09-11 nothing travelled: a named query's `scope: :dir` was
  // ignored on this lane and `where: { tag: :dir }` was applied at build to the
  // literal `':dir'`, compiling to no records (measured).
  const out = { ...cfg, path: queryDataUrl(cfg.query) }
  if (decl) {
    if (out.scope === undefined && typeof decl.scope === 'string') out.scope = decl.scope
    if (out.where === undefined) {
      const routed = routeVariableClauses(decl.where)
      if (routed) out.where = routed
    }
  }
  return out
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
    if (!source) continue
    const configList = Array.isArray(source) ? source : [source]
    for (const cfg of configList) {
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
      out = bound === null ? rest : { ...rest, where: bound }
    }
  }
  return out
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
 * `scope` to the runtime, so a page's own can replace it); the rest is exactly
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

/** A `fetch` as a list: one declaration, several, or none. */
function fetchList(fetch) {
  if (!fetch) return []
  return Array.isArray(fetch) ? fetch.filter(Boolean) : [fetch]
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
      if (isFetchRefinement(cfg)) continue
      const key = bindingKey(cfg)
      if (key) return { key, config: cfg, level }
    }
  }
  let found = null
  for (const fetch of sections || []) {
    for (const cfg of fetchList(fetch)) {
      if (isFetchRefinement(cfg)) continue
      const key = bindingKey(cfg)
      if (!key) continue
      if (found && found.key !== key) return null // the sections disagree: no route query
      if (!found) found = { key, config: cfg, level: 'sections' }
    }
  }
  return found
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
