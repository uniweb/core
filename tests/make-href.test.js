/**
 * makeHref — what a `page:` reference resolves to.
 *
 * `page:<id>` names a page by its stable id, else by its route or folder, and
 * `#<id>` after it names a section of that page by the section's stable id.
 * ⛔ `topic:` was read as a second spelling of `page:` until 2026-10-18; it is
 * a scheme like any other now, and comes back as written.
 */

import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'
import { sectionHash } from '../src/section-id.js'

const website = new Website({
  content: {
    config: { name: 'Docs Site', defaultLanguage: 'en' },
    theme: {},
    pages: [
      { route: '/', title: 'Home', sections: [], hasContent: true },
      { route: '/docs/intro', id: 'a1b2c3', title: 'Intro', sections: [], hasContent: true },
    ],
  },
})

describe('makeHref', () => {
  it('resolves a page by its stable id, and by its route', () => {
    expect(website.makeHref('page:a1b2c3')).toBe('/docs/intro')
    expect(website.makeHref('page:docs/intro')).toBe('/docs/intro')
  })

  it("names a section by the fragment its renderer writes", () => {
    expect(website.makeHref('page:a1b2c3#getting-started')).toBe(
      `/docs/intro${sectionHash({ stableId: 'getting-started' })}`,
    )
  })

  it('leaves anything else as written — topic: included', () => {
    for (const href of ['/about', 'https://x.test', '#top', 'topic:a1b2c3', 'topic:docs/intro']) {
      expect(website.makeHref(href)).toBe(href)
    }
  })
})
