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
import { normalizeSeo } from './seo.js'
import { resolveDefaultLocale, localeLabel } from './locale-config.js'
import { matchDynamicRoute, decodeRouteValue, routePatternToRegex, splitPathCapture } from './route-match.js'
import { resolveFetchConfigs } from './fetch-config.js'
import { buildDetailConfig } from './detail-url.js'
import { resolveService } from './services.js'

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
    this.entityStore = new EntityStore({ website: this, dev })

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
    this.seo = {} // site-level SEO/social defaults (normalized; cascade to pages)
    this.keywords = null // site-level default keywords (localized list or null)
    this.siteDefaultLocale = 'en'
    this.defaultLocale = 'en'
    this.activeLocale = 'en'
    this.locales = []
    this.activeLang = 'en'
    this.langs = []
    this._routeTranslations = {}
    this.basePath = ''
    this.versionedScopes = {}
    this.assets = {}
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
      assets = {},
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

    // Site-level SEO/social metadata — defaults that cascade to every page's
    // effective head meta (Page.getHeadMeta). `config.seo` / `config.keywords`
    // ride the raw site.yml spread; normalize seo to the canonical shape here.
    this.seo = normalizeSeo(config.seo)
    this.keywords = config.keywords || null

    this.siteDefaultLocale = resolveDefaultLocale(config)
    this.defaultLocale = config.domainLocale || this.siteDefaultLocale
    this.activeLocale = config.activeLocale || this.defaultLocale

    this.locales = this.buildLocalesList(config)
    this.activeLang = this.activeLocale
    this.langs = this.locales.map((l) => ({ label: l.label || l.code, value: l.code }))

    this._routeTranslations = this._buildRouteTranslations(config)
    this.versionedScopes = versionedScopes
    this.assets = assets
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
   * Every returned locale carries a resolved `label`: an explicitly configured
   * one wins, otherwise it comes from LOCALE_DISPLAY_NAMES, otherwise the code
   * uppercased. It used to be passed through only when configured, which made
   * the common foundation idiom `locale.label || locale.code` render "fr"
   * instead of "Français" for a plain-string `languages:` entry — i.e. the form
   * locale-config tells authors to migrate to was the one that read worse.
   * @private
   */
  buildLocalesList(config) {
    const defaultLocale = resolveDefaultLocale(config)
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
      label: localeLabel(locale),
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

    // The caller hands us a route that came from a URL, and a browser
    // percent-encodes everything outside the unreserved set — so a French slug
    // arrives as `/Sites-Web/Th%C3%A8me-du-site-Web`. The translation map is
    // built from site.yml, where it is authored as plain text. Decoding here
    // rather than at each call site is deliberate: getPage(), normalizeRoute()
    // and getLocaleUrl() all feed this, and a future caller would have to
    // remember otherwise.
    //
    // Without it translateRoute() emits a URL this method cannot read back —
    // every translated route carrying a non-ASCII character or an apostrophe
    // resolved to nothing and rendered the 404 page, while the SAME route with
    // an all-ASCII slug worked. The helper is shared with the captured-param
    // decode in `route-match.js`, which needs the identical guard.
    const route = decodeRouteValue(displayRoute)

    // Exact match
    const canonical = entry.reverse.get(route)
    if (canonical) return canonical
    // Prefix match
    for (const [trans, canon] of entry.reverse) {
      if (route.startsWith(trans + '/')) {
        return canon + route.slice(trans.length)
      }
    }
    return route
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
    // Decode before ANY comparison: a published payload can hold translated
    // display routes verbatim, so the direct match below needs the same plain
    // text form the reverse-translate path does.
    let stripped = decodeRouteValue(route)
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
    //
    // Feed it the TRAILING-SLASH-NORMALIZED form. The translation map is keyed
    // without a trailing slash, so `/acerca-de/` missed the exact lookup and
    // fell through to the prefix branch, which rewrites only the FIRST segment
    // — `/blogue/mi-articulo/` became `/blog/mi-articulo/`, leaving the child
    // segment untranslated and pointing at no page. It looked like it worked
    // for as long as every child slug happened to be identical in both locales.
    stripped = this.reverseTranslateRoute(normalizedStripped)

    // A translation VALUE may itself carry a trailing slash, so normalize again
    // rather than assuming the input normalization covered it.
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
          const { page: dynamicPage, recordsLoaded } = result
          // Only cache when the records were available at creation time.
          // If DataStore was empty, skip caching so the next render recreates
          // the page with fresh data (correct title, not-found state, etc.).
          if (recordsLoaded) {
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
    // Delegates to the exported matcher so a host rendering this site
    // server-side can reach the identical rule — see ./route-match.js for why
    // that is a contract rather than an implementation detail.
    return matchDynamicRoute(pattern, path)
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

    // ⭐ The route's variables, and the param the record is delivered by.
    //
    // `[slug]` — the one capture, under the folder's own label: `paramName` is
    // that label and the record is matched on `item[paramName]`.
    //
    // `[...path]` — the capture is split by the rule in `route-match.js`
    // (`:path` the whole capture · `:dir` everything before the last segment ·
    // `:slug` the last segment); the record is delivered by `slug`, its handle,
    // exactly as under `[slug]`, and `path` / `dir` exist for a query to bind
    // (`scope: :dir`, `where: { tag: :dir }`). Ruled 2026-09-04 [Diego]: the
    // variables are standard, never author-named.
    const { catchAll } = routePatternToRegex(templatePage.route)
    let variables = { ...params }
    let paramName
    let paramValue
    if (catchAll && params[catchAll] !== undefined) {
      const parts = splitPathCapture(params[catchAll])
      variables = { ...params, ...parts }
      paramName = originalData.paramName || 'slug'
      paramValue = parts.slug
    } else {
      paramName = originalData.paramName || Object.keys(params)[0]
      paramValue = params[paramName]
    }
    const pluralSchema = originalData.parentSchema // e.g., 'articles'

    // Store dynamic context for components to access
    pageData.dynamicContext = {
      templateRoute: templatePage.route,
      params: variables,
      paramName,
      paramValue,
      schema: pluralSchema,
    }

    // Set dynamic context on sections so Block instances receive it
    if (pageData.sections && Array.isArray(pageData.sections)) {
      for (const section of pageData.sections) {
        section.dynamicContext = pageData.dynamicContext
      }
    }

    // Try to resolve page metadata from DataStore
    // Look up the parent page's fetch config to find data in the store
    // The template's parent: the route without its `:param` — or `:path*` — tail.
    const parentRoute = templatePage.route.replace(/\/:[\w-]+\*?$/, '') || '/'
    const parentPage = this.pages.find(p => p.route === parentRoute || p.getNavRoute() === parentRoute)

    if (parentPage && pluralSchema) {
      // Find the record the page is ABOUT via the dispatcher's peek (a sync
      // cache probe), to set the page title / description / notFound flag
      // before the page instance is constructed.
      //
      // ⛔ RESOLVED THE WAY THE ENTITY STORE RESOLVES IT, not the raw declaration.
      // Until 2026-09-04 this peeked `parentPage.fetch` as authored — `{ query,
      // path, as }` — while the store writes under the RESOLVED config: on a live
      // lane that carries `endpoint` and no `path`, and on a non-default locale a
      // `/fr/data/…` path. Two different keys for one dataset, so the probe
      // missed on exactly those lanes: no title, no not-found, and the page was
      // never cached (`recordsLoaded` false on every visit). Silent, on a
      // visitor's page — the "write key ≠ read key" failure.
      const parentFetch = parentPage.fetch
      let items = []
      let currentItem = null

      if (parentFetch && this.fetcher) {
        // ⛔ `as` is the binding key. This matched on `schema` alone until
        // 2026-09-02 — which, once the alias went, would have found nothing:
        // `items` stays `[]` and the page reports "Not found" for a record that
        // exists. Silent, and on a visitor's page.
        const fetchConfig = resolveFetchConfigs([parentFetch], {
          schemas: [pluralSchema],
          locale: this.getActiveLocale(),
          defaultLocale: this.getDefaultLocale(),
          queries: this.config?.queries ?? null,
          records: this.config?.records ?? null,
          variables,
        }).get(pluralSchema)
        if (fetchConfig) {
          const ctx = { website: this }
          // ⭐ The page is about ONE record, so ask for that record first: a
          // cached detail fetch (a live lane's record address, a deferred
          // query's per-record file) carries the title even when the list was
          // never fetched — a cold load on a detail URL — where a scan of the
          // list finds nothing and silently sets no title (F3, 2026-09-04).
          const detailCfg = fetchConfig.detail
            ? buildDetailConfig(fetchConfig, { paramName, paramValue })
            : null
          const detailCached = detailCfg ? this.fetcher.peek(detailCfg, ctx) : null
          const record = detailCached?.data
          if (record && typeof record === 'object' && !Array.isArray(record)) currentItem = record

          const cached = this.fetcher.peek(fetchConfig, ctx)
          items = Array.isArray(cached?.data) ? cached.data : []
        }
      }

      if (!currentItem) {
        currentItem = items.find(item => String(item[paramName]) === String(paramValue)) ?? null
      }

      if (currentItem) {
        if (currentItem.title) pageData.title = currentItem.title
        if (currentItem.description || currentItem.excerpt) {
          pageData.description = currentItem.description || currentItem.excerpt
        }
      } else if (items.length > 0) {
        // The records are loaded but this ID isn't among them — definitive not found
        pageData.title = 'Not found'
        pageData.notFound = true
      }

      // Track whether the records were available at creation time.
      // Note: the matched record and the sibling list are intentionally NOT
      // stored on dynamicContext — nothing reads them (documented shape is
      // { paramName, paramValue, schema }; the record reaches components via
      // content.data, siblings via `fetch: { refine: true, detail: false }`).
      // The local `currentItem`/`items` above drive title/description/notFound.
      pageData._recordsLoaded = items.length > 0 || currentItem !== null
    }

    // Create the page instance
    const dynamicPage = new Page(pageData, `dynamic-${concreteRoute}`, this)

    // Copy parent reference from template
    dynamicPage.parent = templatePage.parent

    return { page: dynamicPage, recordsLoaded: pageData._recordsLoaded ?? true }
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
   * The route template that renders ONE record of a binding key — `{ route,
   * paramName }` for the `[param]` page whose parent query lands under `key`,
   * or null when the site routes no detail page over it.
   *
   * ⭐ This is how a caller outside a template page learns which record field
   * the site's URL is built on: `kit`'s `useEntityDetail` asks it so a hover
   * card and the page it links to address the record by the SAME field. It
   * hardcoded `slug` until 2026-09-04, which was quietly wrong on any site
   * routing `[id]`. The first template found
   * wins, matching `parentSchema`'s own rule that one key indexes one template.
   *
   * @param {string} key - a binding key (`content.data.<key>`)
   * @returns {{ route: string, paramName: string } | null}
   */
  detailTemplateFor(key) {
    if (!key) return null
    for (const data of this._dynamicPageData.values()) {
      if (data?.parentSchema === key && data.paramName) {
        return { route: data.route, paramName: data.paramName }
      }
    }
    return null
  }

  /**
   * Resolve a `page:<stable_id>` detail-page reference (from a fetch config's
   * `detailPage`) to a locale-specific route TEMPLATE, e.g. '/blog/:slug'. The
   * entity store interpolates each record's field into the `:param` slot to build
   * a card's href — so a dynamic-list preview links to the query's canonical
   * detail page regardless of which page it sits on.
   *
   * O(1): a `_pageIdMap` lookup (keyed on stable_id, same map makeHref uses), NOT
   * a page-tree scan. Returns null when the ref is unresolvable — the target page
   * was deleted or de-dynamicized (a dangling ref); the caller degrades gracefully
   * (leaves the record without a `route`). Rename-safe: a stable_id survives page
   * reorganization.
   *
   * @param {string} pageRef - `page:<stable_id>` (bare `<stable_id>` also accepted)
   * @returns {string|null} locale-specific route template, or null if unresolvable
   */
  resolveDetailPageTemplate(pageRef) {
    if (!pageRef || typeof pageRef !== 'string') return null
    const id = pageRef.startsWith('page:') ? pageRef.slice(5) : pageRef
    const page = this._pageIdMap?.get(id)
    if (!page || !page.route) {
      if (
        typeof console !== 'undefined' &&
        typeof process !== 'undefined' &&
        process?.env?.NODE_ENV !== 'production'
      ) {
        console.warn(`[resolveDetailPageTemplate] Detail page not found: ${pageRef}`)
      }
      return null
    }
    return this.translateRoute(page.route)
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
   * Get all available locales.
   *
   * `label` is always present and always displayable: an explicitly configured
   * label wins, otherwise it is resolved from LOCALE_DISPLAY_NAMES, otherwise it
   * is the code uppercased. So `locale.label` needs no fallback at the call site
   * — the idiom `locale.label || locale.code` is now redundant rather than
   * load-bearing, and kit's `getLocaleLabel()` is only needed for a code that
   * did not come from here.
   *
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
   * Check if search is enabled for this site.
   *
   * ⛔ `search: false` USED TO LEAVE SEARCH ON. The predicate was
   * `config?.search?.enabled !== false`, and optional chaining short-circuits
   * on `null`/`undefined` only — so `false?.enabled` evaluates `false.enabled`
   * to `undefined`, and `undefined !== false` is `true`. An author writing the
   * natural shorthand for "off" got search **on**, silently.
   *
   * ⚠️ Measured on a live hosted payload 2026-08-25: the boolean form is what
   * actually arrives — that site carried `config.search === true`, which
   * worked only by
   * the same accident. Only the object form is documented, so the boolean is
   * either authored or synthesized upstream; either way it reaches here.
   *
   * ⭐ Why this mattered more than its size: on a backend-hosted site the
   * search index is not emitted (see `getSearchIndexUrl` below), so an operator
   * whose search box is failing reaches for exactly this switch — and it was
   * the one input that did nothing.
   *
   * Both forms now work, and absent still means enabled.
   *
   * @returns {boolean}
   */
  isSearchEnabled() {
    const search = this.config?.search
    if (typeof search === 'boolean') {
      if (!search) return false
    } else if (search?.enabled === false) {
      return false
    }

    // ⭐ THE HOST GETS A SAY, and this is the half that reaches an already-
    // published foundation. A foundation bundles its own frozen copy of
    // `@uniweb/kit`, so a fix made in kit never reaches one built before it.
    // `@uniweb/core` is different: the runtime carries it and re-exports it
    // through the import map, so a foundation of any age calls THIS method.
    //
    // A host that publishes a services block is stating what it offers. If it
    // does not name `search`, the site has no search — and a control for a
    // service the site does not have must not be drawn. That is the rule for
    // every service (`submit` draws no form, `assistant` and `tracking` draw
    // nothing); search was the outlier only because it had a legacy local
    // index to fall through to, and on a host-served site nothing emits one.
    //
    // ⛔ Deliberately no reason and no message: not-provisioned is not an
    // error, and any text a visitor reads is site content — authored and
    // localized — never a string a service layer invents.
    //
    // A site's OWN `search.endpoint` still wins: `resolveService` answers from
    // the site tier first, so self-hosted search on a host that does not sell
    // it is untouched.
    const { url, source } = resolveService(this, 'search')
    if (source === 'host' && !url) return false

    // Enabled by default — absent means enabled, and a host that publishes no
    // services block at all has declined nothing (the static-host path).
    return true
  }

  /**
   * Get search configuration
   * @returns {Object} Search configuration
   */
  getSearchConfig() {
    // A boolean `search:` carries no options — normalize it away so every
    // read below (`config.provider`, `config.include?.…`) sees an object.
    // `true || {}` would otherwise yield `true` and every option read would
    // land on a boolean.
    const raw = this.config?.search
    const config = (raw && typeof raw === 'object') ? raw : {}

    return {
      enabled: this.isSearchEnabled(),
      // Which provider serves results. `index` (the default) downloads a
      // prebuilt index and queries it in the browser — free, and works on any
      // host. `endpoint` queries a server-side search API, which is what makes
      // dynamic/API-backed content searchable. Any other value names a
      // foundation-supplied search transport.
      //
      // Kit resolves and loads the provider; core only passes the declaration
      // through, so a site that never searches pays nothing for the vocabulary
      // (see kit's search module for the resolution rules).
      provider: config.provider || 'index',
      // Base-RELATIVE path for the `endpoint` provider. Left raw here: kit
      // resolves it against `basePath`, so one spelling works whether the site
      // is served from the root, from a subdirectory, or from a backend
      // subpath. Undefined unless declared.
      endpoint: config.endpoint,
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
   * Get the URL for the search index file.
   *
   * Includes `basePath`, so the URL is correct on a site deployed under a
   * subdirectory (`base: /docs/`) and on a backend-hosted site served from a
   * subpath. Omitting it was a real bug: the returned path was fetched
   * verbatim, so search 404'd on every non-root deployment while data fetching
   * — which resolves the same base — worked.
   *
   * @returns {string} URL to fetch the search index
   */
  getSearchIndexUrl() {
    const locale = this.getActiveLocale()
    const isDefault = locale === this.getDefaultLocale()

    // Default locale uses root path, others use locale prefix
    const path = isDefault ? '/search-index.json' : `/${locale}/search-index.json`

    // `basePath` is already normalized without a trailing slash ('' at root).
    return `${this.basePath || ''}${path}`
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
        // `hidden` = unpublished (a fortiori not in nav). In a published build it
        // is already pruned; this also keeps dev drafts out of the menus.
        if (page.hidden) return false
        // hideIn lists the areas this page is suppressed from; '*' suppresses it
        // from every area (reachable-but-out-of-all-menus). navType is the
        // requested area ('header'/'footer'/any foundation-declared area).
        if (page.hideIn?.includes('*')) return false
        if (navType && page.hideIn?.includes(navType)) return false
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
   * Get the page tree for the branch a route sits in.
   *
   * A sidebar shows one branch of a site, not the whole thing: under /docs it
   * lists the documentation, and under a different top-level section it would
   * list that instead. Every documentation shell built on this framework has
   * hand-written the same narrowing, so it lives here — it is a question about
   * the page graph, with no React and no DOM in it.
   *
   * Answers the branch's children when it has any, the branch itself when it
   * is a leaf, and the whole hierarchy when the route matches no branch (the
   * site root, most often). The pages come back in the order the build settled
   * on; `pages:` lists are resolved at build time, so there is nothing to sort.
   *
   * @param {Object} [options]
   * @param {string} options.route - The active route, e.g. '/docs/reference/cli'
   * @param {string} [options.for] - Layout area being filled ('left', 'header', …).
   *   Checked against each page's `hideIn`, so a page can sit out of this rail
   *   while staying in the menu. Name the area the tree is actually for.
   * @param {boolean} [options.includeHidden=false] - Include unpublished pages
   * @returns {Array<Object>} Page info objects, nested
   *
   * @example
   * // In a sidebar component rendered into the `left` layout area
   * const pages = website.getBranchHierarchy({ route: location.pathname, for: 'left' })
   */
  getBranchHierarchy({ route = '', for: navType, includeHidden = false } = {}) {
    const normalize = (value) => (value || '').replace(/^\/+/, '').replace(/\/+$/, '')

    const all = this.getPageHierarchy({ for: navType, includeHidden })
    const branchName = normalize(route).split('/')[0]
    if (!branchName) return all

    const branch = all.find((page) => normalize(page.route) === branchName)
    if (!branch) return all

    return branch.children?.length ? branch.children : [branch]
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
