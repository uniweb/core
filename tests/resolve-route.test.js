/**
 * resolveRoute — what a URL names: a page, a redirect, a page served from elsewhere, or nothing.
 *
 * One function for every lane (`src/resolve-route.js`): the SPA through `Website#getPage` and
 * `Website#resolveRoute`, the static build through `Page#getNavigableRoute`, a host before it
 * fetches, and a backend that runs no JS through the vectors generated from it.
 */

import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'
import { resolveRoute, routeIndex, localeOfPath, localeUrl, landingRoute, authoredRedirectTarget } from '../src/resolve-route.js'

const page = (route, extra = {}) => ({ route, title: route, sections: [{ type: 'Text' }], ...extra })
const empty = (route, extra = {}) => ({ route, title: route, sections: [], hasContent: false, ...extra })

const PAGES = [
  page('/', { isIndex: true }),
  page('/about'),
  empty('/docs'),
  empty('/docs/drafts'),
  page('/docs/intro'),
  empty('/articles'),
  page('/articles/index', { isIndex: true }),
  page('/articles/first'),
  page('/blog'),
  page('/blog/:slug', { isDynamic: true, paramName: 'slug' }),
  page('/blog/featured'),
  page('/wiki/:path*', { isDynamic: true, paramName: 'slug' }),
  page('/old', { redirect: '/about' }),
  empty('/moved', { redirect: 'https://example.com/elsewhere' }),
  empty('/shop', { rewrite: 'https://shop.example.com' }),
  page('/404', { title: 'Missing' }),
]

const content = (config = {}, pages = PAGES) => ({
  pages,
  config: { name: 'T', defaultLanguage: 'en', languages: ['en', 'fr'], ...config },
})

const FR = {
  activeLocale: 'fr',
  i18n: { routeTranslations: { fr: { '/about': '/a-propos', '/blog': '/blogue', '/docs': '/documents', '/docs/intro': '/documents/introduction' } } },
}

describe('a page', () => {
  it('by its route, a trailing slash and percent-encoding included', () => {
    expect(resolveRoute(content(), '/about')).toMatchObject({ kind: 'page', status: 200, route: '/about', template: null })
    expect(resolveRoute(content(), '/about/')).toMatchObject({ kind: 'page', route: '/about' })
    expect(resolveRoute(content(), '/%61bout')).toMatchObject({ kind: 'page', route: '/about' })
  })

  it('a folder with an isIndex child is that child, by its own URL too', () => {
    expect(resolveRoute(content(), '/articles')).toMatchObject({ kind: 'page', route: '/articles/index' })
  })

  it('a parametric page, with its params, and a static page wins over it', () => {
    expect(resolveRoute(content(), '/blog/hello')).toMatchObject({
      kind: 'page', route: '/blog/hello', template: '/blog/:slug', params: { slug: 'hello' },
    })
    expect(resolveRoute(content(), '/blog/featured')).toMatchObject({ kind: 'page', route: '/blog/featured', template: null })
    expect(resolveRoute(content(), '/wiki/a/b/c')).toMatchObject({ kind: 'page', template: '/wiki/:path*', params: { path: 'a/b/c' } })
  })

  it('in a locale: its prefix comes off, and a translated route reaches the canonical page', () => {
    expect(resolveRoute(content(FR), '/fr/a-propos')).toMatchObject({ kind: 'page', route: '/about' })
    expect(resolveRoute(content(FR), '/fr/blogue/bonjour')).toMatchObject({ kind: 'page', template: '/blog/:slug', params: { slug: 'bonjour' } })
    expect(resolveRoute(content(FR), '/fr')).toMatchObject({ kind: 'page', route: '/' })
  })
})

describe('a page asked for at another route than its locale shows it at', () => {
  // Ruled 2026-10-01 [Diego]: one URL per page per language — a `301`, as for the unprefixed
  // locale's own prefix. ⛔ Until then `/fr/about` was the French page on a payload of canonical
  // routes and not found on one whose pages carry the French routes.
  const own = content(FR, [
    page('/'), page('/a-propos'), page('/blogue'), page('/blogue/:slug', { isDynamic: true, paramName: 'slug' }),
    empty('/documents'), page('/documents/introduction'), page('/articles'), page('/404'),
  ])

  it('the canonical route under a translated locale: 301 to the locale\'s own, on both kinds of payload', () => {
    for (const site of [content(FR), own]) {
      expect(resolveRoute(site, '/fr/about')).toMatchObject({ kind: 'redirect', status: 301, reason: 'locale', location: '/fr/a-propos' })
      expect(resolveRoute(site, '/fr/blog')).toMatchObject({ status: 301, location: '/fr/blogue' })
      expect(resolveRoute(site, '/fr/blog/hello')).toMatchObject({ status: 301, location: '/fr/blogue/hello' })
      expect(resolveRoute(site, '/fr/documents/intro')).toMatchObject({ status: 301, location: '/fr/documents/introduction' })
    }
  })

  it('it still names the page, so a Website still finds it', () => {
    expect(resolveRoute(content(FR), '/fr/about')).toMatchObject({ route: '/about', page: expect.objectContaining({ route: '/about' }) })
    expect(resolveRoute(own, '/fr/about').page).toMatchObject({ route: '/a-propos' })
  })

  it('a redirect or a container goes to its own destination, in one hop', () => {
    expect(resolveRoute(content(FR), '/fr/docs')).toMatchObject({ status: 302, reason: 'container', location: '/fr/documents/introduction' })
    expect(resolveRoute(own, '/fr/docs')).toMatchObject({ status: 302, reason: 'container', location: '/fr/documents/introduction' })
  })

  it('on a host whose own locale is translated, its unprefixed canonical route too', () => {
    expect(resolveRoute(content({ ...FR, domainLocale: 'fr' }), '/about')).toMatchObject({ status: 301, location: '/a-propos' })
  })

  // Ruled 2026-10-01 [Diego, in backend's session]: "fold them into a single 301 straight to
  // /a-propos". ⛔ Until then `/fr/about` took two: to `/about` by the prefix, then to `/a-propos`.
  it('the host\'s own prefix and a translated route are ONE 301, straight to the locale\'s URL', () => {
    const frHost = content({ ...FR, domainLocale: 'fr' })
    expect(resolveRoute(frHost, '/fr/about')).toEqual({ kind: 'redirect', status: 301, location: '/a-propos', reason: 'locale' })
    expect(resolveRoute(frHost, '/fr/blog/hello')).toMatchObject({ status: 301, location: '/blogue/hello' })
  })

  it('the fold stops at 301s — a container\'s 302 is its own hop; a path naming no page goes as written', () => {
    const frHost = content({ ...FR, domainLocale: 'fr' })
    expect(resolveRoute(frHost, '/fr/docs')).toMatchObject({ status: 301, location: '/documents' })
    expect(resolveRoute(frHost, '/documents')).toMatchObject({ status: 302, reason: 'container' })
    expect(resolveRoute(frHost, '/fr/nothing')).toMatchObject({ status: 301, location: '/nothing' })
  })

  it('CONTROL — the locale\'s own route, an untranslated page, the default locale: the page', () => {
    for (const site of [content(FR), own]) {
      expect(resolveRoute(site, '/fr/a-propos')).toMatchObject({ kind: 'page', status: 200 })
      expect(resolveRoute(site, '/fr/a-propos/')).toMatchObject({ kind: 'page', status: 200 })
      expect(resolveRoute(site, '/fr/blogue/hello')).toMatchObject({ kind: 'page', status: 200 })
      expect(resolveRoute(site, '/fr/articles')).toMatchObject({ kind: 'page', status: 200 })
    }
    expect(resolveRoute(content(), '/about')).toMatchObject({ kind: 'page', status: 200 })
    expect(resolveRoute(content(), '/blog/hello')).toMatchObject({ kind: 'page', status: 200 })
  })
})

describe('not found', () => {
  it('names the site\'s not-found page: its notFound content, else the page at /404', () => {
    expect(resolveRoute(content(), '/nothing-here')).toEqual({ kind: 'notFound', status: 404, page: expect.objectContaining({ route: '/404' }) })
    const own = { route: '/404', title: 'Own' }
    expect(resolveRoute({ ...content(), notFound: own }, '/nothing-here').page).toBe(own)
    expect(resolveRoute(content({}, PAGES.filter((p) => p.route !== '/404')), '/x').page).toBeNull()
  })

  it('/404 itself is not a routable page', () => {
    expect(resolveRoute(content(), '/404').kind).toBe('notFound')
  })
})

describe('the locale served unprefixed, asked for with its prefix', () => {
  it('is a 301 to the path without it — ruled 2026-09-30', () => {
    expect(resolveRoute(content(), '/en/about')).toEqual({ kind: 'redirect', status: 301, location: '/about', reason: 'locale' })
    expect(resolveRoute(content(), '/en')).toMatchObject({ status: 301, location: '/' })
    expect(resolveRoute(content(), '/en/')).toMatchObject({ status: 301, location: '/' })
  })

  it('the host\'s own locale is the unprefixed one where it has one', () => {
    const onFrDomain = content({ domainLocale: 'fr' })
    expect(resolveRoute(onFrDomain, '/fr/about')).toMatchObject({ status: 301, location: '/about' })
    expect(resolveRoute(onFrDomain, '/about')).toMatchObject({ kind: 'page' })
  })

  it('CONTROL — another locale\'s prefix is that locale, never redirected', () => {
    expect(resolveRoute(content(FR), '/fr/a-propos').kind).toBe('page')
    expect(resolveRoute(content(), '/english-guide').kind).toBe('notFound')
  })
})

describe('a redirect', () => {
  it('an authored redirect: 302, as written', () => {
    expect(resolveRoute(content(), '/old')).toMatchObject({ kind: 'redirect', status: 302, reason: 'authored', location: '/about', route: '/old' })
    expect(resolveRoute(content(), '/moved')).toMatchObject({ reason: 'authored', location: 'https://example.com/elsewhere' })
  })

  describe('an authored redirect goes to a page of the site in the visitor\'s language', () => {
    // ⛔ Until 2026-09-30 every authored redirect went as written: a French visitor was sent to the
    // English page, and a relative target was left to the browser to resolve against its own URL.
    const pages = [
      page('/'), page('/about'), page('/docs'), page('/docs/a'), page('/solutions/academic'),
      empty('/solutions', { redirect: 'academic' }),
      page('/old', { redirect: '/docs/a' }),
      page('/frag', { redirect: '/docs/a#part' }),
      page('/file', { redirect: '/files/report.pdf' }),
      page('/pinned', { redirect: '/en/about' }),
    ]
    const site = (locale) => content({ activeLocale: locale, i18n: { routeTranslations: { fr: { '/docs': '/documents' } } } }, pages)
    const at = (locale, path) => resolveRoute(site(locale), path).location

    it('a page of the site: its URL in this locale, a query or fragment kept', () => {
      expect(at('en', '/old')).toBe('/docs/a')
      expect(at('fr', '/fr/old')).toBe('/fr/documents/a')
      expect(at('fr', '/fr/frag')).toBe('/fr/documents/a#part')
    })

    it('a relative target resolves against the page that carries it', () => {
      expect(at('en', '/solutions')).toBe('/solutions/academic')
      expect(at('fr', '/fr/solutions')).toBe('/fr/solutions/academic')
    })

    it('anything else as written: a file, a URL elsewhere, a path naming its locale', () => {
      expect(at('fr', '/fr/file')).toBe('/files/report.pdf')
      expect(at('fr', '/fr/pinned')).toBe('/en/about')
      expect(resolveRoute(content(FR), '/fr/moved')).toMatchObject({ reason: 'authored', location: 'https://example.com/elsewhere' })
    })

    describe('on a payload whose pages carry this locale\'s own routes, with the translations beside them', () => {
      // A host may serve a locale that way. The author wrote every target against the canonical
      // routes, so a target is found through the translations and a relative one resolves against
      // the page's canonical route.
      // ⛔ Until 2026-10-01 a canonical target matched no page of such a payload and went as
      // written: a French visitor was sent to the English page.
      const own = content({ activeLocale: 'fr', i18n: { routeTranslations: { fr: { '/docs': '/documents', '/docs/intro': '/documents/introduction', '/blog': '/blogue' } } } }, [
        page('/'), page('/documents'), page('/documents/introduction'), page('/blogue'),
        page('/blogue/:slug', { isDynamic: true, paramName: 'slug' }),
        page('/old', { redirect: '/docs/intro' }),
        page('/latest', { redirect: '/blog/hello' }),
        page('/documents/start', { redirect: '../intro' }),
        page('/documents/sheet', { redirect: 'files/sheet.pdf' }),
        page('/file', { redirect: '/files/report.pdf' }),
      ])
      const at = (path) => resolveRoute(own, path).location

      it('a page of the site: its URL in this locale', () => {
        expect(at('/fr/old')).toBe('/fr/documents/introduction')
        expect(at('/fr/latest')).toBe('/fr/blogue/hello')
      })

      it('a relative target: against the page\'s canonical route, as on a payload of canonical routes', () => {
        expect(at('/fr/documents/start')).toBe('/fr/documents/introduction')
        expect(at('/fr/documents/sheet')).toBe('/docs/sheet/files/sheet.pdf')
      })

      it('CONTROL — anything else as written', () => {
        expect(at('/fr/file')).toBe('/files/report.pdf')
      })
    })
  })

  it('a page with no content: 302 to its first descendant with content, past an empty one', () => {
    expect(resolveRoute(content(), '/docs')).toMatchObject({ kind: 'redirect', status: 302, reason: 'container', location: '/docs/intro' })
  })

  it('in a locale, the destination is that locale\'s URL — prefix and translated slug', () => {
    expect(resolveRoute(content(FR), '/fr/documents')).toMatchObject({ reason: 'container', location: '/fr/documents/introduction' })
  })

  it('on a host whose own locale is not the site default, the unprefixed destination has its slugs', () => {
    // ⛔ Until 2026-09-30 a French host sent a French reader to the canonical `/docs/intro`.
    const frHost = content({ ...FR, domainLocale: 'fr' })
    expect(resolveRoute(frHost, '/docs')).toMatchObject({ reason: 'container', location: '/documents/introduction' })
    expect(localeUrl(routeIndex(frHost), 'fr', '/docs/intro')).toBe('/documents/introduction')
  })

  it('no redirect from a folder with an index child, nor from one with nothing below it', () => {
    const lone = content({}, [page('/'), empty('/drafts'), empty('/drafts/empty')])
    expect(resolveRoute(lone, '/drafts')).toMatchObject({ kind: 'page', route: '/drafts' })
  })

  it('an authored redirect, and a rewrite, come before a container\'s', () => {
    expect(resolveRoute(content(), '/moved').reason).toBe('authored')
    expect(resolveRoute(content(), '/shop')).toMatchObject({ kind: 'rewrite', target: 'https://shop.example.com', route: '/shop' })
  })
})

describe('authoredRedirectTarget — a relative redirect resolved as a URL, the page a folder', () => {
  // ⛔ Until 2026-09-30 a relative target was joined to the page's route with no `.` or `..`
  // resolved, so `../pricing` stayed in the path.
  it.each([
    ['/solutions', 'academic', '/solutions/academic'],
    ['/solutions', './academic', '/solutions/academic'],
    ['/team/lead', '../../about', '/about'],
    ['/docs/start', './../intro/', '/docs/intro/'],
    ['/a', '../../../x', '/x'],
    ['/a/b', '/c/../d', '/d'],
    ['/', 'x', '/x'],
  ])('%s + %s → %s', (route, target, expected) => {
    expect(authoredRedirectTarget(route, target)).toBe(expected)
  })

  it('keeps what a URL keeps: a trailing slash, an empty segment, a query and a fragment', () => {
    expect(authoredRedirectTarget('/solutions', 'academic/')).toBe('/solutions/academic/')
    expect(authoredRedirectTarget('/odd', 'a//b')).toBe('/odd/a//b')
    expect(authoredRedirectTarget('/p', 'x/../y?q=a/../b#h')).toBe('/p/y?q=a/../b#h')
  })

  it('leaves a URL with a scheme, or a protocol-relative one, as written', () => {
    expect(authoredRedirectTarget('/p', 'https://e.org/a/../b')).toBe('https://e.org/a/../b')
    expect(authoredRedirectTarget('/p', '//cdn.example/y')).toBe('//cdn.example/y')
  })
})

describe('the parts', () => {
  it('landingRoute: null when nothing below has content', () => {
    const index = routeIndex(content({}, [page('/'), empty('/a'), empty('/a/b')]))
    expect(landingRoute(index, index.byRoute.get('/a'))).toBeNull()
  })

  it('localeOfPath: the prefix names a served locale; none is the unprefixed one', () => {
    const config = { defaultLanguage: 'en', languages: ['en', 'fr'] }
    expect(localeOfPath('/fr/a-propos', config)).toEqual({ locale: 'fr', prefixed: true, path: '/a-propos' })
    expect(localeOfPath('/fr', config)).toEqual({ locale: 'fr', prefixed: true, path: '/' })
    expect(localeOfPath('/en/about', config)).toEqual({ locale: 'en', prefixed: true, path: '/about' })
    expect(localeOfPath('/about', config)).toEqual({ locale: 'en', prefixed: false, path: '/about' })
    expect(localeOfPath('/de/x', config)).toEqual({ locale: 'en', prefixed: false, path: '/de/x' })
    expect(localeOfPath('/about', { ...config, domainLocale: 'fr' }).locale).toBe('fr')
  })

  it('localeUrl: unprefixed, prefixed and translated, or a locale\'s own domain', () => {
    const index = routeIndex(content(FR))
    expect(localeUrl(index, 'fr', '/blog', { activeLocale: 'en' })).toBe('/fr/blogue')
    expect(localeUrl(index, 'en', '/fr/blogue')).toBe('/blog')
    expect(localeUrl(index, 'fr', '/', { activeLocale: 'en' })).toBe('/fr/')
    const domains = routeIndex(content({ ...FR, activeLocale: 'en', domainLocales: { 'exemple.fr': 'fr' } }))
    expect(localeUrl(domains, 'fr', '/blog')).toBe('https://exemple.fr/blogue')
  })

  it('a route under translated pages takes its nearest translated ancestor\'s URL, both ways', () => {
    // The build writes an entry only for a page that declares a `slug:`; a page below one is
    // translated by the longest entry that is a prefix of its route. ⛔ Until 2026-10-01 the FIRST
    // entry in page order won, so `/docs/intro/step` became `/documents/intro/step`, and its real
    // French URL named no page.
    const nested = content({ activeLocale: 'fr', i18n: { routeTranslations: { fr: { '/docs': '/documents', '/docs/intro': '/documents/introduction' } } } },
      [page('/'), page('/docs'), page('/docs/intro'), page('/docs/intro/step'), page('/404')])
    const index = routeIndex(nested)
    expect(localeUrl(index, 'fr', '/docs/intro/step', { activeLocale: 'en' })).toBe('/fr/documents/introduction/step')
    expect(resolveRoute(nested, '/fr/documents/introduction/step')).toMatchObject({ kind: 'page', route: '/docs/intro/step' })
    expect(localeUrl(index, 'en', '/fr/documents/introduction/step')).toBe('/docs/intro/step')
  })

  it('takes the content or its index, alike', () => {
    const c = content(FR)
    expect(resolveRoute(routeIndex(c), '/fr/a-propos')).toEqual(resolveRoute(c, '/fr/a-propos'))
  })
})

describe('on a Website', () => {
  const site = (config = {}) => new Website({ content: content(config) })

  it('resolveRoute gives this Website\'s Pages, and its not-found page', () => {
    const w = site()
    const about = w.resolveRoute('/about')
    expect(about.page).toBe(w.pages.find((p) => p.route === '/about'))
    expect(w.resolveRoute('/nothing').page).toBe(w.getNotFoundPage())
    expect(w.resolveRoute('/docs')).toMatchObject({ kind: 'redirect', location: '/docs/intro', page: w.pages.find((p) => p.route === '/docs') })
  })

  it('getPage still returns a page that redirects, and nothing for a locale redirect', () => {
    const w = site()
    expect(w.getPage('/docs').route).toBe('/docs')
    expect(w.getPage('/en/about')).toBeUndefined()
    expect(w.getPage('/blog/hello').route).toBe('/blog/hello')
  })

  it('a locale set after construction is the one resolved in', () => {
    const w = site({ i18n: FR.i18n })
    w.setActiveLocale('fr')
    expect(w.getPage('/fr/a-propos').route).toBe('/about')
  })
})
