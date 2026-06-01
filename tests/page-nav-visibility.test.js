// Page navigation visibility — the generalized `hideIn` (per-area denylist) plus the
// `hidden` (all-nav) flag, and the back-compat from the legacy hideInHeader/Footer.

import { describe, it, expect } from 'vitest'
import Page from '../src/page.js'

const mk = (data) => new Page({ route: '/x', ...data }, 'x', null)

describe('Page nav visibility (hideIn)', () => {
  it('reads hideIn as an array and exposes showInNav per area', () => {
    const p = mk({ hideIn: ['header', 'sidebar'] })
    expect(p.hideIn).toEqual(['header', 'sidebar'])
    expect(p.showInNav('header')).toBe(false)
    expect(p.showInNav('sidebar')).toBe(false)
    expect(p.showInNav('footer')).toBe(true)
    expect(p.showInHeader()).toBe(false)
    expect(p.showInFooter()).toBe(true)
    // derived back-compat accessors
    expect(p.hideInHeader).toBe(true)
    expect(p.hideInFooter).toBe(false)
  })

  it('folds the legacy hideInHeader/hideInFooter booleans into hideIn', () => {
    const p = mk({ hideInHeader: true, hideInFooter: true })
    expect(p.hideIn).toEqual(['header', 'footer'])
    expect(p.showInHeader()).toBe(false)
    expect(p.showInFooter()).toBe(false)
  })

  it('dedupes when the array and a legacy boolean name the same area', () => {
    expect(mk({ hideIn: ['header'], hideInHeader: true }).hideIn).toEqual(['header'])
  })

  it('hidden excludes from every nav area regardless of hideIn', () => {
    const p = mk({ hidden: true })
    expect(p.showInNav('header')).toBe(false)
    expect(p.showInNav('footer')).toBe(false)
    expect(p.showInHeader()).toBe(false)
  })

  it('defaults to visible everywhere when nothing is set', () => {
    const p = mk({})
    expect(p.hideIn).toEqual([])
    expect(p.showInHeader()).toBe(true)
    expect(p.showInFooter()).toBe(true)
    expect(p.showInNav('sidebar')).toBe(true)
  })
})
