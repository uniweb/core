/**
 * The section DOM id rule.
 *
 * This exists because the rule was written out three times — the SPA
 * renderer, the SSR renderer, and the search-index extractor — and one copy
 * drifted. The renderers moved to `stableId`; the extractor kept emitting
 * `Section${positionalId}`. The result: every section-level search result on
 * every site linked to a fragment that did not exist, so a hit either landed
 * on the page without scrolling or, when it targeted the page you were
 * already on, did nothing whatsoever.
 *
 * Nothing failed. There was no error to see, because a missing fragment is
 * not an error — it is a no-op. That is why the assertion below is about the
 * exact emitted string: it is the only thing that can catch this class.
 */

import { describe, it, expect } from 'vitest'
import { sectionDomId, sectionHash } from '../src/section-id.js'

describe('sectionDomId', () => {
  it('prefers stableId, which survives reordering', () => {
    // The positional id changes when an author inserts a section above this
    // one; the stable id (from the filename, or an authored `id:`) does not.
    expect(sectionDomId({ stableId: 'hero', id: '1' })).toBe('section-hero')
  })

  it('falls back to the positional id when there is no stable one', () => {
    expect(sectionDomId({ id: '3' })).toBe('section-3')
    expect(sectionDomId({ id: 3 })).toBe('section-3')
  })

  it('never emits an id ending in undefined', () => {
    // A wrong-but-obvious anchor beats a malformed one: `section-undefined`
    // looks like a working selector and silently matches nothing.
    expect(sectionDomId({})).toBe('section-unknown')
    expect(sectionDomId(null)).toBe('section-unknown')
    expect(sectionDomId({ stableId: '', id: '' })).toBe('section-unknown')
  })

  it('accepts a Block and raw section data identically', () => {
    // The runtime holds Block instances; build-time consumers hold plain
    // objects off the wire. Both must produce the same id or the anchor and
    // the DOM disagree again.
    const block = { stableId: 'features', id: '2', page: {}, website: {} }
    const wireSection = { stableId: 'features', id: '2', type: 'Features' }
    expect(sectionDomId(block)).toBe(sectionDomId(wireSection))
  })

  it('is the exact string the renderers write', () => {
    // Pinned literally. If this format ever changes, every anchor, every
    // pasted deep link and every table of contents changes with it — so the
    // change should be deliberate enough to update this line.
    expect(sectionDomId({ stableId: 'what-is-uniweb' })).toBe('section-what-is-uniweb')
  })
})

describe('sectionHash', () => {
  it('is the id as a fragment', () => {
    expect(sectionHash({ stableId: 'hero' })).toBe('#section-hero')
  })

  it('composes into an href without a doubled or missing #', () => {
    const route = '/docs/reference/foundation-config'
    expect(`${route}${sectionHash({ stableId: 'foundation-config' })}`)
      .toBe('/docs/reference/foundation-config#section-foundation-config')
  })
})
