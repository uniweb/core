/**
 * Fetch-config resolution — the shared rule, in one place.
 *
 * "Which fetch configs apply here?" is a framework concept. Authors declare
 * `fetch:` at the section, page, folder and site levels; the framework decides
 * which declaration wins per schema, how a local data path is localized, and
 * when a collection with deferred fields gets a detail pattern injected.
 *
 * Every host that renders a page needs that answer — the browser runtime, the
 * build-time prerenderer, and any server-side renderer. The rule had grown
 * more than one implementation, and they had diverged in both directions (each
 * carrying a level or a semantic the other lacked). This module is the single
 * definition they call.
 *
 * INTENTIONALLY A LEAF: safe to load anywhere — including environments with no
 * DOM, no filesystem, and a hard bundle-size ceiling. The rule that protects
 * that is **no transitive graph**: import nothing from the package root (which
 * pulls semantic-parser and theming) and nothing that itself imports. A
 * zero-dependency sibling leaf is admissible and `./data-paths.js` is the only
 * one taken — the path convention it holds has to be identical here and in the
 * build that emits the files, and a second copy of that string is precisely
 * the drift this module exists to prevent.
 *
 * WHAT THIS DOES NOT OWN: where the sources come from. A caller holding a live
 * object graph reads them off the graph; a caller holding a content document
 * reads them off the JSON. Both hand the same ordered array to
 * `resolveFetchConfigs`. That difference is real and stays with the caller.
 */

import { collectionDataUrl, isDataUrl, recordDataUrl } from './data-paths.js'
import { resolveCollectionAddress, resolveRecordAddressPattern } from './collection-address.js'

/**
 * Is this fetch declaration a per-instance *refinement* of an ancestor's
 * config rather than a new source of its own?
 *
 * The canonical spelling is `refine: true`. The legacy spelling `inherit: true`
 * is still honored; callers that want to warn about it should test for the key
 * themselves — this predicate stays silent so it is safe in any environment.
 *
 * @param {Object} cfg - a fetch declaration
 * @returns {boolean}
 */
export function isFetchRefinement(cfg) {
  return cfg?.refine === true || cfg?.inherit === true
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
 * Auto-inject `detail:` on a collection ref whose collection declares
 * `deferred:` fields.
 *
 * A deferred collection ships a lean list payload, so the full record has to
 * come from somewhere else. Two patterns, picked by what the collection
 * declares:
 *
 *   - the collection has `detailUrl:` → use it verbatim (a remote source);
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
 * requirement, so a caller that does not have collection metadata still gets
 * a usable config. That matters for hosts whose content projection may not
 * carry collection metadata at all.
 *
 * @param {Object} cfg
 * @param {Object|null} queries - the site's `config.queries` map
 * @returns {Object} the original config, or a copy carrying `detail`
 */
function applyDeferredDetail(cfg, queries, records) {
  if (cfg.detail !== undefined) return cfg

  // ⭐ A lane's record address is injected whenever the lane declares one —
  // NOT only for a `deferred:` collection, and the difference is load-bearing.
  //
  // A live lane answers a list request at brief depth and a record request in
  // full, so a detail page that filtered the list would render the brief and
  // silently miss the body. And it cannot fall back to the rule below: the
  // `deferred:` declaration lives in `config.queries`, which a host's
  // projection is not obliged to carry — so on such a host that rule can never
  // fire, and this is the only way a detail page reaches a whole record.
  if (cfg.endpoint) {
    const recordPattern = resolveRecordAddressPattern(cfg.query ?? cfg.schema, records)
    if (recordPattern) return { ...cfg, detail: recordPattern }
  }

  const schema = cfg.schema
  if (!schema || !queries) return cfg
  const collConfig = queries[schema]
  if (!collConfig || typeof collConfig !== 'object') return cfg
  const deferred = Array.isArray(collConfig.deferred) ? collConfig.deferred : null
  if (!deferred || deferred.length === 0) return cfg
  const pattern = typeof collConfig.detailUrl === 'string'
    ? collConfig.detailUrl
    : recordDataUrl(schema, '{slug}')
  return { ...cfg, detail: pattern }
}

/**
 * Resolve a query reference to something the fetcher can call.
 *
 * ⚠️ THE FIELD IS `collection` ON THE WIRE, and stays so — it is on the backend's
 * Model and not framework's to rename. The AUTHORING name is `query:`
 * (queries.yml); the build crosses the two, the way it crosses `detailUrl` and
 * `detail_url`.
 *
 * The author names a query; this decides where its records live, and there are
 * exactly two answers:
 *
 *   - a host declared a live lane (`config.records`) → an `endpoint`, final on
 *     arrival, which the fetcher calls without composing anything further;
 *   - nobody did → the `path` of the artifact the build emitted.
 *
 * ⭐ The second is not a fallback in the apologetic sense. It is the answer for
 * every site with no backend, which is the framework's default rather than a
 * degraded mode — so an absent lane is silent, not warned.
 *
 * ⭐ `collection` OUTRANKS a `path` sitting beside it, which matters because the
 * sync producer emits both during the transition — `collection` for a consumer
 * that resolves it, `path` for one that has not been taught to yet. Resolving
 * whenever `collection` is present is also what the build-time parser has always
 * done (`parseFetchConfig` returns early on `collection`, ignoring any `path`),
 * so the two agree rather than disagreeing on a shape nobody hand-writes.
 */
function resolveCollectionSource(cfg, records) {
  if (typeof cfg.query !== 'string' || cfg.query.length === 0) return cfg

  const endpoint = resolveCollectionAddress(cfg.query, records)
  if (endpoint) {
    // Drop the transitional `path`: two addresses on one request is an
    // ambiguity the fetcher would have to break by accident of field order.
    const { path, url, ...rest } = cfg
    return { ...rest, endpoint }
  }
  return { ...cfg, path: collectionDataUrl(cfg.query) }
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
 * @param {Object|null} [options.records] - the site's `config.records`, a host's
 *   live-collection lane. Absent means the compiled artifact answers, which is
 *   the whole of what a site with no backend needs.
 * @returns {Map<string, Object>} schema name → resolved config
 */
export function resolveFetchConfigs(sources, options = {}) {
  const {
    schemas = [],
    locale = null,
    defaultLocale = null,
    queries = null,
    records = null,
  } = options

  const configs = new Map()
  const collectAll = schemas.length === 0

  for (const source of sources) {
    if (!source) continue
    const configList = Array.isArray(source) ? source : [source]
    for (const cfg of configList) {
      if (!cfg?.schema) continue
      if (configs.has(cfg.schema)) continue
      if (!collectAll && !schemas.includes(cfg.schema)) continue
      // Address first: localization and deferred-detail both key on `path`,
      // which a query ref does not have until this runs.
      const sourced = resolveCollectionSource(cfg, records)
      const localized = localizeConfig(sourced, locale, defaultLocale)
      configs.set(cfg.schema, applyDeferredDetail(localized, queries, records))
    }
  }

  return configs
}
