/**
 * EntityStore
 *
 * Walks the block→page→parent→site cascade to find applicable fetch configs,
 * asks the Website's FetcherDispatcher to execute them, and assembles the
 * data payload passed to `prepare-props`.
 *
 * The cascade, localization, detail-query handling, and list-first
 * content-gate logic all live here — unchanged from the pre-refactor model.
 * What changed: EntityStore no longer talks to DataStore directly. It calls
 * `website.fetcher.peek(request, ctx)` for the sync path (resolve) and
 * `website.fetcher.dispatch(request, ctx)` for the async path (fetch).
 * The dispatcher owns fetcher selection, cache-key derivation, cache lookup,
 * and in-flight dedup.
 */

import { resolveFetchConfigs, fetchEntries, pageRouteQuery, routeSelection, currentOf, othersView, othersOf, siteReaches } from './fetch-config.js'
import { fillRoutePattern, matchesRouteParam } from './route-match.js'
import { buildDetailConfig } from './detail-url.js'

/**
 * The binding keys a level's `fetch` declares — `as`, which is the query's name when
 * none is written, and a string entry is a query name (`fetchEntries`).
 */
const bindingKeysOf = (fetch) => fetchEntries(fetch).map((cfg) => cfg.as).filter(Boolean)

export default class EntityStore {
  /**
   * @param {Object} options
   * @param {import('./website.js').default} options.website
   * @param {boolean} [options.dev=false] - dev mode: a failed fetch is logged
   *   where the author is looking.
   */
  constructor({ website, dev = false }) {
    this.website = website
    this.dev = dev
    Object.seal(this)
  }

  /**
   * Which schemas does this component want delivered?
   *
   * - meta missing → default-on: collect all available schemas.
   * - meta.inheritData === false → opt out entirely.
   * - Anything else → collect all (legacy inheritData arrays collapse here).
   */
  _getRequestedSchemas(meta) {
    if (!meta) return []
    if (meta.inheritData === false) return null
    return []
  }

  /**
   * Walk the four-level hierarchy and collect fetch configs for the
   * requested schemas. First match per schema wins.
   *
   * This method's job is to read the four source slots off the object graph;
   * the rule applied to them (precedence, first-match-per-schema, locale
   * normalization, deferred-detail injection) lives in `./fetch-config.js`,
   * shared with every other host that has to answer the same question. Do not
   * re-inline it here — divergence between copies is what the extraction
   * exists to prevent.
   */
  _findFetchConfigs(block, requested, route = this._route(block)) {
    const blockFetch = block.fetch
    const page = block.page
    const website = block.website
    const dynamicContext = block.dynamicContext || page?.dynamicContext
    // The route's variables, for a query that binds `:path` / `:dir` / `:slug` —
    // `routeBinding`'s, carried as `params` by every parametric page this runtime
    // or its build makes. A page that carries only its capture gets the same three
    // names from it: one segment is `:slug` and `:path`, with no `:dir`.
    const variables = dynamicContext
      ? (dynamicContext.params ?? (dynamicContext.paramValue !== undefined
          ? {
              [dynamicContext.paramName]: dynamicContext.paramValue,
              path: dynamicContext.paramValue,
              dir: '',
              slug: dynamicContext.paramValue,
            }
          : null))
      : null

    return resolveFetchConfigs(
      [
        blockFetch,
        page?.fetch,
        page?.parent?.fetch,
        // ⭐ A page nested inside a parametric page receives its capturing page's
        // route binding — the cascade reaches one parent up, and the binding may sit
        // above that (`pageRouteQuery`). Its key only; the rest does not cascade.
        route?.nested ? route.config : null,
        // The site's binding reaches a layout section and a top-level page's
        // sections, and nothing deeper (`siteReaches`).
        siteReaches(page?.parent) ? website?.config?.fetch : null,
      ],
      {
        schemas: requested,
        locale: website?.getActiveLocale?.() ?? null,
        defaultLocale: website?.getDefaultLocale?.() ?? null,
        // ⚠️ `queries`, matching `resolveFetchConfigs`. This passed `collections`
        // after the payload key was renamed — a dead option name, silently: the
        // resolver simply saw no queries and stopped injecting `detail:`.
        queries: website?.config?.queries ?? null,
        // The host's services; its `records` row is the live-records lane.
        // Absent on every static site and on local dev, which is why
        // `resolveQuerySource` treats absence as the ordinary case and reads
        // the compiled artifact without comment.
        services: website?.config?.services ?? null,
        variables,
      },
    )
  }

  /**
   * The ROUTE QUERY of the block's page — the query its URL names one record of —
   * worked out from the same sources `_findFetchConfigs` walks, at the page that
   * captured the URL's variable (`pageRouteQuery`, `./fetch-config.js`): its fetch,
   * its parent's, the site's, and, when none of those declares one, the key its
   * sections share. So what a section receives and what the URL narrows are read
   * off one walk and cannot disagree.
   *
   * ⛔ This was `dynamicContext.schema`, stored on the page by whoever built it —
   * the SPA from `parentSchema`, the static build from the parent's first
   * prerendered fetch — a stored copy of a derived answer, computed by a different
   * rule from the one sections are fed by. Deleted 2026-09-11 [Diego].
   *
   * @returns {{ key: string, config: Object, nested: boolean }|null} null off a
   *   parametric page, or when it has no route query
   */
  _route(block) {
    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    if (!dynamicContext || !block.page) return null
    return pageRouteQuery(block.page, {
      // a concrete page carries its template's route; its ancestors are templates, or
      // pages the static build expanded, which carry theirs the same way
      routeOf: (p) => p?.dynamicContext?.templateRoute ?? p?.route,
      parentOf: (p) => p?.parent ?? null,
      fetchOf: (p) => p?.fetch,
      sectionsOf: (p) => p?._bodySections,
      site: block.website?.config?.fetch,
    })
  }

  /**
   * Post-process assembled records: for each fetch config that declares a
   * `detailPage` page-ref, resolve it to a locale route template (O(1), via the
   * Website's `_pageIdMap`) and inject a `route` on each record — so a dynamic-list
   * card links to the query's canonical detail page regardless of which page
   * the list sits on. Runs after `data` is fully assembled, in BOTH the sync (peek)
   * and async (fetch) paths. Replaces the old runtime `getQueryDetailRoute`
   * page-tree scan. A dangling `detailPage` (unresolvable ref) is a no-op — the
   * component degrades gracefully; records with a baked `route` (file lane) are kept.
   */
  _applyDetailRoutes(data, configs, website) {
    if (!data || !website?.resolveDetailPageTemplate) return
    for (const [schema, cfg] of configs) {
      if (!cfg.detailPage) continue
      const items = data[schema]
      if (!Array.isArray(items) || items.length === 0) continue
      const template = website.resolveDetailPageTemplate(cfg.detailPage)
      if (!template) continue
      data[schema] = items.map((item) => addDetailRoute(item, template))
    }
  }

  /**
   * Build a detail-URL fetch config from a query config + dynamic context.
   *
   * Delegates to the exported resolver so a host fetching this record
   * server-side reaches the identical rule — see `./detail-url.js` for why the
   * four `detail:` forms are a contract rather than an implementation detail.
   */
  _buildDetailConfig(queryConfig, dynamicContext) {
    return buildDetailConfig(queryConfig, dynamicContext)
  }

  /**
   * Build the `ctx` handed to the dispatcher for a given block.
   * @private
   */
  _ctx(block, extra = {}) {
    return {
      website: this.website,
      page: block?.page || null,
      block: block || null,
      signal: extra.signal,
    }
  }

  /**
   * Sync resolution — probes the cache via `fetcher.peek`. Returns
   * `ready` only when every relevant entry is cached, otherwise `pending`
   * (caller falls through to `fetch()` to populate and await).
   *
   * @returns {{ status: 'ready'|'pending'|'none', data: Object|null }}
   */
  resolve(block, meta) {
    const dispatcher = this.website?.fetcher
    let requested = this._getRequestedSchemas(meta)

    // If the component hasn't declared data inheritance but the block itself
    // has a fetch config, target the block's schema explicitly rather than
    // collecting all cascade matches.
    if (requested === null && block.fetch) {
      const schemas = bindingKeysOf(block.fetch)
      if (schemas.length > 0) requested = schemas
    }

    if (requested === null) return { status: 'none', data: null }

    const route = this._route(block)
    const configs = this._findFetchConfigs(block, requested, route)
    if (configs.size === 0) return { status: 'none', data: null }

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const ctx = this._ctx(block)

    const data = {}
    let allCached = true

    for (const [schema, cfg] of configs) {
      // `current:` applies under the key the page's URL narrows, and nowhere else.
      const current = dynamicContext && route && schema === route.key ? currentOf(cfg) : null
      if (current === 'exclude') {
        // The route query's records without this page's, `limit` counting the others.
        const cached = dispatcher?.peek(othersView(cfg), ctx)
        if (cached) {
          data[schema] = othersOf(cached.data, cfg, isPageRecord(dynamicContext))
        } else {
          allCached = false
        }
      } else if (current === 'only' && cfg.ask) {
        // The records service: the record's own answer is cached under its own key.
        const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
        const detailCached = detailCfg ? dispatcher?.peek(detailCfg, ctx) : null
        if (detailCached) {
          const answer = Array.isArray(detailCached.data) ? detailCached.data : (detailCached.data ? [detailCached.data] : [])
          data[schema] = answer.slice(0, 1)
        } else {
          allCached = false
        }
      } else if (current === 'only') {
        // Detail page: deliver the focused record as a length-1 array under the
        // query key. A deferred/remote query fetches the full per-record;
        // others use the matched record. Not found → []. Found in the route
        // query's set, never in a list a fetch narrowed (`routeSelection`).
        const cached = dispatcher?.peek(routeSelection(cfg), ctx)
        if (cached) {
          const { paramName, paramValue } = dynamicContext
          const items = cached.data
          const match = Array.isArray(items)
            ? items.find((item) => matchesRouteParam(item, paramName, paramValue))
            : null
          if (!match) {
            data[schema] = []
          } else if (cfg.detail) {
            // ⭐ Held in full already? Then it IS the record — no detail probe.
            // The list is materialized from the record index, so `match` is the
            // record at its latest depth; the index says which depth that is.
            const held = heldWhole(dispatcher, match)
            const detailCfg = held ? null : this._buildDetailConfig(cfg, { ...dynamicContext, record: match })
            const detailCached = detailCfg ? dispatcher?.peek(detailCfg, ctx) : null
            if (held) {
              data[schema] = [held]
            } else if (detailCfg && detailCached) {
              data[schema] = [detailCached.data]
            } else if (detailCfg) {
              allCached = false
            } else {
              data[schema] = [match]
            }
          } else {
            data[schema] = [match]
          }
        } else {
          allCached = false
        }
      } else {
        // Any other key — and `current: include`, the route query's list as the
        // binding describes it, this page's record among the rest.
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          data[schema] = cached.data
        } else {
          allCached = false
        }
      }
    }

    if (allCached) {
      this._applyDetailRoutes(data, configs, block.website)
      return { status: 'ready', data }
    }
    return { status: 'pending', data: null }
  }

  /**
   * Async fetch — dispatches missing configs through the FetcherDispatcher
   * and assembles the result. List-first detail ordering preserved.
   *
   * ⛔ A FAILED FETCH DELIVERS NOTHING UNDER ITS KEY, AND SAYS SO. Until 2026-09-04
   * a failure wrote `[]` into `content.data` — the fetcher returns `{ data: [], error }`,
   * `[]` is neither `undefined` nor `null`, and nothing read `error` — so a key
   * whose request failed was indistinguishable from one that succeeded with no
   * records, by the framework's own rule that `[]` is a value. Now the key is
   * ABSENT from `data`, the message is on `errors[key]`, and in dev it is logged
   * where the author is looking. A detail fetch that fails keeps the record the
   * list already matched (the brief) rather than clobbering it.
   *
   * @param {Object} [options]
   * @param {AbortSignal} [options.signal] - Forwarded to the dispatcher.
   * @returns {Promise<{ data: Object|null, errors: Object|null }>} `data` keyed by
   *   binding key; `errors` keyed the same way, `null` when every fetch succeeded.
   */
  async fetch(block, meta, { signal } = {}) {
    const dispatcher = this.website?.fetcher
    if (!dispatcher) return { data: null, errors: null }

    let requested = this._getRequestedSchemas(meta)
    if (requested === null && block.fetch) {
      const schemas = bindingKeysOf(block.fetch)
      if (schemas.length > 0) requested = schemas
    }
    if (requested === null) return { data: null, errors: null }

    const route = this._route(block)
    const configs = this._findFetchConfigs(block, requested, route)
    if (configs.size === 0) return { data: null, errors: null }

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const ctx = this._ctx(block, { signal })

    const data = {}
    const errors = {}
    const parallelFetches = []
    const fail = (key, cfg, message) => {
      errors[key] = message
      reportFetchFailure(this.dev, block, key, cfg, message)
    }

    for (const [schema, cfg] of configs) {
      // `current:` applies under the key the page's URL narrows, and nowhere else.
      const current = dynamicContext && route && schema === route.key ? currentOf(cfg) : null
      if (current === 'exclude') {
        // The route query's records without this page's, the fetch's `limit` counting
        // the others: its `narrow.limit` asked one higher (`othersView`), so removing
        // the record still leaves enough.
        const view = othersView(cfg)
        parallelFetches.push(dispatcher.dispatch(view, ctx).then((result) => {
          if (result?.error) {
            fail(schema, view, result.error)
            return
          }
          if (result?.data !== undefined && result?.data !== null) {
            data[schema] = othersOf(result.data, cfg, isPageRecord(dynamicContext))
          }
        }))
      } else if (current === 'only' && cfg.ask) {
        // ⭐ THE RECORDS SERVICE needs no list to find the record: the record is the
        // route query's set narrowed by the route's handle, so its one question
        // answers the record if the set holds it and `[]` if not — no client-side
        // scan gating the fetch (F13, the live half).
        //
        // ⛔ The list was asked beside it until 2026-09-14, for the record index to
        // file its briefs, while the record question dropped the query's `sort` and
        // `limit` and so could not say whether the set held the record. It checks the
        // set now, and the list sent the whole set to render one record of it.
        const detailCfg = this._buildDetailConfig(cfg, dynamicContext)
        parallelFetches.push(dispatcher.dispatch(detailCfg, ctx).then((result) => {
          if (result?.error) {
            fail(schema, detailCfg, result.error)
            return
          }
          const answer = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : [])
          data[schema] = answer.slice(0, 1) // a route resolves to ONE; `[]` is not found
        }))
      } else if (current === 'only') {
        // Detail page: focused record as a length-1 array under the query key,
        // found in the route query's set (`routeSelection`) — a record past a
        // fetch's `limit` still has its page, and one past the query's has none.
        const { paramName, paramValue } = dynamicContext
        const selection = routeSelection(cfg)

        let records = peekArray(dispatcher, selection, ctx)
        if (records === null) {
          const result = await dispatcher.dispatch(selection, ctx)
          if (result?.error) {
            fail(schema, selection, result.error)
            continue
          }
          records = Array.isArray(result?.data) ? result.data : null
        }

        const match = records?.find(
          (item) => matchesRouteParam(item, paramName, paramValue)
        ) ?? null

        if (!match) {
          data[schema] = []
          continue
        }

        const held = cfg.detail ? heldWhole(dispatcher, match) : null
        if (held) {
          // R1: the record index holds it in full — a detail fetch would only
          // re-fetch what the page already has.
          data[schema] = [held]
        } else if (cfg.detail) {
          const detailCfg = this._buildDetailConfig(cfg, { ...dynamicContext, record: match })
          if (detailCfg) {
            parallelFetches.push(
              dispatcher.dispatch(detailCfg, ctx).then((result) => {
                // The list already matched the record, so the brief is a HELD
                // value: a failed detail fetch keeps it and reports, rather than
                // delivering `[[]]` — which is what `result.data ?? match` did,
                // because a failure's `data` is `[]`, not null.
                if (result?.error) {
                  fail(schema, detailCfg, result.error)
                  data[schema] = [match]
                  return
                }
                const record = (result?.data !== undefined && result?.data !== null)
                  ? result.data
                  : match
                data[schema] = [record]
              })
            )
          } else {
            data[schema] = [match]
          }
        } else {
          data[schema] = [match]
        }
      } else {
        // Any other key — and `current: include`, the list as the binding describes it.
        parallelFetches.push(
          dispatcher.dispatch(cfg, ctx).then((result) => {
            if (result?.error) {
              fail(schema, cfg, result.error)
              return
            }
            if (result?.data !== undefined && result?.data !== null) {
              data[schema] = result.data
            }
          })
        )
      }
    }

    if (parallelFetches.length > 0) await Promise.all(parallelFetches)
    this._applyDetailRoutes(data, configs, block.website)
    return { data, errors: Object.keys(errors).length ? errors : null }
  }
}

/**
 * Say where a fetch failed, once per key per page, where the author is looking.
 *
 * Dev only: production has no reader for a console line, and the page has the
 * structured answer already — the key is absent from `data`, the message is on
 * `errors[key]`, and the runtime sets `block.dataError`. What must never happen
 * again is the third option this path used to take: an empty array under the
 * key, and silence.
 */
const reportedFailures = new Set()
function reportFetchFailure(dev, block, key, cfg, message) {
  if (!dev) return
  const where = cfg?.endpoint || cfg?.url || cfg?.path || '(no address)'
  const page = block?.page?.route ?? '(unknown page)'
  const memo = `${page}::${key}::${where}`
  if (reportedFailures.has(memo)) return
  reportedFailures.add(memo)
  console.error(
    `[uniweb] fetch for content.data.${key} failed on ${page} (${where}): ${message}. ` +
      `The key is left absent — not [] — and block.dataError carries this message.`
  )
}

/**
 * The record the index holds in FULL for a list match, or null — the R1 gate.
 * A record with no identity (`$uuid`) is never indexed, so the answer for it is
 * null and the detail fetch proceeds as before.
 */
function heldWhole(dispatcher, match) {
  const id = match?.$uuid
  if (typeof id !== 'string' || !id || typeof dispatcher?.peekRecord !== 'function') return null
  const held = dispatcher.peekRecord(id)
  return held?.whole === true ? held.record : null
}

/** Matches the record a parametric page is about — the one `current: only` delivers. */
function isPageRecord({ paramName, paramValue }) {
  return (item) => matchesRouteParam(item, paramName, paramValue)
}

/**
 * Sync-peek helper: return the cached array for a config, or null on miss.
 */
function peekArray(dispatcher, cfg, ctx) {
  const cached = dispatcher.peek(cfg, ctx)
  if (!cached) return null
  return Array.isArray(cached.data) ? cached.data : null
}

/**
 * Interpolate a record's fields into a detail-page route template to build its
 * `route` (the canonical href for a card). `/blog/:slug` + `{ slug: 'a-post' }`
 * → `/blog/a-post`. Returns a SHALLOW COPY with `route` added — never mutates the
 * cached record (the same query may back several sections with different
 * detail pages). Idempotent + back-compat: a record that already carries a `route`
 * (the file lane bakes one via the query processor) is returned untouched. A
 * `:param` with no matching record field → no `route` (graceful; degrades to the
 * component's own fallback rather than emitting a broken href).
 *
 * ⭐ The encoding is `fillRoutePattern`'s, shared with the build's bake, so the
 * two producers of `item.route` agree — they did not (F14, 2026-09-04).
 */
function addDetailRoute(item, template) {
  if (!item || typeof item !== 'object' || item.route !== undefined) return item
  const route = fillRoutePattern(template, item)
  return route === null ? item : { ...item, route }
}
