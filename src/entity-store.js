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

import { resolveFetchConfigs, pageRouteQuery } from './fetch-config.js'
import { declaredKeys } from './data-keys.js'
import { fillRoutePattern } from './route-match.js'
import { fetchLevels, blockFills, pageRecordConfig, planFor, runPlan, runPlanSync } from './page-data.js'

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
   * The fetches that reach a block — `fetchLevels` (`./page-data.js`), the one rule, read
   * off this block's graph. ⛔ Do not spell the levels out here: every lane that has
   * needed this answer has written its own list, and each list has drifted
   * (`kb/framework/plans/what-a-page-needs.md`).
   */
  _levels(block, route = this._route(block)) {
    const page = block.page
    return fetchLevels({
      own: block.fetch,
      page: page?.fetch,
      parent: page?.parent ?? null,
      route,
      site: block.website?.config?.fetch,
    })
  }

  /**
   * The options each fetch of a block is resolved with. The rule applied to a fetch
   * (locale normalization, route variables, deferred-detail injection) lives in
   * `./fetch-config.js`, shared with every other host that has to answer the same
   * question. Do not re-inline it here — divergence between copies is what the
   * extraction exists to prevent.
   */
  _resolveOptions(block) {
    const website = block.website
    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
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
    return {
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
    }
  }

  /**
   * ⭐ WHAT THIS SECTION RECEIVES, AND FROM WHICH FETCH — ruled 2026-09-14 [Diego]. The keys
   * its component declares and its foundation's (`website.declaredKeys`), each paired with
   * the fetch that fills it by the one rule (`fillDeclaredKeys`, automatic `as`) over the
   * levels that reach the block. A declared key the block already holds — a tagged data
   * block, or its own fetch's prerendered answer under that name — is not the store's to
   * fill, and a fetch that fills no declared key is not asked. Each filling fetch is
   * resolved on its own, so two fetches of one `as` can fill two keys.
   *
   * ⭐ `held` is the answer the block already holds for a filling fetch, under the fetch's
   * own key: a static build prerenders a section's own fetch into its content by `as`, so
   * a component that names the key differently still receives it without the browser
   * asking again. Only for the first fetch of that key reaching the block — the one whose
   * answer a build put there.
   *
   * ⛔ Until 2026-09-14 every fetch reaching the block was resolved and delivered under its
   * `as` — the first per key — whether the component read it or not, and a component
   * declaring its key under another name received nothing.
   *
   * @returns {Map<string, { cfg: Object, held: * }>} declared key → the resolved config of
   *   the fetch that fills it, and the answer the block holds for it (undefined when none)
   */
  _fills(block, meta, route) {
    const website = block.website
    return blockFills({
      declared: website?.declaredKeys ? website.declaredKeys(meta) : declaredKeys(meta?.data),
      levels: this._levels(block, route),
      holds: block.heldData || {},
      queries: website?.config?.queries ?? null,
      options: this._resolveOptions(block),
    })
  }

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
    const route = this._route(probe)
    const cfg = route && pageRecordConfig({
      pageFetch: page.fetch,
      parent: page.parent ?? null,
      route,
      site: this.website?.config?.fetch,
      options: this._resolveOptions(probe),
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
    return runPlan(plan, { dispatch: (request) => dispatcher.dispatch(request, ctx) })
  }

  /**
   * The ROUTE QUERY of the block's page — the query its URL names one record of —
   * worked out from the same sources `_levels` reads, at the page that
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
      const linked = items.map((item) => withRecordRoute(item, template))
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
    const route = this._route(block)
    const fills = this._fills(block, meta, route)
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

    const route = this._route(block)
    const fills = this._fills(block, meta, route)
    if (fills.size === 0) return { data: null, errors: null }

    const ctx = this._ctx(block, { signal })
    const { data, errors } = await runPlan(this._plan(block, fills, route, dispatcher), {
      dispatch: (request) => dispatcher.dispatch(request, ctx),
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
function withRecordRoute(item, template) {
  if (!item || typeof item !== 'object') return item
  const route = fillRoutePattern(template, item)
  return route === null || item.$route === route ? item : { ...item, $route: route }
}
