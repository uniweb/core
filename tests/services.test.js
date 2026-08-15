/**
 * The two-tier service seam — and specifically the rule the two readers share:
 * **the site's value wins per key, the host fills the gaps.**
 *
 * `resolveService`'s precedence and the base join are covered by `@uniweb/kit`'s
 * own suite, which exercises them through the re-export shim. This file covers
 * the tier semantics of the options reader, which is where the two readers used
 * to disagree.
 *
 * Design: `kb/framework/plans/tracking-vendor-tags.md` §10.
 */

import { describe, it, expect } from 'vitest'
import { readServiceOptions, resolveService } from '../src/services.js'

const site = (tracking) => ({ config: { tracking } })
const both = (tracking, hosted) => ({ config: { tracking, services: { tracking: hosted } } })

describe('readServiceOptions — per-key fallthrough', () => {
  it('takes the host tier when the site declares nothing', () => {
    const website = { config: { services: { tracking: { consent: 'required' } } } }
    expect(readServiceOptions(website, 'tracking')).toEqual({ consent: 'required' })
  })

  it('takes the site tier when the host declares nothing', () => {
    expect(readServiceOptions(site({ consent: 'required' }), 'tracking')).toEqual({
      consent: 'required'
    })
  })

  it('fills a key the site left out from the host', () => {
    // The case that motivated the change: an operator turns on a third-party
    // tag while the host supplies the collector. Their tags must not silently
    // discard the host's gate.
    const website = both({ tags: ['https://vendor.example.com/t.js'] }, { consent: 'required' })

    expect(readServiceOptions(website, 'tracking')).toEqual({
      tags: ['https://vendor.example.com/t.js'],
      consent: 'required'
    })
  })

  it('lets the site override a key the host also declared', () => {
    const website = both({ consent: 'none' }, { consent: 'required' })
    expect(readServiceOptions(website, 'tracking').consent).toBe('none')
  })

  it('replaces rather than combines — a key is one tier or the other', () => {
    // Shallow on purpose: combining would make a site's effective config depend
    // on what its host happens to offer.
    const website = both({ tags: ['/mine.js'] }, { tags: ['/theirs.js'] })
    expect(readServiceOptions(website, 'tracking').tags).toEqual(['/mine.js'])
  })

  it('reads the host tier through a site shorthand — a string carries no options', () => {
    const website = both('/collect', { consent: 'required' })
    expect(readServiceOptions(website, 'tracking')).toEqual({ consent: 'required' })
  })

  it('is {} when nobody declares the service', () => {
    expect(readServiceOptions({ config: {} }, 'tracking')).toEqual({})
    expect(readServiceOptions(undefined, 'tracking')).toEqual({})
  })

  it('ignores a malformed declaration rather than spreading it', () => {
    expect(readServiceOptions(site(['a', 'b']), 'tracking')).toEqual({})
    expect(readServiceOptions(site(42), 'tracking')).toEqual({})
  })
})

describe('the two readers now agree', () => {
  it('a site declaration with no endpoint leaves BOTH the host address and its options in play', () => {
    const website = both({ tags: ['/mine.js'] }, { endpoint: '/host-collect', consent: 'required' })

    // The address falls through — this half was always true.
    expect(resolveService(website, 'tracking')).toEqual({
      url: '/host-collect',
      source: 'host'
    })
    // And now so do the options. Before the fix this was `{ tags: [...] }`,
    // i.e. sending to the host's collector while ignoring the host's gate.
    expect(readServiceOptions(website, 'tracking').consent).toBe('required')
  })
})
