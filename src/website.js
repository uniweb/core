/**
 * Website
 *
 * Manages pages, themes, and localization for a website instance.
 */

import Page from './page.js'
import DataStore from './datastore.js'

export default class Website {
  constructor(websiteData) {
    const { pages = [], theme = {}, config = {}, header, footer, left, right, notFound, versionedScopes = {} } = websiteData

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

    // Store 404 page (for SPA routing)
    // Convention: pages/404/ directory
    this.notFoundPage = notFound || pages.find((p) => p.route === '/404') || null

    // Filter out special pages from regular pages array
    const specialRoutes = ['/@header', '/@footer', '/@left', '/@right', '/404']
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
      label: l.label || l.code,
      value: l.code
    }))

    // Route translations: locale → { forward, reverse } maps
    this._routeTranslations = this._buildRouteTranslations(config)

    // Deployment base path (set by runtime via setBasePath())
    this.basePath = ''

    // Runtime data cache (fetcher registered by runtime at startup)
    this.dataStore = new DataStore()

    // Versioned scopes: route → { versions, latestId }
    // Scopes are routes where versioning starts (e.g., '/docs')
    this.versionedScopes = versionedScopes
  }

  /**
   * Build locales list from config
   * Supports both string codes and objects: ['es', 'fr'] or [{code: 'es', label: 'Español'}]
   * Labels are passed through if provided; otherwise only code is returned.
   * Use kit's getLocaleLabel() for display names.
   * @private
   */
  buildLocalesList(config) {
    const defaultLocale = config.defaultLanguage || 'en'
    const i18nLocales = config.i18n?.locales || []

    // Normalize input: convert strings to objects, keep objects as-is
    const normalizeLocale = (locale) => {
      if (typeof locale === 'string') {
        return { code: locale }
      }
      // Object with code and optional label
      return { code: locale.code, ...(locale.label && { label: locale.label }) }
    }

    // Start with default locale (may not be in i18nLocales)
    const localeMap = new Map()
    localeMap.set(defaultLocale, { code: defaultLocale })

    // Add i18n locales (may include objects with labels)
    for (const locale of i18nLocales) {
      const normalized = normalizeLocale(locale)
      // Merge with existing (to preserve labels if default locale also in i18n with label)
      if (localeMap.has(normalized.code)) {
        const existing = localeMap.get(normalized.code)
        localeMap.set(normalized.code, { ...existing, ...normalized })
      } else {
        localeMap.set(normalized.code, normalized)
      }
    }

    // Build final array with isDefault flag
    return Array.from(localeMap.values()).map(locale => ({
      ...locale,
      isDefault: locale.code === defaultLocale
    }))
  }

  /**
   * Build forward and reverse route translation maps per locale
   * @private
   */
  _buildRouteTranslations(config) {
    const translations = config.i18n?.routeTranslations || {}
    const result = {}
    for (const [locale, routes] of Object.entries(translations)) {
      const forward = new Map()  // canonical → translated
      const reverse = new Map()  // translated → canonical
      for (const [canonical, translated] of Object.entries(routes)) {
        forward.set(canonical, translated)
        reverse.set(translated, canonical)
      }
      result[locale] = { forward, reverse }
    }
    return result
  }

  /**
   * Translate a canonical route to a locale-specific display route
   * Supports exact match and prefix match (e.g., /blog → /noticias also applies to /blog/my-post)
   *
   * @param {string} canonicalRoute - Internal route (e.g., '/about')
   * @param {string} [locale] - Target locale (defaults to active locale)
   * @returns {string} Translated route or original if no translation exists
   */
  translateRoute(canonicalRoute, locale = this.activeLocale) {
    if (!locale || locale === this.defaultLocale) return canonicalRoute
    const entry = this._routeTranslations[locale]
    if (!entry) return canonicalRoute
    // Exact match
    const translated = entry.forward.get(canonicalRoute)
    if (translated) return translated
    // Prefix match (e.g., /blog matches /blog/my-post → /noticias/my-post)
    for (const [canonical, trans] of entry.forward) {
      if (canonicalRoute.startsWith(canonical + '/')) {
        return trans + canonicalRoute.slice(canonical.length)
      }
    }
    return canonicalRoute
  }

  /**
   * Reverse-translate a display route back to the canonical route
   * Used when resolving incoming URLs to find the matching page
   *
   * @param {string} displayRoute - Display route (e.g., '/acerca-de')
   * @param {string} [locale] - Source locale (defaults to active locale)
   * @returns {string} Canonical route or original if no translation exists
   */
  reverseTranslateRoute(displayRoute, locale = this.activeLocale) {
    if (!locale || locale === this.defaultLocale) return displayRoute
    const entry = this._routeTranslations[locale]
    if (!entry) return displayRoute
    // Exact match
    const canonical = entry.reverse.get(displayRoute)
    if (canonical) return canonical
    // Prefix match
    for (const [trans, canon] of entry.reverse) {
      if (displayRoute.startsWith(trans + '/')) {
        return canon + displayRoute.slice(trans.length)
      }
    }
    return displayRoute
  }

  /**
   * Build parent-child relationships between pages based on route structure
   * E.g., /getting-started/installation is a child of /getting-started
   * Also builds page ID map for makeHref() resolution
   * @private
   */
  buildPageHierarchy() {
    // Build a map of route to page for parent lookup
    const pageMap = new Map()
    for (const page of this.pages) {
      pageMap.set(page.route, page)
    }

    // Link pages using the declared parent route (set by build)
    for (const page of this.pages) {
      if (page.parentRoute) {
        const parent = pageMap.get(page.parentRoute)
        if (parent) {
          parent.children.push(page)
          page.parent = parent
        }
      }
    }

    // Build page ID map for makeHref() resolution
    // Supports both explicit IDs and route-based lookup
    this._pageIdMap = new Map()
    for (const page of this.pages) {
      // Explicit stableId takes priority (survives page reorganization)
      if (page.stableId) {
        this._pageIdMap.set(page.stableId, page)
      }
      // Route-based lookup (normalized, without leading/trailing slashes)
      const routeId = this.normalizeRoute(page.route)
      if (routeId && !this._pageIdMap.has(routeId)) {
        this._pageIdMap.set(routeId, page)
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
    // Strip locale prefix if present (e.g., '/fr/about' → '/about')
    // Pages are stored with non-prefixed routes; the locale is a URL concern,
    // not a page identity concern.
    let stripped = route
    if (this.activeLocale && this.activeLocale !== this.defaultLocale) {
      const prefix = `/${this.activeLocale}`
      if (stripped === prefix || stripped === `${prefix}/`) {
        stripped = '/'
      } else if (stripped.startsWith(`${prefix}/`)) {
        stripped = stripped.slice(prefix.length)
      }
    }

    // Reverse-translate display route to canonical (e.g., '/acerca-de' → '/about')
    stripped = this.reverseTranslateRoute(stripped)

    // Normalize trailing slashes for consistent matching
    // '/about/' and '/about' should match the same page
    const normalizedRoute = stripped === '/' ? '/' : stripped.replace(/\/$/, '')

    // Priority 1: Exact match on actual route
    const exactMatch = this.pages.find((page) => page.route === normalizedRoute)
    if (exactMatch) return exactMatch

    // Priority 2: Index page nav route match
    const indexMatch = this.pages.find((page) => page.isIndex && page.getNavRoute() === normalizedRoute)
    if (indexMatch) return indexMatch

    // Priority 3: Dynamic route pattern matching
    // Check cache first
    if (this._dynamicPageCache.has(normalizedRoute)) {
      return this._dynamicPageCache.get(normalizedRoute)
    }

    // Try to match against dynamic route patterns
    for (const page of this.pages) {
      // Check if this is a dynamic page (has :param in route)
      if (!page.route.includes(':')) continue

      const match = this._matchDynamicRoute(page.route, normalizedRoute)
      if (match) {
        // Create a dynamic page instance with the concrete route and params
        const dynamicPage = this._createDynamicPage(page, normalizedRoute, match.params)
        if (dynamicPage) {
          // Cache for future requests
          this._dynamicPageCache.set(normalizedRoute, dynamicPage)
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
   * Set the deployment base path
   * Called by runtime during initialization from Vite's BASE_URL
   *
   * @param {string} path - The base path (e.g., '/templates/international')
   */
  setBasePath(path) {
    if (!path || path === '/') {
      this.basePath = ''
    } else {
      this.basePath = path.endsWith('/') ? path.slice(0, -1) : path
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
   * Resolves page: references to actual routes
   *
   * @param {string} href - The href to transform
   * @returns {string} Resolved href
   *
   * @example
   * makeHref('page:getting-started')           // → '/docs/getting-started'
   * makeHref('page:getting-started#install')   // → '/docs/getting-started#section-install'
   * makeHref('page:docs/api')                  // → '/docs/api' (route-based)
   * makeHref('/about')                         // → '/about' (passthrough)
   */
  makeHref(href) {
    if (!href || !href.startsWith('page:')) {
      return href
    }

    // Parse page reference: page:pageId#sectionId
    const withoutPrefix = href.slice(5) // Remove 'page:'
    const [pageId, sectionId] = withoutPrefix.split('#')

    // Look up page by ID (explicit or route-based)
    const page = this._pageIdMap?.get(pageId)

    if (!page) {
      // Page not found - return original href (or could warn in dev)
      if (typeof console !== 'undefined' && process?.env?.NODE_ENV !== 'production') {
        console.warn(`[makeHref] Page not found: ${pageId}`)
      }
      return href
    }

    // Build the resolved href
    let resolvedHref = page.route

    // Add section hash if specified (with section- prefix for DOM ID)
    if (sectionId) {
      resolvedHref += `#section-${sectionId}`
    }

    return resolvedHref
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
   * Label is optional - use kit's getLocaleLabel() for display names if not provided.
   * @returns {Array<{code: string, label?: string, isDefault: boolean}>}
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
    let targetRoute = route || this.activePage?.route || '/'

    // Strip current locale prefix if present in route
    if (this.activeLocale && this.activeLocale !== this.defaultLocale) {
      const prefix = `/${this.activeLocale}`
      if (targetRoute === prefix || targetRoute === `${prefix}/`) {
        targetRoute = '/'
      } else if (targetRoute.startsWith(`${prefix}/`)) {
        targetRoute = targetRoute.slice(prefix.length)
      }
    }

    // Reverse-translate from current locale to canonical route
    targetRoute = this.reverseTranslateRoute(targetRoute)

    // Default locale uses root path (no prefix), no translation needed
    if (localeCode === this.defaultLocale) {
      return targetRoute
    }

    // Translate canonical route to target locale's display route
    const translatedRoute = this.translateRoute(targetRoute, localeCode)

    // Other locales use /locale/ prefix
    if (translatedRoute === '/') {
      return `/${localeCode}/`
    }

    return `/${localeCode}${translatedRoute}`
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
   *   filter: (page) => !page.route.startsWith('/admin')
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

      // Always exclude dynamic route template pages (e.g., /blog/:slug)
      // These are templates for generating pages, not actual navigable pages
      if (page.route.includes(':')) return false

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
    const buildPageInfo = (page) => {
      const navRoute = page.getNavRoute()
      return {
        id: page.id,
        route: navRoute, // Use canonical nav route (e.g., '/' for index pages)
        navigableRoute: page.getNavigableRoute(), // First route with content (for links)
        translatedRoute: this.translateRoute(navRoute), // Locale-specific display route
        title: page.title,
        label: page.getLabel(),
        description: page.description,
        hasContent: page.hasContent(),
        version: page.version || null, // Version metadata for filtering by version
        children: nested && page.hasChildren()
          ? page.children.filter(isPageVisible).map(buildPageInfo)
          : []
      }
    }

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

  /**
   * Get the 404 (not found) page if defined
   * @returns {Page|null} The 404 page or null
   */
  getNotFoundPage() {
    return this.notFoundPage
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
    let normalized = (route || '').replace(/^\/+/, '').replace(/\/+$/, '')
    // Strip locale prefix so '/es/about' normalizes to 'about'
    if (this.activeLocale && this.activeLocale !== this.defaultLocale) {
      const prefix = this.activeLocale
      if (normalized === prefix) {
        normalized = ''
      } else if (normalized.startsWith(`${prefix}/`)) {
        normalized = normalized.slice(prefix.length + 1)
      }
    }
    // Reverse-translate display route to canonical (e.g., 'acerca-de' → 'about')
    const withSlash = '/' + normalized
    const reversed = this.reverseTranslateRoute(withSlash)
    normalized = reversed.replace(/^\//, '')
    return normalized
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

  // ─────────────────────────────────────────────────────────────────
  // Version API (for documentation sites)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get all versioned scopes
   * Returns a map of scope routes to their version metadata
   *
   * @returns {Object} Map of scope → { versions, latestId }
   *
   * @example
   * website.getVersionedScopes()
   * // { '/docs': { versions: [...], latestId: 'v2' } }
   */
  getVersionedScopes() {
    return this.versionedScopes
  }

  /**
   * Check if site has any versioned content
   * @returns {boolean}
   */
  hasVersionedContent() {
    return Object.keys(this.versionedScopes).length > 0
  }

  /**
   * Get the versioned scope that contains a given route
   * Returns the scope route if the route is within a versioned section
   *
   * @param {string} route - Route to check (e.g., '/docs/getting-started')
   * @returns {string|null} The scope route (e.g., '/docs') or null
   *
   * @example
   * website.getVersionScope('/docs/getting-started') // '/docs'
   * website.getVersionScope('/about')                // null
   */
  getVersionScope(route) {
    const normalizedRoute = route || ''

    // Check each versioned scope to see if route falls within it
    for (const scope of Object.keys(this.versionedScopes)) {
      // Route matches scope exactly
      if (normalizedRoute === scope) {
        return scope
      }

      // Root scope matches all routes starting with /
      if (scope === '/') {
        if (normalizedRoute.startsWith('/') || normalizedRoute === '') {
          return scope
        }
      } else if (normalizedRoute.startsWith(scope + '/')) {
        // Route is a child of this scope
        return scope
      }
    }

    return null
  }

  /**
   * Check if a route is within a versioned section
   *
   * @param {string} route - Route to check
   * @returns {boolean}
   */
  isVersionedRoute(route) {
    return this.getVersionScope(route) !== null
  }

  /**
   * Get version metadata for a scope
   *
   * @param {string} scope - The scope route (e.g., '/docs')
   * @returns {Object|null} Version metadata { versions, latestId } or null
   *
   * @example
   * website.getVersionMeta('/docs')
   * // { versions: [{ id: 'v2', label: 'v2', latest: true }, ...], latestId: 'v2' }
   */
  getVersionMeta(scope) {
    return this.versionedScopes[scope] || null
  }

  /**
   * Get the current version for a page
   * Returns the version object from the page's version metadata
   *
   * @param {Page} page - The page to check
   * @returns {Object|null} Version object { id, label, latest, deprecated } or null
   */
  getPageVersion(page) {
    return page?.version || null
  }

  /**
   * Get available versions for a route's scope
   *
   * @param {string} route - Route within a versioned scope
   * @returns {Array} Array of version objects, or empty array
   *
   * @example
   * website.getVersionsForRoute('/docs/getting-started')
   * // [{ id: 'v2', label: 'v2', latest: true }, { id: 'v1', label: 'v1' }]
   */
  getVersionsForRoute(route) {
    const scope = this.getVersionScope(route)
    if (!scope) return []

    const meta = this.versionedScopes[scope]
    return meta?.versions || []
  }

  /**
   * Compute URL for switching to a different version
   * Takes the current route and computes what the URL would be for another version
   *
   * @param {string} targetVersion - Target version ID (e.g., 'v1')
   * @param {string} currentRoute - Current route (e.g., '/docs/getting-started')
   * @returns {string|null} Target URL or null if not versioned
   *
   * @example
   * // Current: /docs/getting-started (latest v2)
   * website.getVersionUrl('v1', '/docs/getting-started')
   * // → '/docs/v1/getting-started'
   *
   * // Current: /docs/v1/getting-started (older v1)
   * website.getVersionUrl('v2', '/docs/v1/getting-started')
   * // → '/docs/getting-started' (latest has no prefix)
   */
  getVersionUrl(targetVersion, currentRoute) {
    const scope = this.getVersionScope(currentRoute)
    if (!scope) return null

    const meta = this.versionedScopes[scope]
    if (!meta) return null

    // Find target version info
    const targetVersionInfo = meta.versions.find(v => v.id === targetVersion)
    if (!targetVersionInfo) return null

    // Extract the path within the scope (after scope and any version prefix)
    // For root scope ('/'), keep the full path; otherwise slice off the scope
    const afterScope = scope === '/'
      ? currentRoute
      : currentRoute.slice(scope.length) // e.g., '/getting-started' or '/v1/getting-started'

    // Check if current route has a version prefix
    let pathWithinVersion = afterScope
    for (const version of meta.versions) {
      const versionPrefix = `/${version.id}`
      if (afterScope.startsWith(versionPrefix + '/') || afterScope === versionPrefix) {
        // Remove version prefix
        pathWithinVersion = afterScope.slice(versionPrefix.length)
        break
      }
    }

    // Build target URL
    // Latest version has no prefix, others have /vN prefix
    if (targetVersionInfo.latest) {
      // For root scope, return path directly; otherwise prepend scope
      return scope === '/' ? pathWithinVersion : scope + pathWithinVersion
    } else {
      // For root scope: /v1/path; otherwise: scope/v1/path
      return scope === '/'
        ? '/' + targetVersion + pathWithinVersion
        : scope + '/' + targetVersion + pathWithinVersion
    }
  }

  /**
   * Get the latest version ID for a scope
   *
   * @param {string} scope - The scope route
   * @returns {string|null} Latest version ID or null
   */
  getLatestVersion(scope) {
    const meta = this.versionedScopes[scope]
    return meta?.latestId || null
  }
}
