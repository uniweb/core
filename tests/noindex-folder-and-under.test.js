/**
 * Two questions about the page tree that a versioned section brought up, and that any site can ask.
 */
import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

function siteWith(pages) {
  return new Website({ content: { config: { name: 'Site', defaultLanguage: 'en' }, theme: {}, pages } })
}
const page = (route, extra = {}) => ({ route, title: route.split('/').pop() || 'Home', sections: [], hasContent: true, ...extra })
const folder = (route, extra = {}) => page(route, { hasContent: false, ...extra })
const robotsOf = (site, route) => site.pages.find((p) => p.route === route).getHeadMeta().robots
const NOINDEX = { seo: { noindex: true } }

describe('a folder\'s `noindex` covers the pages in it', () => {
  const site = () =>
    siteWith([
      page('/open'),
      folder('/old', NOINDEX),
      page('/old/a'),
      page('/old/a/b'),
      page('/landing', NOINDEX),
      page('/landing/child'),
    ])

  it('at any depth', () => {
    expect(robotsOf(site(), '/old')).toBe('noindex, nofollow')
    expect(robotsOf(site(), '/old/a')).toBe('noindex, nofollow')
    expect(robotsOf(site(), '/old/a/b')).toBe('noindex, nofollow')
  })

  it('and nothing beside it', () => {
    expect(robotsOf(site(), '/open')).toBeNull()
  })

  it('a page with content of its own speaks only for itself, as the sitemap reads it', () => {
    expect(robotsOf(site(), '/landing')).toBe('noindex, nofollow')
    expect(robotsOf(site(), '/landing/child')).toBeNull()
  })
})

describe('getPageHierarchy `under`', () => {
  const routes = (items) => items.map((item) => item.route)

  it('is the pages below a route', () => {
    const site = siteWith([folder('/docs'), page('/docs/a'), page('/docs/a/b'), page('/docs/c'), page('/other')])
    const tree = site.getPageHierarchy({ under: '/docs' })
    expect(routes(tree)).toEqual(['/docs/a', '/docs/c'])
    expect(routes(tree[0].children)).toEqual(['/docs/a/b'])
  })

  it('whether or not the route is listed itself', () => {
    const site = siteWith([folder('/docs', { hideIn: ['*'] }), page('/docs/a')])
    expect(routes(site.getPageHierarchy())).toEqual([])
    expect(routes(site.getPageHierarchy({ under: '/docs' }))).toEqual(['/docs/a'])
  })

  it('an area still applies to what is below it', () => {
    const site = siteWith([folder('/docs'), page('/docs/a', { hideIn: ['left'] }), page('/docs/b')])
    expect(routes(site.getPageHierarchy({ under: '/docs', for: 'left' }))).toEqual(['/docs/b'])
  })

  it('a route with no page has nothing below it', () => {
    const site = siteWith([page('/a')])
    expect(site.getPageHierarchy({ under: '/nope' })).toEqual([])
  })
})
