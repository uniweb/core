/**
 * A SITE'S ADDRESS — the absolute URL of its root as the public reaches it: scheme, host and base
 * path, `https://octocat.github.io/handbook/`. A zero-dependency leaf, like `base-path.js`,
 * because the runtime, `@uniweb/projections` (Worker-safe) and the build all state absolute URLs and
 * must state them by one rule.
 *
 * Every absolute URL a site states about itself is its address joined with a path: a page's own —
 * its canonical, `og:url`, its hreflang alternates, its sitemap entry — by `pageUrl`, and anything
 * the site's content links to — a social card image — by `absoluteUrl`. ⛔ Until 2026-10-25 five
 * places composed one, three ways: the sitemap and the page tags joined an origin to a route and
 * left the base path out, the agent index put it in, and `og:url` was a bare route. A site served
 * under a base path got wrong absolute URLs whatever it set.
 *
 * ⭐ THE ADDRESS IS STATED BY WHOEVER DEPLOYS THE SITE, and reaches the runtime in the payload as
 * `config.url`, beside `config.base`: a host states its own, and a static build states what its
 * deploy target or its author gives it (`@uniweb/build`). Nothing here derives one — not from a
 * request, not from the document's location — so an unknown address is null, and a caller states no
 * absolute URL rather than a guessed one.
 *
 * ⭐ A PAGE'S URL IS THE ONE THAT ANSWERS WITH THE PAGE. A static build writes `<route>/index.html`,
 * and a static host answers `/books/x/` with that file and `/books/x` with a redirect to it, so there
 * a page's URL ends in `/`. That is `config.trailingSlash`, stated with the address by whoever lays
 * out what is served.
 *
 * @module @uniweb/core/site-address
 */

import { applyBasePath } from './base-path.js'

/**
 * A site's address as given, normalized: an absolute http(s) URL with a trailing slash and no query
 * or fragment. Null when it is not one.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function siteAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  // A string that parses is not yet an address: `localhost:8080` parses, with `localhost:` as its
  // scheme. Only http(s) with a host is one.
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) return null
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/**
 * A page's URL on the site at `address`: its route joined under the address, ending in `/` when the
 * site's pages are served as directories. The root is the address itself.
 *
 * @param {string} address - the site's address (`siteAddress`)
 * @param {string} route - the page's route from the site's root, as its locale shows it and with no
 *   base applied (`/books/x`, `/fr/livres/x`) — or an absolute URL, a locale on a domain of its own
 *   (`localeUrl`), returned as it is
 * @param {{ trailingSlash?: boolean }} [options]
 * @returns {string|null} null when the address is unknown
 */
export function pageUrl(address, route, { trailingSlash = false } = {}) {
  if (typeof route === 'string' && /^https?:\/\//i.test(route)) return route
  const root = siteAddress(address)
  if (!root || typeof route !== 'string') return null
  const path = route.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!path) return root
  // Resolved rather than concatenated, so a route that holds what a URL path cannot is encoded.
  return new URL(`${path}${trailingSlash ? '/' : ''}`, root).href
}

/**
 * The absolute URL of something the site's content links to — a social card image, a path an author
 * wrote — on the site at `address`. A path from the site's root gets the address's base path as any
 * href of the site does (`applyBasePath`, so never twice), a protocol-relative one the address's
 * scheme, and an absolute URL is returned as it is.
 *
 * @param {string} address - the site's address (`siteAddress`)
 * @param {string} href
 * @returns {string|null} null when `href` is not absolute and the address is unknown
 */
export function absoluteUrl(address, href) {
  if (typeof href !== 'string' || !href) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return href
  const root = siteAddress(address)
  if (!root) return null
  if (href.startsWith('//')) return new URL(href, root).href
  const { origin, pathname } = new URL(root)
  const path = href.startsWith('/') ? applyBasePath(href, pathname.replace(/\/$/, '')) : `${pathname}${href}`
  return new URL(path, origin).href
}
