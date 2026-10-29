/**
 * makeHref — what a `page:` reference resolves to.
 *
 * `page:<id>` names a page by its stable id, else by its route — `page:/` the
 * homepage — and `#<id>` after it names a section of that page by the section's
 * stable id. ⛔ A page's folder under `pages/` was a third name until 2026-10-29
 * (`page:home`), and a hosted site's data carries no folder, so such a link
 * resolved in a static build and was dead wherever a backend served the site.
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

describe('the homepage by its route, and no third name', () => {
  const site = (home) =>
    new Website({
      content: {
        config: { name: 'Site', defaultLanguage: 'en' },
        theme: {},
        pages: [
          { route: '/', sourcePath: '/home', title: 'Home', sections: [], hasContent: true, ...home },
          { route: '/docs', sourcePath: '/docs/intro', isIndex: true, title: 'Docs', sections: [], hasContent: true },
        ],
      },
    })

  it('names the homepage `page:/`, and reads a target the way it reads a route', () => {
    const w = site()
    expect(w.makeHref('page:/')).toBe('/')
    expect(w.makeHref('page:/#features')).toBe(`/${sectionHash({ stableId: 'features' })}`)
    expect(w.makeHref('page:/docs/')).toBe('/docs')
    expect(w.makeHref('page:docs')).toBe('/docs')
  })

  it('names no page by its folder: the homepage\'s `home`, an index page\'s `docs/intro`', () => {
    const w = site()
    expect(w.makeHref('page:home#features')).toBe('page:home#features')
    expect(w.makeHref('page:docs/intro')).toBe('page:docs/intro')
  })

  it('CONTROL — a homepage that declares `id: home` is `page:home` by its id', () => {
    expect(site({ id: 'home' }).makeHref('page:home')).toBe('/')
  })
})
