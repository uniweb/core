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
    const { pages = [], theme = {}, config = {}, header, footer, left, right } = websiteData

    // Site metadata
    this.name = config.name || ''
    this.description = config.description || ''
    this.url = config.url || ''

    // Store special pages (layout areas)
    // These come from top-level properties set by content-collector
    // Fallback to searching pages array for backwards compatibility
    this.headerPage = header || pages.find((p) => p.route === '/@header') || null
    this.footerPage = footer || pages.find((p) => p.route === '/@footer') || null
    this.leftPage = left || pages.find((p) => p.route === '/@left') || null
    this.rightPage = right || pages.find((p) => p.route === '/@right') || null

    // Filter out special pages from regular pages array
    const specialRoutes = ['/@header', '/@footer', '/@left', '/@right']
    const regularPages = pages.filter((page) => !specialRoutes.includes(page.route))

    // Store original page data for dynamic pages (needed to create instances on-demand)
    this._dynamicPageData = new Map()
    for (const pageData of regularPages) {
      if (pageData.isDynamic || pageData.route?.includes(':')) {
        this._dynamicPageData.set(pageData.route, pageData)
      }
    }

    // Cache for dynamically created page instances
    this._dynamicPageCache = new Map()

    this.pages = regularPages.map(
      (page, index) =>
        new Page(page, index, this, this.headerPage, this.footerPage, this.leftPage, this.rightPage)
    )

    // Build parent-child relationships based on route structure
    this.buildPageHierarchy()

    // Find the homepage (root-level index page)
    this.activePage =
      this.pages.find((page) => page.isIndex && page.getNavRoute() === '/') ||
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
   * Build parent-child relationships between pages based on route structure
   * E.g., /getting-started/installation is a child of /getting-started
   * @private
   */
  buildPageHierarchy() {
    // Sort pages by route depth (parents before children)
    const sortedPages = [...this.pages].sort((a, b) => {
      const depthA = (a.route.match(/\//g) || []).length
      const depthB = (b.route.match(/\//g) || []).length
      return depthA - depthB
    })

    // Build a map of route to page for quick lookup
    // Include both actual routes and nav routes (for index pages)
    const pageMap = new Map()
    for (const page of sortedPages) {
      pageMap.set(page.route, page)
      // Also map the nav route for index pages so parent lookup works
      if (page.isIndex) {
        const navRoute = page.getNavRoute()
        if (navRoute !== page.route) {
          pageMap.set(navRoute, page)
        }
      }
    }

    // For each page, find its parent and add it as a child
    for (const page of sortedPages) {
      const route = page.route
      // Skip root-level pages (single segment like /home, /about)
      const segments = route.split('/').filter(Boolean)
      if (segments.length <= 1) continue

      // Build parent route by removing the last segment
      // /docs/getting-started -> /docs
      const parentRoute = '/' + segments.slice(0, -1).join('/')
      const parent = pageMap.get(parentRoute)

      if (parent) {
        parent.children.push(page)
        page.parent = parent
      }
    }

    // Sort children by order
    for (const page of this.pages) {
      if (page.children.length > 0) {
        page.children.sort((a, b) => (a.order || 0) - (b.order || 0))
      }
    }
  }

  /**
   * Get page by route
   * Matches in priority order:
   * 1. Exact match on actual route
   * 2. Index page nav route match
   * 3. Dynamic route pattern match (e.g., /blog/:slug matches /blog/my-post)
   *
   * @param {string} route - The route to find
   * @returns {Page|undefined}
   */
  getPage(route) {
    // Priority 1: Exact match on actual route
    const exactMatch = this.pages.find((page) => page.route === route)
    if (exactMatch) return exactMatch

    // Priority 2: Index page nav route match
    const indexMatch = this.pages.find((page) => page.isIndex && page.getNavRoute() === route)
    if (indexMatch) return indexMatch

    // Priority 3: Dynamic route pattern matching
    // Check cache first
    if (this._dynamicPageCache.has(route)) {
      return this._dynamicPageCache.get(route)
    }

    // Try to match against dynamic route patterns
    for (const page of this.pages) {
      // Check if this is a dynamic page (has :param in route)
      if (!page.route.includes(':')) continue

      const match = this._matchDynamicRoute(page.route, route)
      if (match) {
        // Create a dynamic page instance with the concrete route and params
        const dynamicPage = this._createDynamicPage(page, route, match.params)
        if (dynamicPage) {
          // Cache for future requests
          this._dynamicPageCache.set(route, dynamicPage)
          return dynamicPage
        }
      }
    }

    return undefined
  }

  /**
   * Match a dynamic route pattern against a concrete path
   * E.g., /blog/:slug matches /blog/my-post => { params: { slug: 'my-post' } }
   *
   * @private
   * @param {string} pattern - Route pattern with :param placeholders
   * @param {string} path - Actual path to match
   * @returns {Object|null} Match result with params, or null if no match
   */
  _matchDynamicRoute(pattern, path) {
    // Extract param names and build regex
    const paramNames = []
    const regexStr = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars except :
      .replace(/:(\w+)/g, (_, paramName) => {
        paramNames.push(paramName)
        return '([^/]+)' // Capture anything except /
      })

    const regex = new RegExp(`^${regexStr}$`)
    const match = path.match(regex)

    if (!match) return null

    // Build params object
    const params = {}
    paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1])
    })

    return { params }
  }

  /**
   * Create a dynamic page instance with concrete route and params
   *
   * @private
   * @param {Page} templatePage - The template page with :param route
   * @param {string} concreteRoute - The actual route (e.g., /blog/my-post)
   * @param {Object} params - Matched params (e.g., { slug: 'my-post' })
   * @returns {Page|null} New page instance or null
   */
  _createDynamicPage(templatePage, concreteRoute, params) {
    // Get the original page data
    const originalData = this._dynamicPageData.get(templatePage.route)
    if (!originalData) return null

    // Deep clone the page data
    const pageData = JSON.parse(JSON.stringify(originalData))

    // Update with concrete route and dynamic context
    pageData.route = concreteRoute
    pageData.isDynamic = false // No longer a template

    const paramName = Object.keys(params)[0]
    const paramValue = Object.values(params)[0]
    const pluralSchema = originalData.parentSchema // e.g., 'articles'
    const singularSchema = this._singularize(pluralSchema) // e.g., 'article'

    // Store dynamic context for components to access
    pageData.dynamicContext = {
      templateRoute: templatePage.route,
      params,
      paramName,
      paramValue,
      schema: pluralSchema,
      singularSchema,
    }

    // Get the parent page's data to find the items array
    // Parent route is the template route without the :param suffix
    const parentRoute = templatePage.route.replace(/\/:[\w]+$/, '') || '/'
    const parentPage = this.pages.find(p => p.route === parentRoute || p.getNavRoute() === parentRoute)

    // Get items from parent's cascaded data
    let items = []
    let currentItem = null

    if (parentPage && pluralSchema) {
      // Get items from parent page's first section's cascadedData
      // This is where the page-level fetch stores its data
      const firstSection = parentPage.pageBlocks?.body?.[0]
      if (firstSection) {
        items = firstSection.cascadedData?.[pluralSchema] || []
      }

      // Find the current item using the param
      if (items.length > 0) {
        currentItem = items.find(item => String(item[paramName]) === String(paramValue))
      }
    }

    // Store items in dynamic context for Block.getCurrentItem() / getAllItems()
    pageData.dynamicContext.currentItem = currentItem
    pageData.dynamicContext.allItems = items

    // Inject cascaded data into sections for components with inheritData
    // This provides both singular (article) and plural (articles) data
    const cascadedData = {}
    if (currentItem && singularSchema) {
      cascadedData[singularSchema] = currentItem
    }
    if (items.length > 0 && pluralSchema) {
      cascadedData[pluralSchema] = items
    }

    this._injectDynamicData(pageData.sections, cascadedData, pageData.dynamicContext)

    // Update page metadata from current item if available
    if (currentItem) {
      if (currentItem.title) pageData.title = currentItem.title
      if (currentItem.description || currentItem.excerpt) {
        pageData.description = currentItem.description || currentItem.excerpt
      }
    }

    // Create the page instance
    const dynamicPage = new Page(
      pageData,
      `dynamic-${concreteRoute}`,
      this,
      this.headerPage,
      this.footerPage,
      this.leftPage,
      this.rightPage
    )

    // Copy parent reference from template
    dynamicPage.parent = templatePage.parent

    return dynamicPage
  }

  /**
   * Singularize a plural schema name
   * @private
   */
  _singularize(name) {
    if (!name) return name
    // Common irregular plurals
    const irregulars = {
      people: 'person',
      children: 'child',
      men: 'men',
      women: 'woman',
      series: 'series',
    }
    if (irregulars[name]) return irregulars[name]
    // -ies → -y (categories → category)
    if (name.endsWith('ies')) return name.slice(0, -3) + 'y'
    // -es endings that should only remove 's' (not 'es')
    // e.g., articles → article, courses → course
    if (name.endsWith('es')) {
      // Check if the base word ends in a consonant that requires 'es' plural
      // (boxes, dishes, classes, heroes) vs just 's' plural (articles, courses)
      const base = name.slice(0, -2)
      const lastChar = base.slice(-1)
      // If base ends in s, x, z, ch, sh - these need 'es' for plural, so remove 'es'
      if (['s', 'x', 'z'].includes(lastChar) || base.endsWith('ch') || base.endsWith('sh')) {
        return base
      }
      // Otherwise just remove 's' (articles → article)
      return name.slice(0, -1)
    }
    // Regular -s plurals
    if (name.endsWith('s')) return name.slice(0, -1)
    return name
  }

  /**
   * Inject dynamic route data into sections for components with inheritData
   * This provides both the current item (singular) and all items (plural)
   *
   * @private
   * @param {Array} sections - Sections to update
   * @param {Object} cascadedData - Data to inject { article: {...}, articles: [...] }
   * @param {Object} dynamicContext - Dynamic route context
   */
  _injectDynamicData(sections, cascadedData, dynamicContext) {
    if (!sections || !Array.isArray(sections)) return

    for (const section of sections) {
      // Merge cascaded data into section's existing cascadedData
      section.cascadedData = {
        ...(section.cascadedData || {}),
        ...cascadedData,
      }

      // Also set dynamic context for Block.getDynamicContext()
      section.dynamicContext = dynamicContext

      // Recurse into subsections
      if (section.subsections && section.subsections.length > 0) {
        this._injectDynamicData(section.subsections, cascadedData, dynamicContext)
      }
    }
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

  // ─────────────────────────────────────────────────────────────────
  // Search API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if search is enabled for this site
   * @returns {boolean}
   */
  isSearchEnabled() {
    // Search is enabled by default unless explicitly disabled
    return this.config?.search?.enabled !== false
  }

  /**
   * Get search configuration
   * @returns {Object} Search configuration
   */
  getSearchConfig() {
    const config = this.config?.search || {}

    return {
      enabled: this.isSearchEnabled(),
      indexUrl: this.getSearchIndexUrl(),
      locale: this.getActiveLocale(),
      include: {
        pages: config.include?.pages !== false,
        sections: config.include?.sections !== false,
        headings: config.include?.headings !== false,
        paragraphs: config.include?.paragraphs !== false,
        links: config.include?.links !== false,
        lists: config.include?.lists !== false
      },
      exclude: {
        routes: config.exclude?.routes || [],
        components: config.exclude?.components || []
      }
    }
  }

  /**
   * Get the URL for the search index file
   * @returns {string} URL to fetch the search index
   */
  getSearchIndexUrl() {
    const locale = this.getActiveLocale()
    const isDefault = locale === this.getDefaultLocale()

    // Default locale uses root path, others use locale prefix
    return isDefault ? '/search-index.json' : `/${locale}/search-index.json`
  }

  /**
   * Get search data for all pages
   * @deprecated Use getSearchConfig() and fetch the search index instead
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

  // ─────────────────────────────────────────────────────────────────
  // Page Hierarchy API (for navigation components)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get page hierarchy for building navigation (navbar, footer, sitemap)
   *
   * This is the primary API for navigation components. It returns pages
   * filtered and formatted for navigation use.
   *
   * @param {Object} options - Configuration options
   * @param {boolean} [options.nested=true] - Return nested hierarchy (with children) or flat list
   * @param {string} [options.for] - Filter for specific navigation: 'header', 'footer', or undefined (all)
   * @param {boolean} [options.includeHidden=false] - Include hidden pages
   * @param {function} [options.filter] - Custom filter function (page) => boolean
   * @param {function} [options.sort] - Custom sort function (a, b) => number
   * @returns {Array<Object>} Array of page info objects for navigation
   *
   * @example
   * // Get pages for header navigation
   * const headerPages = website.getPageHierarchy({ for: 'header' })
   *
   * // Get flat list of all pages
   * const allPages = website.getPageHierarchy({ nested: false, includeHidden: true })
   *
   * // Custom filtering
   * const topLevel = website.getPageHierarchy({
   *   filter: (page) => page.order < 10
   * })
   */
  getPageHierarchy(options = {}) {
    const {
      nested = true,
      for: navType,
      includeHidden = false,
      filter: customFilter,
      sort: customSort
    } = options

    // Filter pages based on navigation type and visibility
    const isPageVisible = (page) => {
      // Always exclude special pages (header/footer are already separated)
      if (page.route.startsWith('/@')) return false

      // Check visibility based on navigation type
      if (!includeHidden) {
        if (page.hidden) return false
        if (navType === 'header' && page.hideInHeader) return false
        if (navType === 'footer' && page.hideInFooter) return false
      }

      // Apply custom filter if provided
      if (customFilter && !customFilter(page)) return false

      return true
    }

    let filteredPages = this.pages.filter(isPageVisible)

    // When nested, only include root-level pages at top level
    // (children will be nested inside their parents)
    if (nested) {
      filteredPages = filteredPages.filter(page => !page.parent)
    }

    // Apply custom sort or default to order
    if (customSort) {
      filteredPages.sort(customSort)
    }
    // Already sorted by order in constructor, so no need to re-sort

    // Build page info objects
    const buildPageInfo = (page) => ({
      id: page.id,
      route: page.getNavRoute(), // Use canonical nav route (e.g., '/' for index pages)
      navigableRoute: page.getNavigableRoute(), // First route with content (for links)
      title: page.title,
      label: page.getLabel(),
      description: page.description,
      order: page.order,
      hasContent: page.hasContent(),
      children: nested && page.hasChildren()
        ? page.children.filter(isPageVisible).map(buildPageInfo)
        : []
    })

    return filteredPages.map(buildPageInfo)
  }

  /**
   * Get pages for header navigation
   * Convenience method equivalent to getPageHierarchy({ for: 'header' })
   * @returns {Array<Object>}
   */
  getHeaderPages() {
    return this.getPageHierarchy({ for: 'header' })
  }

  /**
   * Get pages for footer navigation
   * Convenience method equivalent to getPageHierarchy({ for: 'footer' })
   * @returns {Array<Object>}
   */
  getFooterPages() {
    return this.getPageHierarchy({ for: 'footer' })
  }

  /**
   * Get flat list of all pages (for sitemaps, search, etc.)
   * @param {boolean} includeHidden - Include hidden pages
   * @returns {Array<Object>}
   */
  getAllPages(includeHidden = false) {
    return this.getPageHierarchy({ nested: false, includeHidden })
  }

  // ─────────────────────────────────────────────────────────────────
  // Active Route API (for navigation components)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the current active route, normalized (no leading/trailing slashes).
   * Works in both SSR (from activePage) and client (from activePage).
   *
   * @returns {string} Normalized route (e.g., 'docs/getting-started')
   *
   * @example
   * website.getActiveRoute() // 'docs/getting-started'
   */
  getActiveRoute() {
    return this.activePage?.getNormalizedRoute() || ''
  }

  /**
   * Get the first segment of the active route.
   * Useful for root-level navigation highlighting.
   *
   * @returns {string} First segment (e.g., 'docs' for 'docs/getting-started')
   *
   * @example
   * // Active route: 'docs/getting-started/installation'
   * website.getActiveRootSegment() // 'docs'
   */
  getActiveRootSegment() {
    return this.getActiveRoute().split('/')[0]
  }

  /**
   * Normalize a route by removing leading/trailing slashes.
   * This is the single source of truth for route normalization.
   *
   * @param {string} route - Route to normalize
   * @returns {string} Normalized route (e.g., 'docs/getting-started')
   *
   * @example
   * website.normalizeRoute('/docs/guide/') // 'docs/guide'
   * website.normalizeRoute('about')        // 'about'
   * website.normalizeRoute('/')            // ''
   */
  normalizeRoute(route) {
    return (route || '').replace(/^\/+/, '').replace(/\/+$/, '')
  }

  /**
   * Check if a target route matches the current route exactly.
   *
   * @param {string} targetRoute - Route to check (will be normalized)
   * @param {string} currentRoute - Current route (will be normalized)
   * @returns {boolean} True if routes match exactly
   *
   * @example
   * website.isRouteActive('/about', '/about') // true
   * website.isRouteActive('/about', '/about/team') // false
   */
  isRouteActive(targetRoute, currentRoute) {
    return this.normalizeRoute(targetRoute) === this.normalizeRoute(currentRoute)
  }

  /**
   * Check if a target route matches the current route or is an ancestor of it.
   * Used for navigation highlighting where parent items should be highlighted
   * when a child page is active.
   *
   * @param {string} targetRoute - Route to check (will be normalized)
   * @param {string} currentRoute - Current route (will be normalized)
   * @returns {boolean} True if target matches current or is an ancestor
   *
   * @example
   * website.isRouteActiveOrAncestor('/docs', '/docs')           // true (exact)
   * website.isRouteActiveOrAncestor('/docs', '/docs/guide')     // true (ancestor)
   * website.isRouteActiveOrAncestor('/about', '/docs/guide')    // false
   * website.isRouteActiveOrAncestor('/', '/docs')               // false (root is not ancestor of all)
   */
  isRouteActiveOrAncestor(targetRoute, currentRoute) {
    const target = this.normalizeRoute(targetRoute)
    const current = this.normalizeRoute(currentRoute)

    // Exact match
    if (target === current) return true

    // Empty target (root) is not considered ancestor of everything
    if (target === '') return false

    // Check if current starts with target followed by /
    return current.startsWith(target + '/')
  }
}
