/**
 * ⭐ **WHAT A URL NAMES — one function for every lane that asks.**
 *
 * A page, a redirect, a page proxied from elsewhere, or nothing: the SPA asks it on every
 * navigation, the static build asks it for every page it writes, a host rendering server-side
 * asks it before it fetches anything, and a server that runs no JS reproduces it from test
 * vectors generated from this code.
 *
 * ⛔ **Why it is a module rather than a method.** The rule used to live in `Website#getPage`
 * (the page), `PageRenderer.jsx` and `prerender.js` (the redirect, twice), and every host kept
 * a copy of its own around the renderer — a redirect target, a fallback matcher, a locale
 * redirect — each reading the same payload by a slightly different rule. Two copies that
 * disagree give two answers to one URL, and nothing fails: a container redirected to an empty
 * page on one lane and to its content on another. It reads only a locale's site content, so
 * every lane can call it and none needs a copy.
 *
 * What it does NOT decide: whether the record behind a parametric page exists. That is a data
 * question, answered by the render's data step (`Website#_createDynamicPage`); the question a
 * records service is asked for it is the other vector file (`record-miss`).
 *
 * @module @uniweb/core/resolve-route
 */

import { decodeRouteValue, matchDynamicRoute, parentRouteOf } from './route-match.js'
import { resolveDefaultLocale } from './locale-config.js'

/** The not-found page's route. It is never a routable page of its own. */
export const NOT_FOUND_ROUTE = '/404'

/** The status a host that sends one sends for each answer. */
export const RESOLUTION_STATUS = Object.freeze({
  page: 200,
  notFound: 404,
  // A page's redirect — authored, or a page with no content going to its content. Temporary:
  // what a container lands on changes when its pages do.
  pageRedirect: 302,
  // The locale a host serves unprefixed, asked for with its prefix: the same page, for good.
  localeRedirect: 301,
})

const hasContent = (page) => (page.hasContent ?? (Array.isArray(page.sections) && page.sections.length > 0)) === true
const isIndex = (page) => page.isIndex === true

/** An index page's own URL: `/articles/index` → `/articles`. */
function navRoute(page) {
  if (isIndex(page) && page.route.endsWith('/index')) return page.route.slice(0, -'/index'.length) || '/'
  return page.route
}

/**
 * What `resolveRoute` reads of one locale's site content — build it once per payload and pass
 * it instead of the content when resolving many paths.
 *
 * @param {Object} content - one locale's site content: `{ pages, config, notFound? }`
 * @returns {Object} the index
 */
export function routeIndex(content = {}) {
  const all = Array.isArray(content?.pages) ? content.pages : []
  const config = content?.config || {}
  const pages = all.filter((p) => p && typeof p.route === 'string' && p.route !== NOT_FOUND_ROUTE)

  // The one parent rule (`parentRouteOf`), over the same relation `Website#buildPageHierarchy`
  // links: a page's children, in page order.
  // A route's page: the FIRST page holding it, as a lookup in page order finds it.
  const byRoute = new Map()
  for (const page of pages) if (!byRoute.has(page.route)) byRoute.set(page.route, page)
  const has = (route) => byRoute.has(route)
  const childrenOf = new Map()
  for (const page of pages) {
    const parent = parentRouteOf(page.route, { declared: page.parent || null, has })
    if (!parent || parent === page.route) continue
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(page)
  }

  const translations = {}
  for (const [locale, routesOf] of Object.entries(config.i18n?.routeTranslations || {})) {
    const forward = new Map()
    const reverse = new Map()
    for (const [canonical, translated] of Object.entries(routesOf || {})) {
      forward.set(canonical, translated)
      reverse.set(translated, canonical)
    }
    translations[locale] = { forward, reverse }
  }

  const siteDefaultLocale = resolveDefaultLocale(config)
  const defaultLocale = config.domainLocale || siteDefaultLocale
  return {
    pages,
    byRoute,
    childrenOf,
    notFound: content?.notFound || all.find((p) => p?.route === NOT_FOUND_ROUTE) || null,
    translations,
    siteDefaultLocale,
    // The locale this host serves unprefixed: the host's own, else the site's default.
    defaultLocale,
    activeLocale: config.activeLocale || defaultLocale,
    locales: servedLocales(config, siteDefaultLocale),
    domainLocales: config.domainLocales || null,
  }
}

function servedLocales(config, siteDefaultLocale) {
  const codes = [siteDefaultLocale]
  for (const entry of Array.isArray(config.languages) ? config.languages : []) {
    const code = typeof entry === 'string' ? entry : entry?.code
    if (typeof code === 'string' && code && !codes.includes(code)) codes.push(code)
  }
  return codes
}

const indexOf = (site) => (site && site.byRoute instanceof Map ? site : routeIndex(site))

/** A canonical route → the route this locale shows it at (`/blog` → `/noticias`, by prefix too). */
export function translateRoute(site, canonicalRoute, locale) {
  const index = indexOf(site)
  if (!locale || locale === index.siteDefaultLocale) return canonicalRoute
  const entry = index.translations[locale]
  if (!entry) return canonicalRoute
  const exact = entry.forward.get(canonicalRoute)
  if (exact) return exact
  for (const [canonical, translated] of entry.forward) {
    if (canonicalRoute.startsWith(canonical + '/')) return translated + canonicalRoute.slice(canonical.length)
  }
  return canonicalRoute
}

/**
 * A route a locale shows → its canonical route. Decoded first: a browser percent-encodes a
 * translated slug, and the translations are authored as plain text.
 */
export function reverseTranslateRoute(site, displayRoute, locale) {
  const index = indexOf(site)
  if (!locale || locale === index.siteDefaultLocale) return displayRoute
  const entry = index.translations[locale]
  if (!entry) return displayRoute
  const route = decodeRouteValue(displayRoute)
  const exact = entry.reverse.get(route)
  if (exact) return exact
  for (const [translated, canonical] of entry.reverse) {
    if (route.startsWith(translated + '/')) return canonical + route.slice(translated.length)
  }
  return route
}

/**
 * ⭐ **A PAGE'S URL IN A LOCALE** — the one rule the language switcher, a redirect's destination
 * and the canonical form share. The locale served unprefixed shows the canonical route; a locale
 * with a domain of its own is that domain; any other is `/{code}` plus its translated route.
 *
 * @param {Object} site - a locale's site content, or its `routeIndex`
 * @param {string} localeCode - the locale the URL is for
 * @param {string} route - the page's route, canonical or as the active locale shows it
 * @param {{ activeLocale?: string, defaultLocale?: string }} [context]
 * @returns {string} a path, or an absolute URL on a locale's own domain
 */
export function localeUrl(site, localeCode, route, context = {}) {
  const index = indexOf(site)
  const activeLocale = context.activeLocale ?? index.activeLocale
  const defaultLocale = context.defaultLocale ?? index.defaultLocale
  let target = route

  // The active locale's prefix, then its display route → canonical.
  if (activeLocale && activeLocale !== defaultLocale) {
    const prefix = `/${activeLocale}`
    if (target === prefix || target === `${prefix}/`) target = '/'
    else if (target.startsWith(`${prefix}/`)) target = target.slice(prefix.length)
  }
  target = reverseTranslateRoute(index, target, activeLocale)

  const designated = index.domainLocales && Object.entries(index.domainLocales).find(([, lang]) => lang === localeCode)
  if (designated) {
    const translated = translateRoute(index, target, localeCode)
    return `https://${designated[0]}${translated === '/' ? '/' : translated}`
  }
  // The locale served unprefixed: no prefix — and its own slugs, unless it is the site's default,
  // whose routes are the canonical ones. ⛔ Until 2026-09-30 this returned the canonical route for a
  // host's own locale too: on a French host a French reader was sent to `/docs/intro`, not
  // `/documents/introduction`.
  if (localeCode === defaultLocale) return translateRoute(index, target, localeCode)
  const translated = translateRoute(index, target, localeCode)
  return translated === '/' ? `/${localeCode}/` : `/${localeCode}${translated}`
}

/**
 * The locale a path names by its prefix, and the path without it — for a host choosing which
 * locale's content to resolve a request against. A path with no served locale's prefix is the
 * locale served unprefixed: the host's own (`domainLocale`), else the site's default.
 *
 * @param {string} path - the request path, base removed
 * @param {Object} config - the site's config (`languages`, `defaultLanguage`, `domainLocale`)
 * @returns {{ locale: string, prefixed: boolean, path: string }}
 */
export function localeOfPath(path, config = {}) {
  const siteDefault = resolveDefaultLocale(config)
  const unprefixed = config.domainLocale || siteDefault
  const raw = typeof path === 'string' && path ? path : '/'
  const first = raw.split('/')[1] || ''
  if (first && servedLocales(config, siteDefault).includes(first)) {
    const rest = raw.slice(first.length + 1)
    return { locale: first, prefixed: true, path: rest || '/' }
  }
  return { locale: unprefixed, prefixed: false, path: raw }
}

/**
 * The page a path names — as `Website#getPage` has always found it — or null.
 *
 * In order: the active locale's prefix comes off; the page whose route is the path as given (a
 * published payload may carry a locale's own routes); else the path reverse-translated and the
 * page of that canonical route (a folder resolving to its `isIndex` child either way); else an
 * index page whose own URL is the path; else the parametric pages in page order, against the
 * canonical route and then the path as given. A static page always wins.
 *
 * @returns {{ page: Object, route: string, params: Object, template: string|null } | null}
 */
function findPage(index, path, { activeLocale, defaultLocale }) {
  let stripped = decodeRouteValue(path)
  if (activeLocale && activeLocale !== defaultLocale) {
    const prefix = `/${activeLocale}`
    if (stripped === prefix || stripped === `${prefix}/`) stripped = '/'
    else if (stripped.startsWith(`${prefix}/`)) stripped = stripped.slice(prefix.length)
  }
  const asGiven = stripped === '/' ? '/' : stripped.replace(/\/$/, '')

  const promoted = (page) => (index.childrenOf.get(page.route) || []).find(isIndex) || page
  const exactly = (route) => index.byRoute.get(route)

  const direct = exactly(asGiven)
  if (direct) {
    const page = promoted(direct)
    return { page, route: page.route, params: {}, template: null }
  }

  const reversed = reverseTranslateRoute(index, asGiven, activeLocale)
  const canonical = reversed === '/' ? '/' : reversed.replace(/\/$/, '')
  const exact = exactly(canonical)
  if (exact) {
    const page = promoted(exact)
    return { page, route: page.route, params: {}, template: null }
  }

  const indexPage = index.pages.find((p) => isIndex(p) && navRoute(p) === canonical)
  if (indexPage) return { page: indexPage, route: indexPage.route, params: {}, template: null }

  for (const candidate of new Set([canonical, asGiven])) {
    for (const page of index.pages) {
      if (!page.route.includes(':')) continue
      const hit = matchDynamicRoute(page.route, candidate)
      if (hit) return { page, route: candidate, params: hit.params, template: page.route }
    }
  }
  return null
}

/**
 * Where a page with no content of its own lands: itself when it has an `isIndex` child, else its
 * first descendant with content, depth-first in page order — or null when nothing in it has
 * content.
 *
 * @param {Object} site - a locale's site content, or its `routeIndex`
 * @param {Object} page - a page of it
 * @returns {string|null}
 */
export function landingRoute(site, page, seen = new Set()) {
  const index = indexOf(site)
  if (!page || seen.has(page.route)) return null
  seen.add(page.route)
  if (hasContent(page)) return page.route
  const children = index.childrenOf.get(page.route) || []
  if (children.some(isIndex)) return page.route
  for (const child of children) {
    const route = landingRoute(index, child, seen)
    if (route) return route
  }
  return null
}

/**
 * ⭐ **RESOLVE A PATH** against one locale's site content.
 *
 * ```
 * { kind: 'page',     status: 200, page, route, params, template }
 * { kind: 'redirect', status: 302 | 301, location, reason: 'authored' | 'container' | 'locale', page?, … }
 * { kind: 'rewrite',  target, page, … }          — the page is served from `target`, by a host that proxies
 * { kind: 'notFound', status: 404, page }        — `page`: the site's not-found page, or null
 * ```
 *
 * In order:
 * 1. **The locale served unprefixed, asked for with its prefix** — `/en/docs` where `en` is the
 *    default (or the host's own locale) — is a `301` to the path without it. Ruled 2026-09-30
 *    [Diego]; until then no page matched it.
 * 2. **The page** (`findPage`). None ⇒ `notFound`, with the site's not-found page: its
 *    `notFound` content, else the page at `/404`.
 * 3. **An authored `redirect:`** ⇒ a `302` to it: a page of the site in this locale, anything
 *    else as written (`authoredRedirectLocation`).
 * 4. **An authored `rewrite:`** ⇒ the page is served from there; only a host that proxies can.
 * 5. **A page with no content** ⇒ a `302` to where it lands (`landingRoute`), in this locale
 *    (`localeUrl`) — when that is not the page itself.
 * 6. Otherwise the page. A parametric page's record may still not exist; that is the render's
 *    data step to say.
 *
 * `status` is what a host that sends one sends. A static host has its own ways to say each kind.
 *
 * @param {Object} site - one locale's site content (`{ pages, config, notFound? }`), or its `routeIndex`
 * @param {string} path - the request path, with any deployment base removed
 * @param {{ activeLocale?: string, defaultLocale?: string }} [context] - defaults to the content's
 *   own (`config.activeLocale`, `config.domainLocale`)
 * @returns {Object} the resolution
 */
export function resolveRoute(site, path, context = {}) {
  const index = indexOf(site)
  const activeLocale = context.activeLocale ?? index.activeLocale
  const defaultLocale = context.defaultLocale ?? index.defaultLocale
  const raw = typeof path === 'string' && path ? path : '/'

  // 1 · the unprefixed locale, asked for with its prefix. The rest of the path goes as written.
  if (defaultLocale) {
    const prefix = `/${defaultLocale}`
    if (raw === prefix || raw === `${prefix}/`) return redirect('/', RESOLUTION_STATUS.localeRedirect, 'locale')
    if (raw.startsWith(`${prefix}/`)) return redirect(raw.slice(prefix.length), RESOLUTION_STATUS.localeRedirect, 'locale')
  }

  // 2 · the page
  const found = findPage(index, raw, { activeLocale, defaultLocale })
  if (!found) return { kind: 'notFound', status: RESOLUTION_STATUS.notFound, page: index.notFound }
  const { page } = found

  // 3 · 4 · what an author wrote on the page
  if (typeof page.redirect === 'string' && page.redirect) {
    const location = authoredRedirectLocation(index, found.route, page.redirect, { activeLocale, defaultLocale })
    return { ...redirect(location, RESOLUTION_STATUS.pageRedirect, 'authored'), ...found }
  }
  if (typeof page.rewrite === 'string' && page.rewrite) {
    return { kind: 'rewrite', target: page.rewrite, ...found }
  }

  // 5 · a page with no content goes to its content. The DECISION is canonical (`page.route`);
  // the DESTINATION is this locale's URL for it.
  if (!hasContent(page)) {
    const landing = landingRoute(index, page)
    if (landing && landing !== page.route) {
      const location = localeUrl(index, activeLocale, landing, { activeLocale, defaultLocale })
      return { ...redirect(location, RESOLUTION_STATUS.pageRedirect, 'container'), ...found }
    }
  }

  return { kind: 'page', status: RESOLUTION_STATUS.page, ...found }
}

function redirect(location, status, reason) {
  return { kind: 'redirect', status, location, reason }
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * An authored `redirect:` resolved against the page that carries it, as a browser resolves a
 * relative URL with the page as a FOLDER: a URL with a scheme, or a protocol-relative one, as
 * written; `academic` on `/solutions` is `/solutions/academic`; `./x` and `../x` step as they do
 * in a URL, on a relative target and on a path from the root alike. A trailing slash and an empty
 * segment are kept, as a URL keeps them — the page a path names is matched with a trailing slash
 * or without. Any query or fragment rides along untouched.
 *
 * The build resolves a site's redirects by this rule, and `resolveRoute` resolves a payload's that
 * were not (a pushed page carries its target as written). ⛔ Until 2026-09-30 a relative target was
 * joined to the page's route and no `.` or `..` was resolved, so `../pricing` stayed in the path.
 *
 * @param {string} route - the page's own route
 * @param {string} target - its `redirect:`
 * @returns {string}
 */
export function authoredRedirectTarget(route, target) {
  if (typeof target !== 'string' || !target) return target
  if (target.startsWith('//') || HAS_SCHEME.test(target)) return target
  const cut = target.search(/[?#]/)
  const path = cut < 0 ? target : target.slice(0, cut)
  const suffix = cut < 0 ? '' : target.slice(cut)
  const base = route === '/' ? '/' : `${route}/`
  return removeDotSegments(path.startsWith('/') ? path : base + path) + suffix
}

/** RFC 3986 § 5.2.4 for a path from the root: `.` and `..` segments resolved, nothing else changed. */
function removeDotSegments(path) {
  const segments = path.split('/').slice(1)
  const out = []
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1
    if (segment === '.' || segment === '..') {
      if (segment === '..') out.pop()
      if (last) out.push('')
      return
    }
    out.push(segment)
  })
  return '/' + out.join('/')
}

/**
 * ⭐ WHERE AN AUTHORED REDIRECT SENDS A VISITOR OF THIS LOCALE — a page of the site in their
 * language, as a page with no content sends them (ruled for containers 2026-09-30 [Diego]; for an
 * authored redirect the same day, asked by the host that serves it).
 *
 * - A URL with a scheme, a protocol-relative one, or a path that already carries a served locale's
 *   prefix: as written — the author named where.
 * - A path naming a page of the site: that page's URL in this locale (`localeUrl`) — its prefix and
 *   its translated slugs — with any query or fragment kept.
 * - Any other path — a file, a route the site does not hold: as written.
 *
 * The author wrote the target against the CANONICAL routes, whatever routes the payload's pages
 * carry: a relative one resolves against the page's canonical route, and a page is found by its
 * canonical route or, on a payload whose pages carry this locale's own routes, through the
 * translations. Both kinds of payload give one answer.
 *
 * ⛔ Until 2026-09-30 every authored redirect went as written, so a French visitor was sent to the
 * English page, and a relative target was left for the browser to resolve against the URL it had
 * asked for rather than the page. ⛔ Until 2026-10-01 the target was looked up only as a route of
 * the payload, so on a payload of French routes `/blog` named no page and the French visitor was
 * still sent to the English one.
 *
 * @returns {string}
 */
function authoredRedirectLocation(index, route, target, { activeLocale, defaultLocale }) {
  const resolved = authoredRedirectTarget(reverseTranslateRoute(index, route, activeLocale), target)
  if (!resolved.startsWith('/') || resolved.startsWith('//')) return resolved
  const cut = resolved.search(/[?#]/)
  const path = cut < 0 ? resolved : resolved.slice(0, cut)
  const suffix = cut < 0 ? '' : resolved.slice(cut)
  const first = path.split('/')[1] || ''
  if (first && index.locales.includes(first)) return resolved
  const canonical = path === '/' ? '/' : path.replace(/\/$/, '')
  if (!namesPage(index, canonical, activeLocale)) return resolved
  return localeUrl(index, activeLocale, canonical, { activeLocale, defaultLocale }) + suffix
}

/** Whether a canonical route names a page of the payload: by that route, or by this locale's. */
function namesPage(index, canonical, locale) {
  const asCanonical = { activeLocale: index.siteDefaultLocale, defaultLocale: index.siteDefaultLocale }
  return Boolean(
    findPage(index, canonical, asCanonical) || findPage(index, translateRoute(index, canonical, locale), asCanonical),
  )
}
