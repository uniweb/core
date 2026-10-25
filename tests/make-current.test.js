/**
 * `globalThis.uniweb` names one Uniweb, and every `createUniweb` points it at the newest. Code that
 * reaches the site through it (a block's component, the props pipeline, kit's
 * `getUniweb().activeWebsite`) reads that one, not the Website it was handed. So a caller holding
 * several graphs in one process points it back before it uses another: `Website#makeCurrent`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createUniweb, getUniweb } from '../src/index.js'
import Website from '../src/website.js'

const content = (name) => ({ config: { name, defaultLanguage: 'en' }, theme: {}, pages: [{ route: '/', sections: [] }] })
const before = globalThis.uniweb

describe('Website#makeCurrent', () => {
  afterEach(() => {
    globalThis.uniweb = before
  })

  it('⭐ points the global back at the Uniweb that made the Website', () => {
    const a = createUniweb(content('A'))
    const b = createUniweb(content('B'))
    expect(getUniweb()).toBe(b)
    a.activeWebsite.makeCurrent()
    expect(getUniweb()).toBe(a)
    expect(getUniweb().activeWebsite.name).toBe('A')
  })

  it('CONTROL — without it, the newest Uniweb is the one the global names', () => {
    const a = createUniweb(content('A'))
    createUniweb(content('B'))
    expect(getUniweb().activeWebsite).not.toBe(a.activeWebsite)
    expect(getUniweb().activeWebsite.name).toBe('B')
  })

  it('a Website built without a Uniweb has none to point at, and leaves the global as it is', () => {
    const b = createUniweb(content('B'))
    new Website({ content: content('Bare') }).makeCurrent()
    expect(getUniweb()).toBe(b)
  })
})
