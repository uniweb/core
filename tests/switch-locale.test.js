/**
 * `website.switchLocale(code)`: the page in another locale. A locale is its own document, so
 * the switch is a page load of `getLocaleUrl()`, unless the host switches locale its own way
 * (`uniweb.localeSwitch`, an editor's preview, whose document a page load would leave).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Website from '../src/website.js'

const ROUTE_TRANSLATIONS = { fr: { '/About-Us': '/a-propos' }, es: { '/About-Us': '/acerca-de' } }

function site(config = {}, page = '/About-Us') {
  const website = new Website({
    content: {
      config: {
        name: 'T',
        defaultLanguage: 'en',
        languages: ['en', 'fr', 'es'],
        i18n: { routeTranslations: ROUTE_TRANSLATIONS },
        ...config,
      },
      theme: {},
      pages: [
        { route: '/', isIndex: true, title: 'Home', sections: [] },
        { route: '/About-Us', title: 'About', sections: [] },
      ],
    },
  })
  website.setActivePage(page)
  return website
}

const saved = { uniweb: globalThis.uniweb, window: globalThis.window }
let assign
beforeEach(() => {
  assign = vi.fn()
  globalThis.window = { location: { assign } }
  globalThis.uniweb = { localeSwitch: null }
})
afterEach(() => {
  globalThis.uniweb = saved.uniweb
  globalThis.window = saved.window
})

describe('with no host switch, a page load', () => {
  it('of the current page in that locale', () => {
    expect(site().switchLocale('fr')).toBe(true)
    expect(assign).toHaveBeenCalledWith('/fr/a-propos')
  })

  it('of the page it is given, canonical or as the active locale shows it', () => {
    site().switchLocale('es', '/About-Us')
    site({ activeLocale: 'fr' }, '/').switchLocale('es', '/fr/a-propos')
    expect(assign.mock.calls).toEqual([['/es/acerca-de'], ['/es/acerca-de']])
  })

  it('back to the default locale, unprefixed', () => {
    site({ activeLocale: 'fr' }, '/fr/a-propos').switchLocale('en')
    expect(assign).toHaveBeenCalledWith('/About-Us')
  })

  it('under the base path, as a reload link gets it', () => {
    const website = site()
    website.setBasePath('/docs/')
    website.switchLocale('fr')
    expect(assign).toHaveBeenCalledWith('/docs/fr/a-propos')
  })

  it('for a locale with a domain of its own, that domain, with no base path', () => {
    const website = site({ domainLocales: { 'fr.example.com': 'fr' } })
    website.setBasePath('/docs/')
    website.switchLocale('fr')
    expect(assign).toHaveBeenCalledWith('https://fr.example.com/a-propos')
  })

  it('never for a locale the site does not have', () => {
    expect(site().switchLocale('de')).toBe(false)
    expect(assign).not.toHaveBeenCalled()
  })

  it('and nothing at all where there is no window (a prerender)', () => {
    delete globalThis.window
    expect(site().switchLocale('fr')).toBe(true)
  })
})

describe('with a host switch, the host switches', () => {
  it('told the locale, the canonical route and the URL a page load would go to', () => {
    const localeSwitch = vi.fn()
    globalThis.uniweb = { localeSwitch }
    const website = site({ activeLocale: 'fr' }, '/fr/a-propos')
    website.setBasePath('/docs/')
    expect(website.switchLocale('es')).toBe(true)
    expect(localeSwitch).toHaveBeenCalledWith({ locale: 'es', route: '/About-Us', url: '/docs/es/acerca-de' })
    expect(assign).not.toHaveBeenCalled()
  })

  it('and is not told of a locale the site does not have', () => {
    const localeSwitch = vi.fn()
    globalThis.uniweb = { localeSwitch }
    expect(site().switchLocale('de')).toBe(false)
    expect(localeSwitch).not.toHaveBeenCalled()
  })
})
