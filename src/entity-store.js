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

import { resolveFetchConfigs } from './fetch-config.js'
import { fillRoutePattern } from './route-match.js'
import { blockRouteQuery, blockFetchOptions, blockFillsOf, pageRecordConfig, planFor, runPlan, runPlanSync } from './page-data.js'

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
   * ⭐ What a block receives, from which fetch, its page's route query and the options each fetch
   * is resolved with, are read off the graph by `./page-data.js` (`blockFillsOf`,
   * `blockRouteQuery`, `blockFetchOptions`) — the reading a caller reporting what a section
   * received asks too, so the two cannot name different fetches.
   */

  /**
   * The plan for a block — one program per declared key (`planFor`, `./page-data.js`),
   * which both `resolve` and `fetch` run. They differ in where an answer comes from and in
   * nothing else.
   */
  _plan(block, fills, route, dispatcher = this.website?.fetcher) {
    return planFor(fills, {
      dynamicContext: block.dynamicContext || block.page?.dynamicContext,
      route,
      peekRecord: (id) => dispatcher?.peekRecord?.(id),
    })
  }

  /** The filling config of each key — what `_applyRecordRoutes` links records by. */
  _configs(fills) {
    return new Map([...fills].map(([key, { cfg }]) => [key, cfg]))
  }

  /**
   * ⭐ THE PAGE'S OWN RECORD, ASKED — the question `Website#_createDynamicPage` peeks to name the
   * page and to know whether it exists at all.
   *
   * A host's data step asks it whether or not a section declares the route key, because a page's
   * existence is not a section's business: a parametric page with no section reading its record is
   * a pseudo-error, but its 404 is not. The question is `pageRecordConfig`'s, so the asker and the
   * page cannot ask two different things.
   *
   * @param {Object} page - a concrete parametric page (it carries `dynamicContext`)
   * @param {Object} [options]
   * @param {Object} [options.dispatcher] - fetch through this one (a host's data step)
   * @returns {Promise<{ data: Object, errors: Object|null }|null>} null off a parametric page, or
   *   when the page's route query resolves to nothing
   */
  async fetchPageRecord(page, { dispatcher = this.website?.fetcher } = {}) {
    const dynamicContext = page?.dynamicContext
    if (!dynamicContext || !dispatcher) return null

    // A block-shaped probe standing for the page itself: its levels, its route query.
    const probe = { fetch: null, page, website: this.website, dynamicContext: null }
    const route = blockRouteQuery(probe)
    const cfg = route && pageRecordConfig({
      pageFetch: page.fetch,
      parent: page.parent ?? null,
      route,
      site: this.website?.config?.fetch,
      options: blockFetchOptions(probe),
    })
    if (!cfg) return null

    const plan = planFor(new Map([[route.key, { cfg }]]), {
      dynamicContext,
      route,
      // The page is about ONE record, whatever a section's `current:` says.
      current: 'only',
      peekRecord: (id) => dispatcher.peekRecord?.(id),
    })
    const ctx = this._ctx(probe)
    return runPlan(plan, {
      dispatch: (request) => dispatcher.dispatch(request, ctx),
      peek: (request) => dispatcher.peek?.(request, ctx),
    })
  }

  /**
   * ⭐ EVERY RECORD LINKS TO ITS QUERY'S PAGE — `$route`, filled here at render time, on
   * every lane (ruled 2026-09-14 [Diego]). For each delivered key, the page is the
   * fetch's `detailPage` when it names one that resolves, else the page whose route
   * query is the fetch's query (`website.recordPageFor`); each record gets that page's
   * route filled from its own fields (`fillRoutePattern`) as `$route`, and a record that
   * cannot fill it, or a key whose query has no page, gets none.
   *
   * ⭐ `$` marks a system field, as on `$uuid`, `$name` and `$tags` — so the link never
   * lands in the author's namespace. A component writes `<Link href={item.$route}>`. ⛔ Until 2026-09-14 the link was `route`: the build baked
   * it into compiled records from `route:` on a query, overwriting an entity's own
   * `route`, and this filled it only from a `detailPage`, skipping any record that
   * already had one.
   *
   * Runs after `data` is assembled, in the sync (peek) and async (fetch) paths alike.
   * Records are copied, never mutated: one cached record backs every section that
   * shows it, each of which may link it to a different page.
   */
  _applyRecordRoutes(data, configs, website) {
    if (!data || !website) return
    for (const [key, cfg] of configs) {
      const items = data[key]
      if (!Array.isArray(items) || items.length === 0) continue
      const template = recordRouteTemplate(cfg, website)
      if (!template) continue
      const linked = items.map((item) => withRecordRoute(item, template, cfg.routeField))
      // an unchanged list keeps its identity, so a render that re-links changes nothing
      if (linked.some((item, i) => item !== items[i])) data[key] = linked
    }
  }

  /**
   * `$route` on the records a section holds under its own fetch's key — what a static
   * build prerendered into its content (`block.heldData`). ⭐ A declared key the block holds
   * is filled from what it holds, not from this store (`runtime/src/prepare-props.js::
   * assembleData`), so those records never passed `_applyRecordRoutes`; without this, a list
   * a section fetches for itself reached its component with no links on a prerendered
   * site. Linked by the same rule, on every render and idempotently: data that is already
   * linked is left as it is, so its identity survives a re-render. (A held answer this store
   * delivers under another key is linked where it is delivered.)
   *
   * The block's data object is replaced, never written into, since the object the build
   * delivered may back more than this block.
   *
   * @param {Object} block
   */
  linkOwnRecords(block) {
    const held = block?.parsedContent?.data
    if (!held || typeof held !== 'object' || !block.fetch) return
    const website = block.website ?? this.website
    const configs = resolveFetchConfigs([block.fetch], {
      queries: website?.config?.queries ?? null,
      services: website?.config?.services ?? null,
      locale: website?.getActiveLocale?.() ?? null,
      defaultLocale: website?.getDefaultLocale?.() ?? null,
    })
    const linked = { ...held }
    this._applyRecordRoutes(linked, configs, website)
    if (Object.keys(linked).some((key) => linked[key] !== held[key])) block.parsedContent.data = linked
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
    const route = blockRouteQuery(block)
    const fills = blockFillsOf(block, meta, route)
    if (fills.size === 0) return { status: 'none', data: null }

    const ctx = this._ctx(block)
    const result = runPlanSync(this._plan(block, fills, route), {
      peek: (request) => dispatcher?.peek(request, ctx),
    })
    if (result.status !== 'ready') return { status: 'pending', data: null }

    this._applyRecordRoutes(result.data, this._configs(fills), block.website)
    return result
  }

  /**
   * Async fetch — the same plan, run by dispatching. List-first detail ordering preserved:
   * a record found in its query's set is asked for in full only after the set answers, and
   * only that key waits.
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
   * @param {Object} [options.dispatcher] - ⭐ Fetch through this one instead of the graph's: a
   *   host's data step holds the request's transport and a cache of its own (`Website#dispatcherFor`).
   *   The plan is the same; only where the answers come from and land differs.
   * @returns {Promise<{ data: Object|null, errors: Object|null }>} `data` keyed by
   *   binding key; `errors` keyed the same way, `null` when every fetch succeeded.
   */
  async fetch(block, meta, { signal, dispatcher = this.website?.fetcher } = {}) {
    if (!dispatcher) return { data: null, errors: null }

    const route = blockRouteQuery(block)
    const fills = blockFillsOf(block, meta, route)
    if (fills.size === 0) return { data: null, errors: null }

    const ctx = this._ctx(block, { signal })
    const { data, errors } = await runPlan(this._plan(block, fills, route, dispatcher), {
      dispatch: (request) => dispatcher.dispatch(request, ctx),
      // What the plan uses without asking, when it is held (`keyProgram`'s held steps).
      peek: (request) => dispatcher.peek?.(request, ctx),
      onFailure: (key, cfg, message) => reportFetchFailure(this.dev, block, key, cfg, message),
    })

    this._applyRecordRoutes(data, this._configs(fills), block.website)
    return { data, errors }
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
 * The route template a fetch's records link to — its `detailPage`, else its query's page.
 *
 * ⭐ A `detailPage` that no longer resolves — its page deleted, or no longer parametric —
 * falls back to the query's own page rather than taking every card's link away: the
 * author picked among the query's pages, and the query still has one. (The website warns
 * in dev when a ref dangles.)
 *
 * @param {Object} cfg - a resolved config
 * @param {Object} website
 * @returns {string|null}
 */
function recordRouteTemplate(cfg, website) {
  if (cfg?.detailPage) {
    const picked = website.resolveDetailPageTemplate?.(cfg.detailPage)
    if (picked) return picked
  }
  return typeof cfg?.query === 'string' ? (website.recordPageFor?.(cfg.query)?.route ?? null) : null
}

/**
 * A record with its `$route` — the template filled from the record's own fields
 * (`/blog/:slug` + `{ $name: 'a-post' }` → `/blog/a-post`). A SHALLOW COPY, never the
 * cached record. A record that cannot fill the template — a `:param` with no value on it
 * — is returned as it is, with no `$route`, so a component renders no link rather than a
 * broken one.
 *
 * ⭐ The encoding is `fillRoutePattern`'s: the one encoder for a record's href, which the
 * route matcher decodes (F14, 2026-09-04).
 */
function withRecordRoute(item, template, field = null) {
  if (!item || typeof item !== 'object') return item
  const route = fillRoutePattern(template, item, { field })
  return route === null || item.$route === route ? item : { ...item, $route: route }
}
