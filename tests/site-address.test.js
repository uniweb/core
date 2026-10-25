/**
 * A site's address, and the absolute URLs stated on it (`site-address.js`) — the one rule a page's
 * canonical, its alternates, the sitemap and the agent index all use.
 */
import { describe, it, expect } from 'vitest'
import { siteAddress, pageUrl, absoluteUrl } from '../src/site-address.js'

const PAGES = 'https://octocat.github.io/handbook/'

describe('siteAddress', () => {
  it('is an absolute http(s) URL, with a trailing slash and no query or fragment', () => {
    expect(siteAddress('https://octocat.github.io/handbook')).toBe(PAGES)
    expect(siteAddress('https://example.com')).toBe('https://example.com/')
    expect(siteAddress(' https://example.com/?ref=x#top ')).toBe('https://example.com/')
    expect(siteAddress('http://localhost:5173')).toBe('http://localhost:5173/')
  })

  it('is null for anything that is not one — a string that merely parses included', () => {
    for (const value of [undefined, null, '', '  ', '/handbook/', 'example.com', 'localhost:8080', 'ftp://example.com', 42]) {
      expect(siteAddress(value), String(value)).toBeNull()
    }
  })
})

describe('pageUrl', () => {
  it('joins a route under the address, base path included — the root is the address', () => {
    expect(pageUrl(PAGES, '/books/field-guide')).toBe(`${PAGES}books/field-guide`)
    expect(pageUrl(PAGES, '/')).toBe(PAGES)
    expect(pageUrl('https://example.com', '/about')).toBe('https://example.com/about')
  })

  it('⭐ ends in a slash where pages are served as directories — the URL that answers, not a redirect', () => {
    expect(pageUrl(PAGES, '/books/x', { trailingSlash: true })).toBe(`${PAGES}books/x/`)
    expect(pageUrl(PAGES, '/books/x/', { trailingSlash: true })).toBe(`${PAGES}books/x/`)
    expect(pageUrl(PAGES, '/', { trailingSlash: true })).toBe(PAGES)
  })

  it('takes a route as it is — a route that starts like the base path is still a route', () => {
    // A site served at /docs/ with a docs folder of its own: the page is /docs/docs/intro.
    expect(pageUrl('https://example.com/docs/', '/docs/intro')).toBe('https://example.com/docs/docs/intro')
  })

  it('encodes what a URL path cannot hold', () => {
    expect(pageUrl('https://example.com', '/libros/año')).toBe('https://example.com/libros/a%C3%B1o')
  })

  it('returns a locale’s own domain as it is, and states nothing without an address', () => {
    expect(pageUrl(PAGES, 'https://fr.example.com/livres', { trailingSlash: true })).toBe('https://fr.example.com/livres')
    expect(pageUrl(null, '/books/x')).toBeNull()
    expect(pageUrl('', '/')).toBeNull()
  })
})

describe('absoluteUrl', () => {
  it('a path from the site root gets the base path, once', () => {
    expect(absoluteUrl(PAGES, '/og/default.png')).toBe(`${PAGES}og/default.png`)
    // Already based, as a built asset path is: not based twice.
    expect(absoluteUrl(PAGES, '/handbook/assets/card.webp')).toBe(`${PAGES}assets/card.webp`)
    expect(absoluteUrl('https://example.com', '/og.png?v=2')).toBe('https://example.com/og.png?v=2')
  })

  it('an absolute URL is returned as it is; a protocol-relative one takes the address’s scheme', () => {
    expect(absoluteUrl(PAGES, 'https://acme.com/og/default.png')).toBe('https://acme.com/og/default.png')
    expect(absoluteUrl(PAGES, '//cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png')
    expect(absoluteUrl(null, 'https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png')
  })

  it('a relative path resolves from the site’s root, and nothing is stated without an address', () => {
    expect(absoluteUrl(PAGES, 'og/card.png')).toBe(`${PAGES}og/card.png`)
    expect(absoluteUrl(null, '/og/default.png')).toBeNull()
    expect(absoluteUrl(PAGES, '')).toBeNull()
  })
})
