/**
 * getBranchHierarchy — the page tree narrowed to the branch a route sits in.
 *
 * Every documentation shell built on this framework hand-wrote this narrowing,
 * which is the argument for it living beside getPageHierarchy: it is a question
 * about the page graph, and nothing about it is React or DOM.
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

const SITE = [
  page('/'),
  page('/about'),
  page('/docs', { hasContent: false }),
  page('/docs/guides', { hasContent: false }),
  page('/docs/guides/intro'),
  page('/docs/reference'),
  page('/blog'),
  page('/blog/first-post'),
]

const routesOf = tree => tree.map(p => p.route)

describe('getBranchHierarchy', () => {
  it('narrows to the branch the route sits in', () => {
    const tree = siteWith(SITE).getBranchHierarchy({ route: '/docs/guides/intro' })

    expect(routesOf(tree)).toEqual(['/docs/guides', '/docs/reference'])
  })

  it('narrows the same way from the branch root itself', () => {
    const tree = siteWith(SITE).getBranchHierarchy({ route: '/docs' })

    expect(routesOf(tree)).toEqual(['/docs/guides', '/docs/reference'])
  })

  it('follows the route rather than any one branch — a sidebar is general', () => {
    const tree = siteWith(SITE).getBranchHierarchy({ route: '/blog/first-post' })

    expect(routesOf(tree)).toEqual(['/blog/first-post'])
  })

  it('answers the branch itself when it has no children', () => {
    const tree = siteWith(SITE).getBranchHierarchy({ route: '/about' })

    expect(routesOf(tree)).toEqual(['/about'])
  })

  it('answers the whole hierarchy at the site root', () => {
    const tree = siteWith(SITE).getBranchHierarchy({ route: '/' })

    expect(routesOf(tree)).toEqual(expect.arrayContaining(['/about', '/docs', '/blog']))
  })

  it('answers the whole hierarchy for a route in no known branch', () => {
    const tree = siteWith(SITE).getBranchHierarchy({ route: '/nowhere/at/all' })

    expect(routesOf(tree)).toEqual(expect.arrayContaining(['/about', '/docs', '/blog']))
  })

  it('tolerates a missing route', () => {
    expect(routesOf(siteWith(SITE).getBranchHierarchy())).toEqual(
      expect.arrayContaining(['/about', '/docs'])
    )
  })

  it('checks hideIn against the area named, not against the header', () => {
    // The reason `for:` is worth passing: a page can sit out of the docs rail
    // while staying in the site menu. Asking as 'header' — which is what every
    // hand-written version did — conflates the two.
    const site = siteWith([
      page('/docs', { hasContent: false }),
      page('/docs/guides'),
      page('/docs/internal', { hideIn: ['left'] }),
    ])

    expect(routesOf(site.getBranchHierarchy({ route: '/docs', for: 'left' })))
      .toEqual(['/docs/guides'])
    expect(routesOf(site.getBranchHierarchy({ route: '/docs', for: 'header' })))
      .toEqual(['/docs/guides', '/docs/internal'])
  })

  it('keeps the order the build settled on', () => {
    // `pages:` lists are resolved at build time, so the graph arrives ordered
    // and a rail has nothing to re-sort. The hand-written versions re-sorted at
    // runtime from a duplicated list, which is a runtime fix for a build fact.
    const site = siteWith([
      page('/docs', { hasContent: false }),
      page('/docs/zulu'),
      page('/docs/alpha'),
    ])

    expect(routesOf(site.getBranchHierarchy({ route: '/docs' }))).toEqual([
      '/docs/zulu',
      '/docs/alpha',
    ])
  })
})
