/**
 * Reading back the URLs we ourselves emit.
 *
 * `translateRoute` produces the URL a localized site links to. A browser then
 * percent-encodes it, and may present it with a trailing slash depending on how
 * the host serves directories. Both are outside the site's control, and both
 * used to defeat `reverseTranslateRoute` — so the framework generated addresses
 * it could not resolve, and the page 404'd.
 *
 * Two independent causes, and the second is the one that hides:
 *
 *   ENCODING   `/Sites-Web/Thème-du-site-Web` arrives as
 *              `/Sites-Web/Th%C3%A8me-du-site-Web`; the translation map is
 *              authored as plain text, so the lookup missed entirely.
 *
 *   TRAILING   `/blogue/mi-post/` missed the exact lookup (the map is keyed
 *   SLASH      without one) and fell through to the PREFIX branch, which
 *              rewrites only the first segment. The result — `/blog/mi-post/`
 *              — is a well-formed route pointing at no page. It appeared to
 *              work for every child slug that happened to be spelled the same
 *              in both locales, which is why partial success was the symptom.
 *
 * Measured on a 33-page bilingual site: 15 of 33 French pages 404'd on a
 * slash-free host and 26 of 33 on a trailing-slash one, while the prerendered
 * HTML for every one of them was correct — the SPA replaced it after hydration.
 */
import Website from '../src/website.js'

// Deliberately mixed: accents, an apostrophe, and a child slug identical across
// locales (`Collaboration`) — the last is what accidentally passed before.
const RT = {
  fr: {
    '/About-Us': "/A-propos-d'Uniweb",
    '/Websites': '/Sites-Web',
    '/Websites/Theming': '/Sites-Web/Thème-du-site-Web',
    '/Websites/Collaboration': '/Sites-Web/Collaboration',
    '/blog': '/blogue',
  },
}

function site(configOverrides = {}) {
  return new Website({
    content: {
      config: {
        name: 'T',
        defaultLanguage: 'en',
        i18n: { routeTranslations: RT },
        ...configOverrides,
      },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/About-Us', title: 'About', sections: [] },
        { route: '/Websites', title: 'Websites', sections: [] },
        { route: '/Websites/Theming', title: 'Theming', sections: [] },
        { route: '/Websites/Collaboration', title: 'Collaboration', sections: [] },
        { route: '/blog', title: 'Blog', sections: [] },
      ],
    },
  })
}

describe('reverseTranslateRoute — percent-encoded input', () => {
  it('reverses an accented slug the browser encoded', () => {
    expect(
      site().reverseTranslateRoute('/Sites-Web/Th%C3%A8me-du-site-Web', 'fr')
    ).toBe('/Websites/Theming')
  })

  it('reverses an apostrophe slug the browser encoded', () => {
    expect(site().reverseTranslateRoute("/A-propos-d%27Uniweb", 'fr')).toBe('/About-Us')
  })

  it('round-trips whatever translateRoute emits', () => {
    const w = site()
    for (const canonical of ['/About-Us', '/Websites', '/Websites/Theming']) {
      const emitted = w.translateRoute(canonical, 'fr')
      const asBrowserSendsIt = encodeURI(emitted)
      expect(w.reverseTranslateRoute(asBrowserSendsIt, 'fr')).toBe(canonical)
    }
  })

  it('leaves a route with a literal % alone instead of throwing', () => {
    // `decodeURIComponent` raises URIError on a lone `%`; the guard must fall
    // back rather than take the whole page down.
    expect(() => site().reverseTranslateRoute('/100%-Guide', 'fr')).not.toThrow()
    expect(site().reverseTranslateRoute('/100%-Guide', 'fr')).toBe('/100%-Guide')
  })
})

describe('getPage — trailing slash', () => {
  it('resolves a translated CHILD route with a trailing slash', () => {
    // The regression: prefix-matching rewrote `/Sites-Web` → `/Websites` and
    // left `Thème-du-site-Web` untranslated, yielding a route with no page.
    const w = site({ activeLocale: 'fr' })
    expect(w.getPage('/fr/Sites-Web/Thème-du-site-Web/')?.route).toBe('/Websites/Theming')
  })

  it('resolves the same route without a trailing slash', () => {
    const w = site({ activeLocale: 'fr' })
    expect(w.getPage('/fr/Sites-Web/Thème-du-site-Web')?.route).toBe('/Websites/Theming')
  })

  it('resolves a percent-encoded route with a trailing slash', () => {
    const w = site({ activeLocale: 'fr' })
    expect(w.getPage('/fr/Sites-Web/Th%C3%A8me-du-site-Web/')?.route).toBe(
      '/Websites/Theming'
    )
  })

  it('still resolves a child whose slug is identical in both locales', () => {
    // This one passed even while broken — pin it so a future fix cannot
    // regress the case that masked the bug.
    const w = site({ activeLocale: 'fr' })
    expect(w.getPage('/fr/Sites-Web/Collaboration/')?.route).toBe(
      '/Websites/Collaboration'
    )
  })

  it('resolves a translated parent with a trailing slash', () => {
    const w = site({ activeLocale: 'fr' })
    expect(w.getPage('/fr/Sites-Web/')?.route).toBe('/Websites')
  })

  it('leaves the default locale untouched', () => {
    const w = site({ activeLocale: 'en' })
    expect(w.getPage('/Websites/Theming/')?.route).toBe('/Websites/Theming')
    expect(w.getPage('/Websites/Theming')?.route).toBe('/Websites/Theming')
  })
})

describe('getLocaleUrl — switching away from an encoded route', () => {
  it('reads the encoded current route when switching locale', () => {
    // The language switcher passes location.pathname, which is encoded — so
    // switching back to English from an accented French page used to fail.
    const w = site({ activeLocale: 'fr' })
    expect(w.getLocaleUrl('en', '/fr/Sites-Web/Th%C3%A8me-du-site-Web')).toBe(
      '/Websites/Theming'
    )
  })
})
