/**
 * Page
 *
 * Represents a single page with header, body, footer, and panel sections.
 * Each layout area can have multiple sections/blocks.
 */

import Block from './block.js'
import ObservableState from './observable-state.js'

// Normalize a page's nav-visibility into a deduped hideIn array (the layout-area
// names the page is suppressed from). Reads the canonical hideIn (array, or a single
// string) and folds in the legacy hideInHeader/hideInFooter booleans for back-compat.
function normalizeHideIn(pageData) {
  const out = []
  const seen = new Set()
  const add = (a) => {
    if (typeof a === 'string' && a && !seen.has(a)) {
      seen.add(a)
      out.push(a)
    }
  }
  const raw = pageData.hideIn
  if (Array.isArray(raw)) raw.forEach(add)
  else add(raw)
  if (pageData.hideInHeader) add('header')
  if (pageData.hideInFooter) add('footer')
  return out
}

export default class Page {
  constructor(pageData, id, website) {
    this.id = id
    this.stableId = pageData.id || null // Stable page ID for page: links (from page.yml)
    this.route = pageData.route
    this.sourcePath = pageData.sourcePath || null // Original folder-based path (for ancestor checking)
    this.isIndex = pageData.isIndex || false // True if this page is the index for its parent route
    this.parentRoute = pageData.parent || null // Declared parent route for hierarchy linking (set by build)
    this.title = pageData.title || ''
    this.description = pageData.description || ''
    this.label = pageData.label || null // Short label for navigation (null = use title)
    this.keywords = pageData.keywords || null
    this.lastModified = pageData.lastModified || null

    // Redirect target (if set, this page redirects instead of rendering content)
    this.redirect = pageData.redirect || null
    // Rewrite target (if set, this route is served by an external site)
    this.rewrite = pageData.rewrite || null

    // Navigation visibility. `hidden` excludes the page from all nav; `hideIn` is a
    // per-area denylist (layout-area names, e.g. ['header','footer']). The legacy
    // hideInHeader/hideInFooter booleans are folded into hideIn and kept as derived
    // accessors for back-compat.
    this.hidden = pageData.hidden || false
    this.hideIn = normalizeHideIn(pageData)
    this.hideInHeader = this.hideIn.includes('header')
    this.hideInFooter = this.hideIn.includes('footer')

    // Layout options (named layout + per-page overrides)
    this.layout = {
      name: pageData.layout?.name || null,
      hide: pageData.layout?.hide || [],
      params: pageData.layout?.params || {},
    }

    // SEO configuration
    this.seo = {
      noindex: pageData.seo?.noindex || false,
      image: pageData.seo?.image || null,
      ogTitle: pageData.seo?.ogTitle || null,
      ogDescription: pageData.seo?.ogDescription || null,
      canonical: pageData.seo?.canonical || null,
      changefreq: pageData.seo?.changefreq || null,
      priority: pageData.seo?.priority || null,
    }

    // Parent page (set by Website.buildPageHierarchy())
    this.parent = null

    // Child pages (for nested hierarchy) - populated by Website
    this.children = []

    // Back-reference to website
    this.website = website

    // Scroll position memory (for navigation restoration)
    this.scrollY = 0

    // Fetch configuration (from page.yml data: field)
    // Preserved at runtime so EntityStore can walk the page hierarchy
    this.fetch = pageData.fetch || null

    // Dynamic route context (for pages created from dynamic routes like /blog/:slug)
    this.dynamicContext = pageData.dynamicContext || null

    // Version context (for pages within versioned sections like /docs/v1/*)
    this.version = pageData.version || null // { id, label, latest, deprecated }
    this.versionMeta = pageData.versionMeta || null // { versions, latestId }
    this.versionScope = pageData.versionScope || null // The route where versioning starts

    // Build-time flag: does this page have renderable content?
    // Distinct from "are sections loaded?" — content-less containers
    // (folders with page.yml but no markdown) are always false.
    // Falls back to checking sections for backward compat (non-split mode).
    this._hasContent = pageData.hasContent ?? (pageData.sections?.length > 0)

    // Store raw section data for lazy block building
    // Blocks are created on first access (when page is rendered), not during Website init
    // This ensures foundationConfig is available for getDefaultBlockType()
    // Layout panels (header, footer, left, right) are shared at Website level
    // undefined = not yet loaded (split mode, non-current page)
    // [] = loaded but empty (content-less container)
    // [...] = loaded with content
    this._bodySections = pageData.sections
    this._bodyBlocks = null

    // Guard against concurrent loadContent() calls
    this._loadingContent = null

    // Observable state — allocated on first access via the `state` getter.
    // Pages that never use state pay nothing; the prop is read-only (no
    // `page.state = X` reassignment) so components can only mutate slots
    // via the intended `page.state.set(key, value)` API.
    this._state = null

    Object.seal(this)
  }

  /**
   * Observable state scoped to this page. Foundations write scoped UI / query
   * state here; kit's usePageState bridges it into React; fetchers read it
   * via ctx.page.state. Lazily allocated on first read — pages that never
   * touch state never build one.
   */
  get state() {
    if (!this._state) this._state = new ObservableState()
    return this._state
  }

  /**
   * Lazy getter for body blocks
   * Blocks are built on first access, ensuring foundation is loaded
   */
  get bodyBlocks() {
    if (!this._bodyBlocks) {
      // If sections haven't been loaded yet (split mode), return empty array.
      // PageRenderer will call loadContent() before rendering.
      if (this._bodySections === undefined) return []
      this._bodyBlocks = (this._bodySections || []).map(
        (section, index) => new Block(section, index, this)
      )
    }
    return this._bodyBlocks
  }

  /**
   * Get metadata for head tags
   * @returns {Object} Head metadata
   */
  getHeadMeta() {
    const resolvedTitle = this.getTitle()
    return {
      title: resolvedTitle,
      description: this.description,
      keywords: this.keywords,
      canonical: this.seo.canonical,
      robots: this.seo.noindex ? 'noindex, nofollow' : null,
      og: {
        title: this.seo.ogTitle || resolvedTitle,
        description: this.seo.ogDescription || this.description,
        image: this.seo.image,
        url: this.route,
      },
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Dynamic Route Support
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if this is a dynamic page (created from a route pattern like /blog/:slug)
   * @returns {boolean}
   */
  isDynamicPage() {
    return this.dynamicContext !== null
  }

  /**
   * Get dynamic route context
   * @returns {Object|null} Dynamic context with params, or null if not a dynamic page
   *
   * @example
   * // For route /blog/:slug matched against /blog/my-post
   * page.getDynamicContext()
   * // { templateRoute: '/blog/:slug', params: { slug: 'my-post' }, paramName: 'slug', paramValue: 'my-post' }
   */
  getDynamicContext() {
    return this.dynamicContext
  }

  /**
   * Get the URL param value for dynamic routes
   * @returns {string|null} The param value (e.g., 'my-post' for /blog/my-post), or null
   */
  getDynamicParam() {
    return this.dynamicContext?.paramValue || null
  }

  /**
   * Get the resolved layout name for this page.
   * Cascade: page.layout.name > foundation defaultLayout > null
   * @returns {string|null}
   */
  getLayoutName() {
    return this.layout.name || this.website?.getDefaultLayoutName() || null
  }

  /**
   * Get all block groups (for Layout component)
   * @returns {Object} { body, ...areas }
   */
  getBlockGroups() {
    return {
      body: this.bodyBlocks,
      ...this.getLayoutAreas(),
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Cross-Block Communication
  // ─────────────────────────────────────────────────────────────────

  /**
   * Find a block's index within the page's block list.
   * Searches across all layout areas (header, body, footer, left, right).
   *
   * @param {Block} block - The block to find
   * @returns {number} The index in the flat list, or -1 if not found
   */
  getBlockIndex(block) {
    const allBlocks = this.getPageBlocks()
    return allBlocks.indexOf(block)
  }

  /**
   * Get information about a block at a specific index.
   * Used for cross-component communication (e.g., NavBar checking Hero's theme).
   *
   * @param {number} index - The block index
   * @returns {Object|null} Block info { theme, component, state } or null
   */
  getBlockInfo(index) {
    const allBlocks = this.getPageBlocks()
    const block = allBlocks[index]
    return block?.getBlockInfo() || null
  }

  /**
   * Get the first body block's info.
   * Common use case: NavBar checking if first section supports overlay.
   *
   * @returns {Object|null} First body block's info or null
   */
  getFirstBodyBlockInfo() {
    return this.bodyBlocks?.[0]?.getBlockInfo() || null
  }

  /**
   * Get all blocks (header, body, footer) as flat array
   * Respects page layout preferences (hide list)
   * @returns {Block[]}
   */
  getPageBlocks() {
    const blocks = []
    const areas = this.getLayoutAreas()
    const headerBlocks = areas.header
    const footerBlocks = areas.footer

    if (headerBlocks) blocks.push(...headerBlocks)
    blocks.push(...this.bodyBlocks)
    if (footerBlocks) blocks.push(...footerBlocks)

    return blocks
  }

  /**
   * Get body blocks
   * @returns {Block[]}
   */
  getBodyBlocks() {
    return this.bodyBlocks
  }

  /**
   * Get blocks for a specific area, respecting hide list
   * @param {string} areaName - Area name (e.g., 'header', 'footer', 'left')
   * @returns {Block[]|null}
   */
  getAreaBlocks(areaName) {
    if (this.layout.hide.includes(areaName)) return null
    return this.website.getAreaBlocks(areaName, this.getLayoutName())
  }

  /**
   * Get all areas for this page's layout, excluding hidden areas
   * @returns {Object} Map of areaName -> Block[]
   */
  getLayoutAreas() {
    const allAreas = this.website.getLayoutAreas(this.getLayoutName())
    const result = {}
    for (const [name, blocks] of Object.entries(allAreas)) {
      if (!this.layout.hide.includes(name)) {
        result[name] = blocks
      }
    }
    return result
  }

  /**
   * Get layout params for this page (merged with defaults at render time)
   * @returns {Object}
   */
  getLayoutParams() {
    return this.layout.params
  }

  /**
   * Reset block states (for scroll restoration)
   */
  resetBlockStates() {
    const areas = this.getLayoutAreas()
    const allBlocks = [
      ...this.bodyBlocks,
      ...Object.values(areas).flat(),
    ]

    for (const block of allBlocks) {
      if (typeof block.initState === 'function') {
        block.initState()
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Navigation and Layout Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the navigation route (canonical route for links).
   * For index pages whose route ends in /index (e.g., /Articles/index),
   * returns the parent folder route (/Articles) so nav comparisons and
   * active-route highlighting work against the clean URL.
   * @returns {string}
   */
  getNavRoute() {
    if (this.isIndex && this.route.endsWith('/index')) {
      return this.route.slice(0, -'/index'.length) || '/'
    }
    return this.route
  }

  /**
   * Get display title for the page.
   * For index pages with no meaningful title (empty or the literal string "index"),
   * falls back to the parent folder's title so /Articles/index shows "Articles".
   * @returns {string}
   */
  getTitle() {
    if (this.isIndex && this.route.endsWith('/index')) {
      const own = this.title?.trim()
      if (!own || own.toLowerCase() === 'index') {
        return this.parent?.title || own || ''
      }
    }
    return this.title
  }

  /**
   * Get display label for navigation (short form of title)
   * @returns {string}
   */
  getLabel() {
    return this.label || this.getTitle()
  }

  /**
   * Check if page should be hidden from navigation
   * @returns {boolean}
   */
  isHidden() {
    return this.hidden
  }

  /**
   * Check if page should appear in a named nav area ('header', 'footer', or any
   * foundation-declared area). The general form behind showInHeader/showInFooter.
   * @param {string} area
   * @returns {boolean}
   */
  showInNav(area) {
    return !this.hidden && !this.hideIn.includes(area)
  }

  /**
   * Check if page should appear in header navigation
   * @returns {boolean}
   */
  showInHeader() {
    return this.showInNav('header')
  }

  /**
   * Check if page should appear in footer navigation
   * @returns {boolean}
   */
  showInFooter() {
    return this.showInNav('footer')
  }

  /**
   * Check if page has child pages
   * @returns {boolean}
   */
  hasChildren() {
    return this.children.length > 0
  }

  /**
   * Check if page has body content (sections).
   * Uses a build-time flag — always reflects whether the page has markdown,
   * regardless of whether section content has been loaded yet (split mode).
   * @returns {boolean}
   */
  hasContent() {
    return this._hasContent
  }

  /**
   * Check if section content has been loaded.
   * In non-split mode, always true (sections are always present).
   * In split mode, true for the pre-embedded current page and any page
   * whose content has been fetched via loadContent().
   * @returns {boolean}
   */
  isContentLoaded() {
    return this._bodySections !== undefined
  }

  /**
   * Fetch and store section content from the server.
   * Deduplicates concurrent calls (e.g., rapid navigation).
   * No-op if content is already loaded or embedded.
   * @returns {Promise<void>}
   */
  async loadContent() {
    if (this._bodySections !== undefined) return  // already loaded or embedded
    if (this._loadingContent) return this._loadingContent  // deduplicate

    this._loadingContent = (async () => {
      try {
        const base = this.website.basePath || ''
        const lang = this.website.activeLocale
        const defaultLang = this.website.defaultLocale

        // Phase 5 of the CDN migration: prefer the content-addressed URL from
        // __DATA__.config.pageHashes (the publish handler emits it). Falls
        // back to the legacy /{lang}/_pages/{route}.json shape when the map
        // isn't present (older sites that haven't republished yet).
        const hashes = this.website.config?.pageHashes
        const hashedUrl = hashes?.[lang]?.[this.route]

        let url
        if (hashedUrl) {
          url = `${base}${hashedUrl}`
        } else {
          const localePrefix = lang !== defaultLang ? `/${lang}` : ''
          const routePath = this.route === '/' ? '/index' : this.route
          url = `${base}${localePrefix}/_pages${routePath}.json`
        }

        const res = await fetch(url)
        if (res.status === 404 && _shouldReloadOnHashed404(hashedUrl)) {
          // Stale tab: this tab's __DATA__ map references a publish that
          // no longer exists in R2. One reload usually picks up the fresh
          // HTML (and a fresh map). Capped at 2 attempts to defend against
          // a malformed publish where new HTML and new R2 also disagree.
          window.location.reload()
          return
        }
        if (!res.ok) {
          console.warn(`[Page] Failed to load content for ${this.route}: ${res.status}`)
          this._bodySections = []  // Mark as loaded (empty) to prevent retries
          return
        }
        const data = await res.json()
        this._bodySections = data.sections || []
        this._bodyBlocks = null  // Reset lazy cache so getter rebuilds
        // Reset the reload counter on a successful fetch so future stale
        // tabs (across many publishes in one session) get fresh attempts.
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('uniwebReloadCount')
        }
      } finally {
        this._loadingContent = null
      }
    })()

    return this._loadingContent
  }

  // ─────────────────────────────────────────────────────────────────
  // Active Route Detection
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the first navigable route for this page.
   * If page has no content, recursively finds first child with content.
   * Useful for category pages that are just navigation containers.
   *
   * @returns {string} The route to navigate to
   *
   * @example
   * // For a "Docs" category page with no content but children:
   * // page.route = '/docs'
   * // page.hasContent() = false
   * // First child with content: '/docs/getting-started'
   * page.getNavigableRoute() // Returns '/docs/getting-started'
   */
  getNavigableRoute() {
    if (this.hasContent()) return this.route
    const children = this.children || []
    // Prefer the index child (designated landing page for this folder).
    // Return this folder's own route so the URL stays clean (/Articles, not /Articles/index).
    const indexChild = children.find((c) => c.isIndex)
    if (indexChild) return this.route
    // Fall back to first child with content
    for (const child of children) {
      const route = child.getNavigableRoute()
      if (route) return route
    }
    return this.route // Fallback to own route
  }

  /**
   * Resolve which Page should actually be rendered when this one is
   * requested. If the page has its own content, it renders itself. If
   * it's a content-less folder with a designated index child, that
   * child renders in its place. Otherwise, returns `this` so the caller
   * can decide what to do with an empty page (typically an empty
   * <main>, not a 404 — the route exists, it just has no body).
   *
   * Distinct from `getNavigableRoute()`, which recursively walks
   * descendants to find a navigation target. `getRenderableSelf()` only
   * looks one level down (to the immediate index child) — the contract
   * is "give me the page to render *here*," not "give me the next URL
   * with content."
   *
   * Used by SSR paths (Cloudflare Worker isolate today; framework SSG
   * pre-handles this differently via expandDynamicPages) to avoid
   * rendering nothing when an author requests `/docs` and the page is
   * a folder whose actual landing content lives in `/docs/intro` flagged
   * as `isIndex: true`.
   *
   * @returns {Page} The page to render — `this` or its index child.
   */
  getRenderableSelf() {
    if (this.hasContent()) return this
    const indexChild = this.children?.find((c) => c.isIndex)
    return indexChild || this
  }

  /**
   * Get route without leading/trailing slashes.
   * Delegates to Website.normalizeRoute() for consistent normalization.
   *
   * @returns {string} Normalized route (e.g., 'docs/getting-started')
   */
  getNormalizedRoute() {
    return this.website.normalizeRoute(this.route)
  }

  /**
   * Check if this page matches the given route exactly.
   * Delegates to Website.isRouteActive() for consistent comparison.
   *
   * @param {string} currentRoute - Current route to compare against
   * @returns {boolean} True if this page's route matches
   */
  isActiveFor(currentRoute) {
    return this.website.isRouteActive(this.route, currentRoute)
  }

  /**
   * Check if this page or any descendant matches the given route.
   * Useful for highlighting parent nav items when a child page is active.
   *
   * For index pages, uses sourcePath (original folder path) for ancestor checking
   * to avoid false positives. E.g., homepage at '/' shouldn't be ancestor of '/about'.
   *
   * @param {string} currentRoute - Current route to compare against
   * @returns {boolean} True if this page or a descendant is active
   *
   * @example
   * // Page route: '/docs' (index page with sourcePath: '/docs/intro')
   * // Current route: '/docs/api'
   * page.isActiveOrAncestor('/docs/api') // false (not under /docs/intro)
   */
  isActiveOrAncestor(currentRoute) {
    // Exact match on canonical route
    if (this.website.isRouteActive(this.route, currentRoute)) {
      return true
    }
    // Ancestor check uses sourcePath (folder-based path) to avoid false positives
    // For index pages, sourcePath differs from route
    const pathForAncestorCheck = this.sourcePath || this.route
    return this.website.isRouteActiveOrAncestor(pathForAncestorCheck, currentRoute)
  }

  // ─────────────────────────────────────────────────────────────────
  // Version API (for documentation pages)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if this page is within a versioned section
   * @returns {boolean}
   */
  isVersioned() {
    return this.version !== null
  }

  /**
   * Get the current version for this page
   * @returns {Object|null} Version info { id, label, latest, deprecated } or null
   */
  getVersion() {
    return this.version
  }

  /**
   * Get all available versions for this page's scope
   * @returns {Array} Array of version objects, or empty array
   */
  getVersions() {
    return this.versionMeta?.versions || []
  }

  /**
   * Check if this page is on the latest version
   * @returns {boolean}
   */
  isLatestVersion() {
    return this.version?.latest === true
  }

  /**
   * Check if this page is on a deprecated version
   * @returns {boolean}
   */
  isDeprecatedVersion() {
    return this.version?.deprecated === true
  }

  /**
   * Get URL for switching to a different version of this page
   * @param {string} targetVersion - Target version ID (e.g., 'v1')
   * @returns {string|null} Target URL or null if not versioned
   */
  getVersionUrl(targetVersion) {
    if (!this.isVersioned()) return null
    return this.website.getVersionUrl(targetVersion, this.route)
  }
}

/**
 * Helper for the stale-tab 404→reload guard in Page.loadContent.
 *
 * Phase 5 of the CDN migration writes content-addressed `_pages/...-{hash}.json`
 * files. Each publish wipes the prior hashes from R2 and writes fresh ones.
 * A browser tab loaded against a previous publish carries a stale __DATA__
 * map; on SPA navigation it'll request a hash that no longer exists.
 * Reloading the tab pulls fresh HTML (and a fresh map). The session-scoped
 * counter caps reloads at 2 so a malformed publish (where new HTML and new
 * R2 disagree) doesn't trigger an infinite loop — after 2 failed reloads
 * we render the synthetic 404 path instead.
 *
 * Only fires when the request was a hashed URL: legacy non-hashed 404s
 * keep the prior "mark empty, log warning" behavior (they're not symptomatic
 * of a stale-tab race; just a missing route).
 */
function _shouldReloadOnHashed404(hashedUrl) {
  if (!hashedUrl) return false
  if (typeof sessionStorage === 'undefined') return false
  if (typeof window === 'undefined' || !window.location) return false
  try {
    const count = parseInt(sessionStorage.getItem('uniwebReloadCount') || '0', 10) || 0
    if (count >= 2) return false
    sessionStorage.setItem('uniwebReloadCount', String(count + 1))
    return true
  } catch {
    return false
  }
}
