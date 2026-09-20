/**
 * WHAT A PAGE NEEDS — the one rule, and the two ways to run it.
 *
 * ⭐ *Which requests does rendering this block need, and what does its component receive?* The
 * answer has four parts, and this module is all four in one place:
 *
 *   - **(a) levels** — `fetchLevels`: which fetches reach a block at all.
 *   - **(b) fills** — `blockFills`: which of them fills each key the component declares
 *     (`fillDeclaredKeys`, `./data-keys.js`), and the resolved config of each.
 *   - **(c) requests** — `keyProgram`: what a filling fetch asks on THIS page, by `current:`.
 *   - **(d) assembly** — the same program: how each answer becomes the key's value.
 *
 * ⭐ **(c) is written in STEPS, because one request depends on an answer.** Off the records
 * service, a parametric page's record is FOUND in its query's set and only then asked for in full,
 * so the second request cannot be worked out before the first is answered. A flat list of configs
 * computed up front cannot express that — it has to guess, and the guess is wrong wherever the
 * record's own fields name the address (measured 2026-09-19: an `[id]` route with a `deferred:`
 * query asked for `{slug}` unfilled). A generator says it once, and both drivers get it.
 *
 * ⛔ **Two drivers, never two rules.** `runPlanSync` answers from the cache alone — SSR, and the
 * browser's first render — and stops at the first miss, which is what `pending` means. `runPlan`
 * dispatches. They differ in where an answer comes from and in nothing else, so a render cannot
 * look for something its fetch never asked for.
 *
 * *The copies this replaces, and what each of them got wrong:*
 * `kb/framework/plans/what-a-page-needs.md`. The import boundary that stops the next one:
 * `framework/_contracts/page-data-rule-boundary.test.js`.
 *
 * @module
 */

import { resolveFetchConfigs, fetchEntries, routeSelection, currentFor, othersView, othersOf, siteReaches } from './fetch-config.js'
import { fillDeclaredKeys } from './data-keys.js'
import { matchesRouteParam } from './route-match.js'
import { buildDetailConfig } from './detail-url.js'

/**
 * (a) The fetches that reach a block, most specific first: its own, its page's, its parent page's,
 * a nested page's route binding, and the site's where it reaches.
 *
 * ⭐ A page nested inside a parametric page receives its capturing page's route binding — the
 * cascade reaches one parent up, and the binding may sit above that. Its key only; the rest does
 * not cascade. The site's binding reaches a layout area and a top-level page's sections, and
 * nothing deeper (`siteReaches`, which is why this takes the parent PAGE and not its fetch).
 *
 * Plain data in and out, so a caller holding payload objects gets the same answer as one holding
 * the object graph.
 *
 * ⭐ `includeRoute` is for a caller looking for the PAGE'S OWN record rather than feeding a section:
 * the route query's declaration may sit on a section, and so be in no other level, and the page
 * still has to find the record it is about. A block sees that declaration only when it is nested,
 * because otherwise it is already among the levels above.
 *
 * @param {Object} where
 * @param {*} [where.own] - the block's own `fetch`
 * @param {*} [where.page] - its page's `fetch`
 * @param {Object|null} [where.parent] - its parent PAGE, or null
 * @param {{ config: *, nested: boolean }|null} [where.route] - the page's route query
 * @param {*} [where.site] - the site's `fetch`
 * @param {boolean} [where.includeRoute] - include the route query's declaration wherever it came from
 * @returns {Array<*>} one level each, falsy where a level declares nothing
 */
export function fetchLevels({ own = null, page = null, parent = null, route = null, site = null, includeRoute = false } = {}) {
  return [
    own,
    page,
    parent?.fetch ?? null,
    includeRoute || route?.nested ? route?.config ?? null : null,
    siteReaches(parent) ? site : null,
  ]
}

/**
 * (b) Each declared key paired with the fetch that fills it, resolved.
 *
 * ⭐ A declared key the block already HOLDS — a tagged data block, or its own fetch's prerendered
 * answer under that name — is not filled from a request. `held` carries it, and only for the first
 * fetch of that key reaching the block: the one whose answer a build put there.
 *
 * Each filling fetch is resolved on its own, so two fetches of one `as` can fill two keys.
 *
 * @param {Object} input
 * @param {Array<[string, string|null]>} input.declared - `declaredKeys(meta)`
 * @param {Array<*>} input.levels - `fetchLevels`
 * @param {Object} [input.holds] - what the block already holds, by key
 * @param {Object|null} [input.queries] - the site's `config.queries`
 * @param {Object} [input.options] - what each fetch is resolved with (`resolveFetchConfigs`)
 * @returns {Map<string, { cfg: Object, held: * }>} declared key → its filling config, in the order
 *   `declared` lists the keys
 */
export function blockFills({ declared, levels, holds = {}, queries = null, options = {} }) {
  const out = new Map()
  if (!declared || declared.length === 0) return out

  const fills = fillDeclaredKeys(declared, levels, {
    queries,
    held: declared.map(([key]) => key).filter((key) => holds[key] !== undefined),
  })
  // where the first fetch of each key reaching the block sits — the one a held answer belongs to
  const firstOfKey = new Map()
  levels.forEach((level, at) => fetchEntries(level).forEach((fetch, index) => {
    if (!firstOfKey.has(fetch.as)) firstOfKey.set(fetch.as, `${at}:${index}`)
  }))

  for (const [key, { fetch, level, index }] of fills) {
    const cfg = resolveFetchConfigs([fetch], options).get(fetch.as)
    if (!cfg) continue
    const held = firstOfKey.get(fetch.as) === `${level}:${index}` ? holds[fetch.as] : undefined
    out.set(key, { cfg, held })
  }
  return out
}

/** The record a parametric page is about — the one `current: only` delivers. */
function isPageRecord({ paramName, paramValue }) {
  return (item) => matchesRouteParam(item, paramName, paramValue)
}

/**
 * The record held under an identity IN FULL, or null — the R1 gate. A record with no identity
 * (`$uuid`) is never indexed, so the answer for it is null and the detail request proceeds.
 */
function heldWhole(peekRecord, match) {
  const id = match?.$uuid
  if (typeof id !== 'string' || !id || typeof peekRecord !== 'function') return null
  const held = peekRecord(id)
  return held?.whole === true ? held.record : null
}

/**
 * (c) + (d) One declared key's program: the requests it needs, in order, and what its answers
 * become. Each `yield` is a request; what comes back is `{ data, error }` — a driver dispatching
 * may report an error, a driver reading the cache never does, because the cache holds answers
 * only.
 *
 * ⛔ **A failed request delivers NOTHING under its key, and says so.** The key is absent from the
 * returned value and the message rides on `error`, because `[]` is a value: a request that failed
 * must not be indistinguishable from a query with no records. The one exception is the record's
 * own request on a page that already matched it in the set — there the brief is kept.
 *
 * @param {Object} cfg - the filling fetch, resolved
 * @param {Object} where
 * @param {Object|null} where.dynamicContext - the route's param and value, off a parametric page
 * @param {{ key: string, config: Object, nested: boolean }|null} where.route - the page's route query
 * @param {*} [where.held] - what the block already holds for this key
 * @param {Function} [where.peekRecord] - the record index, for the R1 gate
 * @param {'only'|'exclude'|'include'|null} [where.current] - override how this page's record is
 *   used. ⭐ For a caller asking for the PAGE'S OWN record: a page is about one record whatever a
 *   section's declaration says about how that section uses it.
 * @param {boolean} [where.opportunistic] - answer from whatever is already cached and never
 *   report a miss. ⭐ For a caller that runs BEFORE any fetch and must not cause one: the page
 *   naming itself from its record. On a question door the record has its own answer, but a list
 *   page may already hold the set, and the record is in it — so a miss falls through to the set,
 *   and a record found there answers with the brief it holds. No value at all means *unknown*,
 *   which is not the same as `[]`, *not in the set*.
 * @returns {Generator<Object, { value?: *, error?: string, errorConfig?: Object }>}
 */
export function* keyProgram(cfg, { dynamicContext = null, route = null, held = undefined, peekRecord = null, current: forced = null, opportunistic = false } = {}) {
  /** A step this caller can do without: a miss answers `{ missing: true }` instead of stopping. */
  const maybe = (request) => (opportunistic ? { request, optional: true } : request)
  // The block holds this fetch's answer already — a static build prerendered it.
  if (held !== undefined) return { value: held }

  // How this fetch uses the page's record: by the query it names (`currentFor`).
  const current = forced ?? (dynamicContext ? currentFor(cfg, route) : null)

  if (current === 'exclude') {
    // The query's records without this page's, its `limit` counting the others.
    const view = othersView(cfg)
    const answer = yield view
    if (answer.error) return { error: answer.error, errorConfig: view }
    if (answer.data === undefined || answer.data === null) return {}
    return { value: othersOf(answer.data, cfg, isPageRecord(dynamicContext)) }
  }

  if (current === 'only' && cfg.ask) {
    // ⭐ THE RECORDS SERVICE needs no list to find the record: the record is the query's set
    // narrowed by the route's handle, so its one question answers the record if the set holds it
    // and `[]` if not.
    const detailCfg = buildDetailConfig(cfg, dynamicContext)
    // No per-record source, or a route carrying no value: an unanswerable question, and asking it
    // is worse than leaving the key absent. ⚠️ `resolve` reported this as `pending` and `fetch`
    // dispatched a null config; neither was intended (unified 2026-09-19).
    if (!detailCfg && !opportunistic) return {}
    const answer = detailCfg ? yield maybe(detailCfg) : { missing: true }
    if (!answer.missing) {
      if (answer.error) return { error: answer.error, errorConfig: detailCfg }
      const list = Array.isArray(answer.data) ? answer.data : (answer.data ? [answer.data] : [])
      return { value: list.slice(0, 1) } // a route resolves to ONE; `[]` is not found
    }
    // Opportunistic, and the record's own answer is not held: the set may be, and the record is
    // in it. Falls through to the set below, which is where every other lane finds it.
  }

  if (current === 'only') {
    // Off the service the record is FOUND in the set — the query as saved, without the fetch's
    // `narrow` (`routeSelection`): a record past a fetch's `limit` still has its page, and one
    // past the query's has none.
    const selection = routeSelection(cfg)
    const answer = yield maybe(selection)
    // Opportunistic and nothing held: UNKNOWN, which is not `[]`. A caller naming a page from its
    // record leaves the name alone rather than calling the record missing.
    if (answer.missing) return {}
    if (answer.error) return { error: answer.error, errorConfig: selection }
    const items = Array.isArray(answer.data) ? answer.data : null
    const { paramName, paramValue } = dynamicContext
    const match = items?.find((item) => matchesRouteParam(item, paramName, paramValue)) ?? null
    if (!match) return { value: [] } // not found
    if (!cfg.detail) return { value: [match] }

    // ⭐ Held in full already? Then it IS the record — no second request. The list is materialized
    // from the record index, so `match` is the record at its latest depth.
    const whole = heldWhole(peekRecord, match)
    if (whole) return { value: [whole] }

    // ⭐ THE STEP THAT NEEDS THE ANSWER: the record's own address can name its own fields, so it
    // is built with the record in hand and never from the route's value alone.
    const detailCfg = buildDetailConfig(cfg, { ...dynamicContext, record: match })
    if (!detailCfg) return { value: [match] }
    const detail = yield maybe(detailCfg)
    // The list already matched the record, so the brief is a HELD value: a failed detail — or,
    // for an opportunistic caller, one not yet held — keeps it rather than delivering `[[]]`.
    if (detail.missing) return { value: [match] }
    if (detail.error) return { value: [match], error: detail.error, errorConfig: detailCfg }
    const record = detail.data !== undefined && detail.data !== null ? detail.data : match
    return { value: [record] }
  }

  // A fetch the page's record plays no part in, and `current: include`: the records as the fetch
  // describes them, the page's among the rest.
  const answer = yield cfg
  if (answer.error) return { error: answer.error, errorConfig: cfg }
  if (answer.data === undefined || answer.data === null) return {}
  return { value: answer.data }
}

/** A yielded step: a request, or a request a caller can do without (`opportunistic`). */
function asStep(step) {
  return step && step.request ? { request: step.request, optional: !!step.optional } : { request: step, optional: false }
}

/**
 * Every filling key's program, ready to run.
 *
 * @param {Map<string, { cfg: Object, held: * }>} fills - `blockFills`
 * @param {Object} where - passed to each `keyProgram`
 * @returns {Map<string, Generator>}
 */
export function planFor(fills, where = {}) {
  const plan = new Map()
  for (const [key, { cfg, held }] of fills) {
    plan.set(key, keyProgram(cfg, { ...where, held }))
  }
  return plan
}

/**
 * Run a plan against the CACHE alone — SSR, and the browser's first render.
 *
 * Stops a key at its first miss and reports `pending` for the block, which is what the caller
 * falls through to `runPlan` for. A key whose program needs no request is answered here.
 *
 * @param {Map<string, Generator>} plan
 * @param {Object} io
 * @param {(request: Object) => ({ data: * }|null|undefined)} io.peek
 * @returns {{ status: 'ready'|'pending', data: Object|null }}
 */
export function runPlanSync(plan, { peek }) {
  const data = {}
  let complete = true

  for (const [key, program] of plan) {
    let sent
    for (;;) {
      const step = program.next(sent)
      if (step.done) {
        const out = step.value ?? {}
        if (out.value !== undefined) data[key] = out.value
        break
      }
      const { request, optional } = asStep(step.value)
      const cached = peek(request)
      if (!cached) {
        if (optional) {
          // The program can do without this one and says what it makes of that.
          sent = { missing: true }
          continue
        }
        // Not cached: this key is not answerable without a request, so the block is not ready.
        program.return()
        complete = false
        break
      }
      sent = { data: cached.data }
    }
  }

  return complete ? { status: 'ready', data } : { status: 'pending', data: null }
}

/**
 * Run a plan by DISPATCHING — the browser filling a block, and a host's data step.
 *
 * ⭐ Every key's first request is issued in the same tick, which is what lets a question door batch
 * a page's questions into one POST. A key whose second request depends on its first answer takes a
 * later tick, and only that key waits.
 *
 * @param {Map<string, Generator>} plan
 * @param {Object} io
 * @param {(request: Object) => Promise<{ data: *, error?: string }>} io.dispatch
 * @param {(key: string, cfg: Object|null, message: string) => void} [io.onFailure]
 * @returns {Promise<{ data: Object, errors: Object|null }>}
 */
export async function runPlan(plan, { dispatch, onFailure = null }) {
  const data = {}
  const errors = {}

  await Promise.all([...plan].map(async ([key, program]) => {
    let sent
    for (;;) {
      const step = program.next(sent)
      if (step.done) {
        const out = step.value ?? {}
        if (out.value !== undefined) data[key] = out.value
        if (out.error) {
          errors[key] = out.error
          onFailure?.(key, out.errorConfig ?? null, out.error)
        }
        return
      }
      const result = await dispatch(asStep(step.value).request)
      sent = { data: result?.data, error: result?.error }
    }
  }))

  return { data, errors: Object.keys(errors).length ? errors : null }
}
