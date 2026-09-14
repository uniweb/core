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

import { resolveFetchConfigs, fetchEntries, pageRouteQuery, routeSelection, currentFor, othersView, othersOf, siteReaches } from './fetch-config.js'
import { declaredKeys, fillDeclaredKeys } from './data-keys.js'
import { fillRoutePattern, matchesRouteParam } from './route-match.js'
import { buildDetailConfig } from './detail-url.js'

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
   * The fetches that reach a block, one level each, most specific first: its own, its
   * page's, its parent page's, a nested page's route binding, and the site's.
   *
   * ⭐ A page nested inside a parametric page receives its capturing page's route binding
   * — the cascade reaches one parent up, and the binding may sit above that
   * (`pageRouteQuery`). Its key only; the rest does not cascade. The site's binding
   * reaches a layout section and a top-level page's sections, and nothing deeper
   * (`siteReaches`).
   */
  _levels(block, route = this._route(block)) {
    const page = block.page
    return [
      block.fetch,
      page?.fetch,
      page?.parent?.fetch,
      route?.nested ? route.config : null,
      siteReaches(page?.parent) ? block.website?.config?.fetch : null,
    ]
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
    const declared = website?.declaredKeys ? website.declaredKeys(meta) : declaredKeys(meta?.data)
    const out = new Map()
    if (declared.length === 0) return out
    const holds = block.heldData || {}
    const levels = this._levels(block, route)
    const fills = fillDeclaredKeys(declared, levels, {
      queries: website?.config?.queries ?? null,
      held: declared.map(([key]) => key).filter((key) => holds[key] !== undefined),
    })
    // where the first fetch of each key reaching the block sits — the one a held answer
    // belongs to
    const firstOfKey = new Map()
    levels.forEach((level, at) => fetchEntries(level).forEach((fetch, index) => {
      if (!firstOfKey.has(fetch.as)) firstOfKey.set(fetch.as, `${at}:${index}`)
    }))
    const options = this._resolveOptions(block)
    for (const [key, { fetch, level, index }] of fills) {
      const cfg = resolveFetchConfigs([fetch], options).get(fetch.as)
      if (!cfg) continue
      const held = firstOfKey.get(fetch.as) === `${level}:${index}` ? holds[fetch.as] : undefined
      out.set(key, { cfg, held })
    }
    return out
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
    const route = this._route(block)
    const fills = this._fills(block, meta, route)
    if (fills.size === 0) return { status: 'none', data: null }
    const configs = new Map([...fills].map(([key, { cfg }]) => [key, cfg]))

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const ctx = this._ctx(block)

    const data = {}
    let allCached = true

    for (const [schema, { cfg, held }] of fills) {
      if (held !== undefined) {
        // The block holds this fetch's answer already — a static build prerendered it.
        data[schema] = held
        continue
      }
      // How this fetch uses the page's record: by the query it names (`currentFor`).
      const current = dynamicContext ? currentFor(cfg, route) : null
      if (current === 'exclude') {
        // The query's records without this page's, `limit` counting the others.
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
        // others use the matched record. Not found → []. Found in the set of the
        // query the fetch names — the route query's, or another's under `current: only`
        // — never in a list a fetch narrowed (`routeSelection`).
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
        // A fetch the page's record plays no part in (`currentFor`), and `current:
        // include`: the records as the fetch describes them, the page's among the rest.
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          data[schema] = cached.data
        } else {
          allCached = false
        }
      }
    }

    if (allCached) {
      this._applyRecordRoutes(data, configs, block.website)
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

    const route = this._route(block)
    const fills = this._fills(block, meta, route)
    if (fills.size === 0) return { data: null, errors: null }
    const configs = new Map([...fills].map(([key, { cfg }]) => [key, cfg]))

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const ctx = this._ctx(block, { signal })

    const data = {}
    const errors = {}
    const parallelFetches = []
    const fail = (key, cfg, message) => {
      errors[key] = message
      reportFetchFailure(this.dev, block, key, cfg, message)
    }

    for (const [schema, { cfg, held }] of fills) {
      if (held !== undefined) {
        // The block holds this fetch's answer already — a static build prerendered it.
        data[schema] = held
        continue
      }
      // How this fetch uses the page's record: by the query it names (`currentFor`).
      const current = dynamicContext ? currentFor(cfg, route) : null
      if (current === 'exclude') {
        // The query's records without this page's, the fetch's `limit` counting
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
        // query's set narrowed by the route's handle, so its one question
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
        // Detail page: focused record as a length-1 array under the fetch's key,
        // found in its query's set (`routeSelection`) — a record past a
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
    this._applyRecordRoutes(data, configs, block.website)
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
