/**
 * Website
 *
 * Manages pages, themes, and localization for a website instance.
 */

import Page from './page.js'
import DataStore from './datastore.js'
import EntityStore from './entity-store.js'
import FetcherDispatcher from './fetcher-dispatcher.js'
import ObservableState from './observable-state.js'
import singularize from './singularize.js'

/**
 * Website — orchestration root for a single site instance.
 *
 * Accepts the site content payload plus the primary foundation and any
 * extensions. Owns the DataStore (pure cache), EntityStore (cascade resolver),
 * FetcherDispatcher (route walker + cache+in-flight wiring), and `state`
 * (site-wide observable slots). Pages are constructed from the content payload;
 * each page owns its own ObservableState.
 *
 * Content-only rebuilds keep the dispatcher and state in place. Foundation
 * swaps reassemble the dispatcher but preserve the DataStore and state so the
 * editor's live-edit path doesn't wipe either between keystrokes.
 *
 *   new Website({ content, foundation?, extensions?, defaultFetcher?, dev? })
 */
export default class Website {
  constructor({
    content = {},
    foundation = null,
    extensions = [],
    defaultFetcher = null,
    transport = null,
    dev = false,
  } = {}) {

    // ─── Foundation / dispatcher state (not re-derived on rebuild) ───
    this._foundation = foundation
    this._extensions = extensions
    this._defaultFetcher = defaultFetcher
    // Runtime-level transport override (editor preview bridge). Stored so
    // rebuild() reassembles the dispatcher with the same override in place.
    this._transport = transport
    this._dev = dev

    this.dataStore = new DataStore()
    this.fetcher = new FetcherDispatcher({
      foundation,
      extensions,
      dataStore: this.dataStore,
      defaultFetcher,
      transport,
      dev,
    })
    this.entityStore = new EntityStore({ website: this })

    // Observable site-wide state — allocated on first access via the `state`
    // getter, survives content rebuilds. Read-only prop (no `website.state = X`
    // reassignment) so callers can only mutate slots via website.state.set(...).
    this._state = null

    // ─── Fields populated by _applyContent (declared up front so Object.seal works) ───
    this.name = ''
    this.description = ''
    this.url = ''
    this._layoutSets = {}
    this.notFoundPage = null
    this._dynamicPageData = new Map()
    this._dynamicPageCache = new Map()
    this.pages = []
    this.activePage = null
    this.pageRoutes = []
    this.themeData = {}
    this.config = {}
    this.siteDefaultLocale = 'en'
    this.defaultLocale = 'en'
    this.activeLocale = 'en'
    this.locales = []
    this.activeLang = 'en'
    this.langs = []
    this._routeTranslations = {}
    this.basePath = ''
    this.versionedScopes = {}
    this._pageIdMap = new Map()

    this._applyContent(content)

    Object.seal(this)
  }

  /**
   * Populate content-derived fields from a site-content payload. Called once
   * from the constructor and again from `rebuild({ content })`. All state that
   * belongs on the Website but derives from the content payload lives here.
   *
   * @private
   */
  _applyContent(content) {
    const {
      pages = [],
      theme = {},
      config = {},
      layouts,
      notFound,
      versionedScopes = {},
    } = content || {}

    this.name = config.name || ''
    this.description = config.description || ''
    this.url = config.url || ''

    // Layout areas (header/footer/left/right pages scoped per named layout).
    this._layoutSets = {}
    if (layouts && typeof layouts === 'object') {
      for (const [name, areaData] of Object.entries(layouts)) {
        this._layoutSets[name] = {}
        for (const [areaName, pageData] of Object.entries(areaData)) {
          if (pageData) {
            this._layoutSets[name][areaName] = new Page(pageData, `layout-${name}-${areaName}`, this)
          }
        }
      }
    }

    // 404 / not-found page (content payload or /404 route).
    const notFoundData = notFound || pages.find((p) => p.route === '/404') || null
    this.notFoundPage = notFoundData ? new Page(notFoundData, 'notFound', this) : null

    const regularPages = pages.filter((page) => page.route !== '/404')

    // Dynamic route templates — retained in original form so the Website can
    // materialize concrete pages on demand (/blog/:slug → /blog/my-post).
    this._dynamicPageData = new Map()
    for (const pageData of regularPages) {
      if (pageData.isDynamic || pageData.route?.includes(':')) {
        this._dynamicPageData.set(pageData.route, pageData)
      }
    }
    this._dynamicPageCache = new Map()

    this.pages = regularPages.map((page, index) => new Page(page, index, this))
    this.buildPageHierarchy()

    this.activePage =
      this.pages.find((page) => page.isIndex && page.getNavRoute() === '/') ||
      this.pages[0] ||
      null

    this.pageRoutes = this.pages.map((page) => page.route)
    this.themeData = theme
    this.config = config

    this.siteDefaultLocale = config.defaultLanguage || 'en'
    this.defaultLocale = config.domainLocale || this.siteDefaultLocale
    this.activeLocale = config.activeLocale || this.defaultLocale

    this.locales = this.buildLocalesList(config)
    this.activeLang = this.activeLocale
    this.langs = this.locales.map((l) => ({ label: l.label || l.code, value: l.code }))

    this._routeTranslations = this._buildRouteTranslations(config)
    this.versionedScopes = versionedScopes
  }

  /**
   * Rebuild in place. Content-only rebuilds preserve the dispatcher and all
   * state (site and per-page). Passing `foundation` or `extensions` reassembles
   * the dispatcher; the DataStore cache survives so warm entries aren't lost.
   *
   * The returned value is `this` for chaining.
   *
   * @param {Object} options
   * @param {Object} [options.content] - New site-content payload.
   * @param {Object} [options.foundation] - New primary foundation module.
   * @param {Array}  [options.extensions] - New extensions array.
   * @returns {Website}
   */
  rebuild({ content, foundation, extensions } = {}) {
    const foundationChanged = foundation !== undefined
    const extensionsChanged = extensions !== undefined
    if (foundationChanged) this._foundation = foundation
    if (extensionsChanged) this._extensions = extensions

    if (foundationChanged || extensionsChanged) {
      this.fetcher = new FetcherDispatcher({
        foundation: this._foundation,
        extensions: this._extensions,
        dataStore: this.dataStore,
        defaultFetcher: this._defaultFetcher,
        transport: this._transport,
        dev: this._dev,
      })
    }

    if (content !== undefined) this._applyContent(content)
    return this
  }

  /**
   * Observable site-wide state. Foundations write cross-page values here
   * (authenticated user, appearance preference, a filter set on /search
   * that other pages honor); fetchers read it via ctx.website.state when
   * handling site-level fetch configs. Lazily allocated on first read —
   * sites that never touch state never build one.
   */
  get state() {
    if (!this._state) this._state = new ObservableState()
    return this._state
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
    const languages = config.languages || []

    // Normalize input: convert strings to objects, keep objects as-is
    const normalizeLocale = (locale) => {
      if (typeof locale === 'string') {
        return { code: locale }
      }
      // Object with code and optional label
      return { code: locale.code, ...(locale.label && { label: locale.label }) }
    }

    // Start with default locale (may not be in languages list)
    const localeMap = new Map()
    localeMap.set(defaultLocale, { code: defaultLocale })

    // Add configured languages (may include objects with labels)
    for (const locale of languages) {
      const normalized = normalizeLocale(locale)
      // Merge with existing (to preserve labels if default locale also in languages with label)
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
    if (!locale || locale === this.siteDefaultLocale) return canonicalRoute
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
    if (!locale || locale === this.siteDefaultLocale) return displayRoute
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

    // Fallback: infer parent-child from route structure for unlinked pages.
    // The editor sets parentRoute via buildEnginePreviewPayload(), but published
    // payloads may not include it. Infer from route nesting so children arrays
    // are always populated (needed for nav filtering and getNavigableRoute).
    // Only applies to nested routes (e.g., /Articles/index → parent /Articles).
    // Top-level pages (e.g., /Features) are NOT children of the homepage.
    for (const page of this.pages) {
      if (page.parent || page.route === '/') continue
      const inferredParent = page.route.replace(/\/[^/]+$/, '')
      if (!inferredParent || inferredParent === '/' || inferredParent === page.route) continue
      const parent = pageMap.get(inferredParent)
      if (parent) {
        parent.children.push(page)
        page.parent = parent
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
      // Folder-name fallback — allows page:home for homepage, page:docs/intro for index pages
      // Homepage route normalizes to '' (falsy, skipped above), but sourcePath '/home' → 'home' works
      if (page.sourcePath) {
        const folderId = page.sourcePath.replace(/^\//, '').replace(/\/$/, '')
        if (folderId && !this._pageIdMap.has(folderId)) {
          this._pageIdMap.set(folderId, page)
        }
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

    // Normalize trailing slashes for consistent matching
    const normalizedStripped = stripped === '/' ? '/' : stripped.replace(/\/$/, '')

    // Priority 1: Direct match on the (possibly display) route.
    // Handles published-payload sites where the page map may already contain
    // locale-translated display routes (e.g. fr pages have fr routes).
    // For file-system sites whose page map uses canonical routes this will
    // simply fall through to the reverse-translate path below.
    const directMatch = this.pages.find((page) => page.route === normalizedStripped)
    if (directMatch) {
      // Folder with index child: always resolve to the index page.
      // The index child is the designated landing page for this folder URL.
      const indexChild = directMatch.children.find((c) => c.isIndex)
      if (indexChild) return indexChild
      return directMatch
    }

    // Reverse-translate display route to canonical (e.g., '/acerca-de' → '/about')
    stripped = this.reverseTranslateRoute(stripped)

    // Normalize trailing slashes for consistent matching
    // '/about/' and '/about' should match the same page
    const normalizedRoute = stripped === '/' ? '/' : stripped.replace(/\/$/, '')

    // Priority 1b: Exact match on canonical route
    const exactMatch = this.pages.find((page) => page.route === normalizedRoute)
    if (exactMatch) {
      const indexChild = exactMatch.children.find((c) => c.isIndex)
      if (indexChild) return indexChild
      return exactMatch
    }

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
        const result = this._createDynamicPage(page, normalizedRoute, match.params)
        if (result) {
          const { page: dynamicPage, collectionLoaded } = result
          // Only cache when collection data was available at creation time.
          // If DataStore was empty, skip caching so the next render recreates
          // the page with fresh data (correct title, not-found state, etc.).
          if (collectionLoaded) {
            this._dynamicPageCache.set(normalizedRoute, dynamicPage)
          }
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

    // Set dynamic context on sections so Block instances receive it
    if (pageData.sections && Array.isArray(pageData.sections)) {
      for (const section of pageData.sections) {
        section.dynamicContext = pageData.dynamicContext
      }
    }

    // Try to resolve page metadata from DataStore
    // Look up the parent page's fetch config to find data in the store
    const parentRoute = templatePage.route.replace(/\/:[\w]+$/, '') || '/'
    const parentPage = this.pages.find(p => p.route === parentRoute || p.getNavRoute() === parentRoute)

    if (parentPage && pluralSchema) {
      // Find collection data from parent's fetch config via the dispatcher's
      // peek (sync cache probe). Used to populate the page title / notFound
      // flag on dynamic pages before the page instance is constructed.
      const parentFetch = parentPage.fetch
      let items = []

      if (parentFetch && this.fetcher) {
        const fetchConfig = Array.isArray(parentFetch)
          ? parentFetch.find(f => f.schema === pluralSchema)
          : (parentFetch.schema === pluralSchema ? parentFetch : null)
        if (fetchConfig) {
          const cached = this.fetcher.peek(fetchConfig, { website: this })
          items = Array.isArray(cached?.data) ? cached.data : []
        }
      }

      const currentItem = items.find(item => String(item[paramName]) === String(paramValue))

      if (currentItem) {
        if (currentItem.title) pageData.title = currentItem.title
        if (currentItem.description || currentItem.excerpt) {
          pageData.description = currentItem.description || currentItem.excerpt
        }
      } else if (items.length > 0) {
        // Collection is loaded but this ID isn't in it — definitive not found
        pageData.title = 'Not found'
        pageData.notFound = true
      }

      // Store in dynamic context for entity resolution
      pageData.dynamicContext.currentItem = currentItem || null
      pageData.dynamicContext.allItems = items

      // Track whether collection data was available at creation time
      pageData._collectionLoaded = items.length > 0
    }

    // Create the page instance
    const dynamicPage = new Page(pageData, `dynamic-${concreteRoute}`, this)

    // Copy parent reference from template
    dynamicPage.parent = templatePage.parent

    return { page: dynamicPage, collectionLoaded: pageData._collectionLoaded ?? true }
  }

  /**
   * Singularize a plural schema name
   * @private
   */
  _singularize(name) {
    return singularize(name)
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
   * @param {string|null} layoutName - Named layout to look up (null = default)
   */
  getRemoteLayout(layoutName) {
    const config = globalThis.uniweb?.foundationConfig
    if (!config?.layouts) return null
    if (layoutName && config.layouts[layoutName]) {
      return config.layouts[layoutName]
    }
    return null
  }

  /**
   * Get default layout name from foundation config
   * @returns {string|null}
   */
  getDefaultLayoutName() {
    return globalThis.uniweb?.foundationConfig?.defaultLayout || null
  }

  /**
   * Get default block type from foundation config
   */
  getDefaultBlockType() {
    return globalThis.uniweb?.foundationConfig?.defaultSection || 'Section'
  }

  // ─────────────────────────────────────────────────────────────────
  // Layout Areas (general named areas)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get blocks for a specific area, with layout name resolution
   * @param {string} areaName - Area name (e.g., 'header', 'footer', 'left', 'sidebar')
   * @param {string} [layoutName] - Named layout to look in (falls back to 'default')
   * @returns {Block[]|null}
   */
  getAreaBlocks(areaName, layoutName) {
    if (layoutName && this._layoutSets[layoutName]) {
      return this._layoutSets[layoutName][areaName]?.bodyBlocks || null
    }
    // Fallback to 'default' layout
    if (this._layoutSets.default) {
      return this._layoutSets.default[areaName]?.bodyBlocks || null
    }
    return null
  }

  /**
   * Get all areas for a layout as { areaName: Block[] }
   * @param {string} [layoutName] - Named layout (falls back to 'default')
   * @returns {Object} Map of areaName -> Block[]
   */
  getLayoutAreas(layoutName) {
    const setName = layoutName || 'default'
    const layoutSet = this._layoutSets[setName] || this._layoutSets.default
    if (!layoutSet) return {}

    const areas = {}
    for (const [areaName, page] of Object.entries(layoutSet)) {
      if (page?.bodyBlocks) {
        areas[areaName] = page.bodyBlocks
      }
    }
    return areas
  }

  /**
   * Get layout metadata from foundation config
   * @param {string} layoutName - Layout name
   * @returns {Object|null} Layout meta { areas, transitions, defaults }
   */
  getLayoutMeta(layoutName) {
    return globalThis.uniweb?.foundationConfig?.layoutMeta?.[layoutName] || null
  }

  /**
   * Whether view transitions are enabled for SPA navigation.
   * Defaults to true — the browser's default crossfade is progressive
   * enhancement with no downside. Foundations can set viewTransitions: false
   * in foundation.js to disable.
   * @type {boolean}
   */
  get viewTransitions() {
    return globalThis.uniweb.foundationConfig?.viewTransitions !== false
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
    if (!href) return href

    // Support both page: (current) and topic: (legacy) prefixes
    let withoutPrefix
    if (href.startsWith('page:')) {
      withoutPrefix = href.slice(5)
    } else if (href.startsWith('topic:')) {
      withoutPrefix = href.slice(6)
    } else {
      return href
    }

    // Parse page reference: page:pageId#sectionId
    const [pageId, sectionId] = withoutPrefix.split('#')

    // Look up page by ID (explicit or route-based)
    const page = this._pageIdMap?.get(pageId)

    if (!page) {
      // Page not found - return original href (or could warn in dev)
      if (typeof console !== 'undefined' && typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production') {
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
    // Use getNavRoute() so index pages return the clean folder URL
    // (e.g., /Articles instead of /Articles/index)
    let targetRoute = route || this.activePage.getNavRoute()

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

    // Per-domain locale: if a domain is designated for this locale,
    // return a full cross-domain URL instead of a path-based prefix.
    const domainLocales = this.config?.domainLocales
    if (domainLocales) {
      const designated = Object.entries(domainLocales).find(([, lang]) => lang === localeCode)
      if (designated) {
        const domain = designated[0]
        const translatedRoute = this.translateRoute(targetRoute, localeCode)
        return `https://${domain}${translatedRoute === '/' ? '/' : translatedRoute}`
      }
    }

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
      // Always exclude dynamic route template pages (e.g., /blog/:slug)
      // These are templates for generating pages, not actual navigable pages
      if (page.route.includes(':')) return false

      // Exclude index pages (route ends in /index) from navigation — they are
      // represented by their parent folder entry which links to them via navigableRoute
      if (page.isIndex && page.route.endsWith('/index')) return false

      // Check visibility based on navigation type
      if (!includeHidden) {
        if (page.hidden) return false
        if (navType === 'header' && page.hideInHeader) return false
        if (navType === 'footer' && page.hideInFooter) return false
      }

      // Skip content-less containers that have no visible or navigable children.
      // Folders with an isIndex child are navigable (they link to the index page)
      // even though the index child itself is filtered out of the nav tree above.
      // Containers with other visible children stay as group nodes.
      if (!page.hasContent()) {
        const hasNavigableIndex = page.children?.some((c) => c.isIndex)
        if (!hasNavigableIndex && !page.children?.some(isPageVisible)) return false
      }

      // Apply custom filter if provided
      if (customFilter && !customFilter(page)) return false

      return true
    }

    let filteredPages = this.pages.filter(isPageVisible)

    // When nested, only include root-level pages at top level
    // (children will be nested inside their parents)
    if (nested) {
      // Exclude child pages from root list. Also exclude orphans whose parent
      // was removed (e.g., hidden) — they have parentRoute but no resolved parent.
      filteredPages = filteredPages.filter(page => !page.parent && !page.parentRoute)
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
        title: page.getTitle(),
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
    return this.activePage.getNormalizedRoute()
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
