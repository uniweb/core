/**
 * getPageHierarchy — a record's page is in no menu, in any lane.
 *
 * The SPA makes a parametric page's page for a record on a visit and keeps it out of the
 * page list, so no menu lists it. A static build expands the parametric page into one
 * ordinary page per record (`@uniweb/build`'s `expandDynamicPages`), each carrying the
 * `dynamicContext` the SPA gives the page it makes — and those must read the same: a blog's
 * menu does not grow a dropdown of every article because the site was built.
 */

import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

function siteWith(pages) {
  return new Website({
    content: {
      config: { name: 'Blog', defaultLanguage: 'en' },
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

// One page per record, as the static build writes it.
const recordPage = (slug) =>
  page(`/blog/${slug}`, {
    isDynamic: false,
    dynamicContext: {
      templateRoute: '/blog/:slug',
      params: { slug, path: slug, dir: '' },
      paramName: 'slug',
      paramValue: slug,
    },
  })

const SITE = [page('/'), page('/blog'), recordPage('first-post'), recordPage('second-post'), page('/about')]

const routesOf = (tree) => tree.map((p) => p.route)

describe('getPageHierarchy — record pages', () => {
  it('leaves a record page out of the menus', () => {
    const tree = siteWith(SITE).getPageHierarchy({ for: 'header' })

    expect(routesOf(tree)).toEqual(['/', '/blog', '/about'])
    expect(tree.find((p) => p.route === '/blog').children).toEqual([])
  })

  it('leaves it out of a flat list of every page too', () => {
    const all = siteWith(SITE).getPageHierarchy({ nested: false, includeHidden: true })

    expect(routesOf(all)).toEqual(['/', '/blog', '/about'])
  })

  it('still routes to it', () => {
    const site = siteWith(SITE)

    expect(site.pages.map((p) => p.route)).toContain('/blog/first-post')
  })
})
