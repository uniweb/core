/**
 * Website
 *
 * Manages pages, themes, and localization for a website instance.
 */

import Page from './page.js'

export default class Website {
  constructor(websiteData) {
    const { pages = [], theme = {}, config = {} } = websiteData

    // Extract special pages (header, footer) and regular pages
    this.headerPage = pages.find((p) => p.route === '/@header')
    this.footerPage = pages.find((p) => p.route === '/@footer')

    this.pages = pages
      .filter((page) => page.route !== '/@header' && page.route !== '/@footer')
      .map(
        (page, index) =>
          new Page(page, index, this.headerPage, this.footerPage)
      )

    this.activePage =
      this.pages.find((page) => page.route === '/' || page.route === '/index') ||
      this.pages[0]

    this.pageRoutes = this.pages.map((page) => page.route)
    this.themeData = theme
    this.config = config
    this.activeLang = config.defaultLanguage || 'en'
    this.langs = config.languages || [
      { label: 'English', value: 'en' },
      { label: 'français', value: 'fr' }
    ]
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
   */
  getLanguages() {
    return this.langs
  }

  /**
   * Get current language
   */
  getLanguage() {
    return this.activeLang
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
