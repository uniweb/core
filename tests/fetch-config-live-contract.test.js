/**
 * The `resolveFetchConfigs` surface that LIVE-PINNED consumers read.
 *
 * ## Why this file exists, and why it is not "more tests for fetch-config"
 *
 * `@uniweb/core` is declared `workspace:*` by consumers outside this repo, which bundles
 * the ON-DISK clone. A rename here is live for them **at commit time** — no publish, no
 * version bump, ⛔ **and no version range that can express a floor.** They cannot pin
 * their way out; the only protection available is that the author knows.
 *
 * **Measured: three breakages of this seam in 16 days** (2026-08-14, 08-27, 08-30), each
 * found by a consumer running their suite rather than by a message. The 08-30 one renamed
 * both an option (`collections:` → `queries:`) and a per-config field (`cfg.collection` →
 * `cfg.query`) in `8a8789e`; the consumer's endpoint silently became `undefined` and their
 * pages still rendered 200 with well-formed data carrying no records.
 *
 * ⛔ **So this file is not asserting that the code works — other tests do that. It asserts
 * that these NAMES are load-bearing**, so a rename cannot be a quiet refactor. It turns
 * "remember to tell them" into a red suite before the commit exists, and the message names
 * who to tell.
 *
 * ⚠️ **It cannot notify anyone**, and it is not a substitute for a consumer's own guard —
 * theirs fails when they build, this one fails when we commit, and those are different
 * moments for different people. Both are worth having.
 *
 * 📌 The addressee list is DERIVED, not written here:
 * `framework/_contracts/live-pinned-consumers.json`, regenerated and diffed by
 * `live-pinned-consumers.test.js`. A hand-written list was tried and was wrong within a
 * day.
 */

import { describe, it, expect } from 'vitest'
import { resolveFetchConfigs, isFetchRefinement } from '../src/fetch-config.js'

const WHO =
  'A live-pinned consumer reads this name. See ' +
  'framework/_contracts/live-pinned-consumers.json for who, and say "live now" — ' +
  'they bundle the clone, so this is already broken for them at commit time.'

// A records lane exactly as a host stamps it onto the payload.
const RECORDS = {
  list: '/_records/{path}',
  record: '/_records/{path}/{param}',
  supports: [],
  style: 'json-body',
}

const authored = (extra) => [{ path: '/data/members.json', as: 'members', ...extra }]

describe('resolveFetchConfigs — the live-pinned surface', () => {
  it('the OPTION is `records`, and it is what turns a query into an endpoint', () => {
    const [cfg] = [
      ...resolveFetchConfigs(authored({ query: 'members' }), {
        records: RECORDS,
      }).values(),
    ]
    expect(cfg.endpoint, WHO).toBe('/_records/members')
  })

  it('the FIELD is `cfg.query` — this is the one that broke a consumer on 2026-08-29', () => {
    // The distinction that cost a round trip: `endpoint` comes from the FIELD, not from
    // the option. Fixing only the option name leaves the consumer red.
    const withField = resolveFetchConfigs(authored({ query: 'members' }), {
      records: RECORDS,
    })
    const withoutField = resolveFetchConfigs(authored({}), { records: RECORDS })

    expect([...withField.values()][0].endpoint, WHO).toBe('/_records/members')
    expect([...withoutField.values()][0].endpoint).toBeUndefined()
  })

  it('the OPTION is `queries` — `collections` is retired and must stay dead', () => {
    // Pinned in the negative deliberately. The retired option is silent: it resolves
    // nothing and throws nothing, so a reader who "restores compatibility" by accepting
    // it again would reintroduce exactly the failure this pair of names was renamed to
    // prevent. If it ever needs to come back, that is a decision, not a patch.
    const deferred = { members: { deferred: ['bio'], detailUrl: '/x/{slug}' } }

    const viaQueries = resolveFetchConfigs(authored({ query: 'members' }), {
      queries: deferred,
    })
    const viaCollections = resolveFetchConfigs(authored({ query: 'members' }), {
      collections: deferred,
    })

    expect([...viaQueries.values()][0].detail, WHO).toBe('/x/{slug}')
    expect([...viaCollections.values()][0].detail).toBeUndefined()
  })

  it('the retired FIELD `collection:` resolves nothing — silently, which is why it is pinned', () => {
    // @uniweb/build throws on this spelling, so no current payload carries it. A payload
    // synced before the rename may. If that population turns out to be non-empty, the
    // answer is a deliberate alias here — not a discovery in production.
    const [cfg] = [
      ...resolveFetchConfigs(authored({ collection: 'members' }), {
        records: RECORDS,
      }).values(),
    ]
    expect(cfg.endpoint).toBeUndefined()
    expect(cfg.path).toBe('/data/members.json')
  })

  it('the RETURN keys are `endpoint` and `detail`', () => {
    const [cfg] = [
      ...resolveFetchConfigs(authored({ query: 'members' }), {
        records: RECORDS,
      }).values(),
    ]
    expect(Object.keys(cfg), WHO).toContain('endpoint')
    expect(cfg.detail, WHO).toBe('/_records/members/{param}')
    // `path` is dropped once an endpoint resolves — two addresses on one request is an
    // ambiguity the fetcher would break by accident of field order.
    expect(cfg.path).toBeUndefined()
  })
})

describe('isFetchRefinement — the live-pinned predicate', () => {
  // A live-pinned consumer reads this name through the `./fetch-config` subpath
  // to tell a section's own source from a refinement of its ancestor's. The name
  // and its answer are both load-bearing: a rename is a link error for them at
  // commit time, and a widened answer would turn a section they prefetch as a
  // source back into one they skip.
  it('the NAME is `isFetchRefinement`, and `refine: true` is the one spelling it answers to', () => {
    expect(isFetchRefinement({ refine: true, limit: 3 }), WHO).toBe(true)
    expect(isFetchRefinement({ path: '/data/members.json', as: 'members' }), WHO).toBe(false)
  })

  it('the removed `inherit: true` alias answers false, and stays false', () => {
    // Removed 2026-09-02. Pinned so the old spelling cannot quietly become a
    // refinement again for a consumer that stopped expecting it.
    expect(isFetchRefinement({ inherit: true }), WHO).toBe(false)
  })
})
