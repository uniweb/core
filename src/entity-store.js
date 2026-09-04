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

import { isFetchRefinement, resolveFetchConfigs } from './fetch-config.js'
import { fillRoutePattern } from './route-match.js'
import { sortRecords } from './sort.js'

/**
 * A fetch config's binding key — the `content.data.<key>` a component reads.
 * `as` is the name; `schema` is what it was called until 2026-09-02 and still
 * arrives on any payload published before then. See `fetch-config.js`.
 */
const bindingKeyOf = (cfg) => cfg?.as
import { buildDetailConfig } from './detail-url.js'

/**
 * Is `block.fetch` a per-instance refinement of the ancestor's fetch config
 * rather than a new source? The spelling is `refine: true`.
 *
 * The predicate itself lives in `./fetch-config.js` with the rest of the
 * cascade rule; this alias keeps the local call sites reading as they did.
 */
const isRefinement = isFetchRefinement

/**
 * `fetch: { inherit: true }` was the earlier spelling of `refine: true`, kept
 * "for one release" from April 2026 and removed on 2026-09-02. It is refused
 * rather than ignored: ignored, the declaration would read as a source with no
 * location and the block would render empty with nothing to say why. Dev
 * throws, so a page does not render on the old spelling; production logs once
 * and the caller drops the declaration, so the block receives the cascaded
 * data unrefined.
 */
let inheritRefusalLogged = false
function refuseInheritAlias(block, dev) {
  const message =
    "[uniweb] 'fetch: { inherit: true }' is no longer accepted; write 'fetch: { refine: true }'. " +
    `Seen on block ${block?.id ?? '(unknown)'} of page ${block?.page?.route ?? '(unknown)'}.`
  if (dev) throw new Error(message)
  if (inheritRefusalLogged) return
  inheritRefusalLogged = true
  console.error(message)
}

export default class EntityStore {
  /**
   * @param {Object} options
   * @param {import('./website.js').default} options.website
   * @param {boolean} [options.dev=false] - dev mode: a retired spelling throws
   *   instead of logging once.
   */
  constructor({ website, dev = false }) {
    this.website = website
    this.dev = dev
    Object.seal(this)
  }

  _shouldInheritDetail(meta, block) {
    const bf = block?.fetch
    if (isRefinement(bf) && bf?.detail !== undefined) return bf.detail !== false
    if (!meta) return true
    return meta.inheritDetail !== false
  }

  _inheritLimit(meta, block) {
    const bf = block?.fetch
    if (isRefinement(bf) && bf?.limit > 0) return bf.limit
    return (meta?.inheritLimit > 0) ? meta.inheritLimit : null
  }

  _inheritOrder(block) {
    const bf = block?.fetch
    if (isRefinement(bf) && bf?.order?.orderBy) return bf.order
    return null
  }

  /**
   * A refine block's `order: { orderBy, sortOrder }` — the same one-key sort the
   * build and the fetcher fallback run (`./sort.js`), so the three cannot drift.
   */
  _sortItems(items, order) {
    if (!order?.orderBy) return items
    return sortRecords(items, { field: order.orderBy, desc: order.sortOrder === 'DESC' })
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
  _findFetchConfigs(block, requested) {
    let blockFetch = block.fetch
    if (blockFetch?.inherit !== undefined) {
      refuseInheritAlias(block, this.dev)
      blockFetch = null
    }

    const page = block.page
    const website = block.website

    return resolveFetchConfigs(
      [
        blockFetch && !isRefinement(blockFetch) ? blockFetch : null,
        page?.fetch,
        page?.parent?.fetch,
        website?.config?.fetch,
      ],
      {
        schemas: requested,
        locale: website?.getActiveLocale?.() ?? null,
        defaultLocale: website?.getDefaultLocale?.() ?? null,
        // ⚠️ `queries`, matching `resolveFetchConfigs`. This passed `collections`
        // after the payload key was renamed — a dead option name, silently: the
        // resolver simply saw no queries and stopped injecting `detail:`.
        queries: website?.config?.queries ?? null,
        // A host's live-records lane. Absent on every static site and on
        // local dev, which is why `resolveQuerySource` treats absence as
        // the ordinary case and reads the compiled artifact without comment.
        records: website?.config?.records ?? null,
      },
    )
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
      const blockFetchList = Array.isArray(block.fetch) ? block.fetch : [block.fetch]
      const schemas = blockFetchList.filter(bindingKeyOf).map(bindingKeyOf)
      if (schemas.length > 0) requested = schemas
    }

    if (requested === null) return { status: 'none', data: null }

    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) return { status: 'none', data: null }

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const inheritDetail = this._shouldInheritDetail(meta, block)
    const limit = this._inheritLimit(meta, block)
    const order = this._inheritOrder(block)
    const ctx = this._ctx(block)

    const data = {}
    let allCached = true

    const routeSchema = dynamicContext?.schema

    for (const [schema, cfg] of configs) {
      const isRouteQuery = dynamicContext && schema === routeSchema
      if (isRouteQuery && !inheritDetail) {
        // refine detail:false — the records minus the active one (related items).
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          const { paramName, paramValue } = dynamicContext
          const items = cached.data
          let filtered = Array.isArray(items)
            ? items.filter((item) => String(item[paramName]) !== String(paramValue))
            : items
          if (order) filtered = this._sortItems(filtered, order)
          data[schema] = limit && Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
        } else {
          allCached = false
        }
      } else if (isRouteQuery) {
        // Detail page: deliver the focused record as a length-1 array under the
        // query key. A deferred/remote query fetches the full per-record;
        // others use the matched record. Not found → [].
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          const { paramName, paramValue } = dynamicContext
          const items = cached.data
          const match = Array.isArray(items)
            ? items.find((item) => String(item[paramName]) === String(paramValue))
            : null
          if (!match) {
            data[schema] = []
          } else if (cfg.detail) {
            // ⭐ Held in full already? Then it IS the record — no detail probe.
            // The list is materialized from the record index, so `match` is the
            // record at its latest depth; the index says which depth that is.
            const held = heldInFull(dispatcher, match)
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
        const cached = dispatcher?.peek(cfg, ctx)
        if (cached) {
          const items = cached.data
          data[schema] = order ? this._sortItems(items, order) : items
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
      const blockFetchList = Array.isArray(block.fetch) ? block.fetch : [block.fetch]
      const schemas = blockFetchList.filter(bindingKeyOf).map(bindingKeyOf)
      if (schemas.length > 0) requested = schemas
    }
    if (requested === null) return { data: null, errors: null }

    const configs = this._findFetchConfigs(block, requested)
    if (configs.size === 0) return { data: null, errors: null }

    const dynamicContext = block.dynamicContext || block.page?.dynamicContext
    const inheritDetail = this._shouldInheritDetail(meta, block)
    const limit = this._inheritLimit(meta, block)
    const order = this._inheritOrder(block)
    const ctx = this._ctx(block, { signal })

    const data = {}
    const errors = {}
    const parallelFetches = []
    const fail = (key, cfg, message) => {
      errors[key] = message
      reportFetchFailure(this.dev, block, key, cfg, message)
    }

    const routeSchema = dynamicContext?.schema

    for (const [schema, cfg] of configs) {
      const isRouteQuery = dynamicContext && schema === routeSchema
      if (isRouteQuery && !inheritDetail) {
        // refine detail:false — the records minus the active one.
        let records = peekArray(dispatcher, cfg, ctx)
        if (records === null) {
          const result = await dispatcher.dispatch(cfg, ctx)
          if (result?.error) {
            fail(schema, cfg, result.error)
            continue
          }
          records = Array.isArray(result?.data) ? result.data : null
        }
        const { paramName, paramValue } = dynamicContext
        let filtered = Array.isArray(records)
          ? records.filter((item) => String(item[paramName]) !== String(paramValue))
          : (records ?? [])
        if (order) filtered = this._sortItems(filtered, order)
        data[schema] = limit && Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
      } else if (isRouteQuery) {
        // Detail page: focused record as a length-1 array under the query key.
        const { paramName, paramValue } = dynamicContext

        let records = peekArray(dispatcher, cfg, ctx)
        if (records === null) {
          const result = await dispatcher.dispatch(cfg, ctx)
          if (result?.error) {
            fail(schema, cfg, result.error)
            continue
          }
          records = Array.isArray(result?.data) ? result.data : null
        }

        const match = records?.find(
          (item) => String(item[paramName]) === String(paramValue)
        ) ?? null

        if (!match) {
          data[schema] = []
          continue
        }

        const held = cfg.detail ? heldInFull(dispatcher, match) : null
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
        parallelFetches.push(
          dispatcher.dispatch(cfg, ctx).then((result) => {
            if (result?.error) {
              fail(schema, cfg, result.error)
              return
            }
            if (result?.data !== undefined && result?.data !== null) {
              // The same refine `order` the sync path applies (`resolve`), so a
              // block sorts identically on a cache hit and on the fetch that
              // filled it — it did not until 2026-09-04.
              data[schema] = order ? this._sortItems(result.data, order) : result.data
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
function heldInFull(dispatcher, match) {
  const id = match?.$uuid
  if (typeof id !== 'string' || !id || typeof dispatcher?.peekRecord !== 'function') return null
  const held = dispatcher.peekRecord(id)
  return held?.depth === 'full' ? held.record : null
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
