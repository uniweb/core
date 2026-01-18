/**
 * Website
 *
 * Manages pages, themes, and localization for a website instance.
 */

import Page from './page.js'

// Common locale display names
const LOCALE_NAMES = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  pl: 'Polski',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ar: 'العربية'
}

export default class Website {
  constructor(websiteData) {
    const { pages = [], theme = {}, config = {} } = websiteData

    // Site metadata
    this.name = config.name || ''
    this.description = config.description || ''
    this.url = config.url || ''

    // Extract special pages (header, footer) and regular pages
    this.headerPage = pages.find((p) => p.route === '/@header')
    this.footerPage = pages.find((p) => p.route === '/@footer')

    this.pages = pages
      .filter((page) => page.route !== '/@header' && page.route !== '/@footer')
      .map(
        (page, index) =>
          new Page(page, index, this.headerPage, this.footerPage)
      )

    // Set reference from pages back to website
    for (const page of this.pages) {
      page.website = this
      page.site = this // Alias
    }

    this.activePage =
      this.pages.find((page) => page.route === '/' || page.route === '/index') ||
      this.pages[0]

    this.pageRoutes = this.pages.map((page) => page.route)
    this.themeData = theme
    this.config = config

    // Locale configuration
    this.defaultLocale = config.defaultLanguage || 'en'
    this.activeLocale = config.activeLocale || this.defaultLocale

    // Build locales list from i18n config
    this.locales = this.buildLocalesList(config)

    // Legacy language support (for editor multilingual)
    this.activeLang = this.activeLocale
    this.langs = config.languages || this.locales.map(l => ({
      label: l.label,
      value: l.code
    }))
  }

  /**
   * Build locales list from config
   * @private
   */
  buildLocalesList(config) {
    const defaultLocale = config.defaultLanguage || 'en'
    const i18nLocales = config.i18n?.locales || []

    // Start with default locale
    const allLocaleCodes = [defaultLocale]

    // Add translated locales (avoiding duplicates)
    for (const locale of i18nLocales) {
      if (!allLocaleCodes.includes(locale)) {
        allLocaleCodes.push(locale)
      }
    }

    // Build full locale objects
    return allLocaleCodes.map(code => ({
      code,
      label: LOCALE_NAMES[code] || code.toUpperCase(),
      isDefault: code === defaultLocale
    }))
  }

  /**
   * Get page by route
   * @param {string} route
   * @returns {Page|undefined}
   */
  getPage(route) {
    return this.pages.find((page) => page.route === route)
  }

  /**
   * Set active page by route
   * @param {string} route
   */
  setActivePage(route) {
    const page = this.getPage(route)
    if (page) {
      this.activePage = page
    }
  }

  /**
   * Get remote layout component from foundation config
   */
  getRemoteLayout() {
    return globalThis.uniweb?.foundationConfig?.Layout || null
  }

  /**
   * Get remote props from foundation config
   */
  getRemoteProps() {
    return globalThis.uniweb?.foundationConfig?.props || null
  }

  /**
   * Get routing components (Link, useNavigate, etc.)
   */
  getRoutingComponents() {
    return globalThis.uniweb?.routingComponents || {}
  }

  /**
   * Make href (for link transformation)
   * @param {string} href
   * @returns {string}
   */
  makeHref(href) {
    // Could add basename handling here
    return href
  }

  /**
   * Get available languages
   * @deprecated Use getLocales() instead
   */
  getLanguages() {
    return this.langs
  }

  /**
   * Get current language
   * @deprecated Use getActiveLocale() instead
   */
  getLanguage() {
    return this.activeLang
  }

  // ─────────────────────────────────────────────────────────────────
  // Locale API (new)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all available locales
   * @returns {Array<{code: string, label: string, isDefault: boolean}>}
   */
  getLocales() {
    return this.locales
  }

  /**
   * Get currently active locale code
   * @returns {string}
   */
  getActiveLocale() {
    return this.activeLocale
  }

  /**
   * Get the default locale code
   * @returns {string}
   */
  getDefaultLocale() {
    return this.defaultLocale
  }

  /**
   * Check if site has multiple locales (useful for showing language switcher)
   * @returns {boolean}
   */
  hasMultipleLocales() {
    return this.locales.length > 1
  }

  /**
   * Set the active locale
   * @param {string} localeCode - Locale code to activate
   */
  setActiveLocale(localeCode) {
    const locale = this.locales.find(l => l.code === localeCode)
    if (locale) {
      this.activeLocale = localeCode
      this.activeLang = localeCode // Keep legacy in sync
    }
  }

  /**
   * Build URL for a specific locale
   * @param {string} localeCode - Target locale code
   * @param {string} route - Page route (default: current page route)
   * @returns {string}
   */
  getLocaleUrl(localeCode, route = null) {
    const targetRoute = route || this.activePage?.route || '/'

    // Default locale uses root path (no prefix)
    if (localeCode === this.defaultLocale) {
      return targetRoute
    }

    // Other locales use /locale/ prefix
    if (targetRoute === '/') {
      return `/${localeCode}/`
    }

    return `/${localeCode}${targetRoute}`
  }

  /**
   * Get locale info by code
   * @param {string} localeCode - Locale code
   * @returns {Object|undefined} Locale object or undefined
   */
  getLocale(localeCode) {
    return this.locales.find(l => l.code === localeCode)
  }

  /**
   * Localize a value
   * @param {any} val - Value to localize (object with lang keys, or string)
   * @param {string} defaultVal - Default value if not found
   * @param {string} givenLang - Override language
   * @param {boolean} fallbackDefaultLangVal - Fall back to default language
   * @returns {string}
   */
  localize(val, defaultVal = '', givenLang = '', fallbackDefaultLangVal = false) {
    const lang = givenLang || this.activeLang
    const defaultLang = this.langs[0]?.value || 'en'

    if (typeof val === 'object' && !Array.isArray(val)) {
      return fallbackDefaultLangVal
        ? val?.[lang] || val?.[defaultLang] || defaultVal
        : val?.[lang] || defaultVal
    }

    if (typeof val === 'string') {
      if (!val.startsWith('{') && !val.startsWith('"')) return val

      try {
        const obj = JSON.parse(val)
        if (typeof obj === 'object') {
          return fallbackDefaultLangVal
            ? obj?.[lang] || obj?.[defaultLang] || defaultVal
            : obj?.[lang] || defaultVal
        }
        return obj
      } catch {
        return val
      }
    }

    return defaultVal
  }

  /**
   * Get search data for all pages
   */
  getSearchData() {
    return this.pages.map((page) => ({
      id: page.id,
      title: page.title,
      href: page.route,
      route: page.route,
      description: page.description,
      content: page
        .getPageBlocks()
        .map((b) => b.title)
        .filter(Boolean)
        .join('\n')
    }))
  }
}
