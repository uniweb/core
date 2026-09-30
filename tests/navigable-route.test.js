/**
 * getNavigableRoute — where a page with no content of its own sends a visitor.
 *
 * The runtime redirects there and the static build writes a redirect stub to it:
 * the first descendant with content, depth-first in page order. ⛔ Until 2026-09-30
 * an empty first child ended the walk, so a container sent visitors to a page with
 * nothing on it while a later sibling had content.
 */

import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

function siteWith(pages) {
  return new Website({
    content: {
      config: { name: 'Docs Site', defaultLanguage: 'en' },
      theme: {},
      pages,
    },
  })
}

const page = (route, extra = {}) => ({
  route,
  title: route.split('/').filter(Boolean).pop() || 'Home',
  sections: [],
  hasContent: true,
  ...extra,
})

const landing = (pages, route) => siteWith(pages).getPage(route).getNavigableRoute()

describe('getNavigableRoute', () => {
  it('is the page itself when it has content', () => {
    expect(landing([page('/'), page('/about')], '/about')).toBe('/about')
  })

  it('goes past an empty first child to the first descendant with content', () => {
    const pages = [
      page('/'),
      page('/docs', { hasContent: false }),
      page('/docs/empty', { hasContent: false }),
      page('/docs/intro'),
    ]
    expect(landing(pages, '/docs')).toBe('/docs/intro')
  })

  it('walks depth-first, in page order', () => {
    const pages = [
      page('/'),
      page('/docs', { hasContent: false }),
      page('/docs/guides', { hasContent: false }),
      page('/docs/guides/start'),
      page('/docs/reference'),
    ]
    expect(landing(pages, '/docs')).toBe('/docs/guides/start')
  })

  it('stays on a folder that has an index child', () => {
    const pages = [
      page('/'),
      page('/articles', { hasContent: false }),
      page('/articles/index', { isIndex: true }),
      page('/articles/first'),
    ]
    const website = siteWith(pages)
    const folder = website.pages.find((p) => p.route === '/articles')
    expect(folder.getNavigableRoute()).toBe('/articles')
  })

  it('is its own route when nothing below it has content', () => {
    const pages = [
      page('/'),
      page('/drafts', { hasContent: false }),
      page('/drafts/empty', { hasContent: false }),
    ]
    expect(landing(pages, '/drafts')).toBe('/drafts')
  })
})
