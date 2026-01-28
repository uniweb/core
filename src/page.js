/**
 * Page
 *
 * Represents a single page with header, body, footer, and panel sections.
 * Each layout area can have multiple sections/blocks.
 */

import Block from './block.js'

export default class Page {
  constructor(
    pageData,
    id,
    website,
    pageHeader,
    pageFooter,
    pageLeft,
    pageRight,
  ) {
    this.id = id
    this.stableId = pageData.id || null // Stable page ID for page: links (from page.yml)
    this.route = pageData.route
    this.sourcePath = pageData.sourcePath || null // Original folder-based path (for ancestor checking)
    this.isIndex = pageData.isIndex || false // True if this page is the index for its parent route
    this.title = pageData.title || ''
    this.description = pageData.description || ''
    this.label = pageData.label || null // Short label for navigation (null = use title)
    this.keywords = pageData.keywords || null
    this.lastModified = pageData.lastModified || null

    // Navigation visibility options
    this.hidden = pageData.hidden || false
    this.hideInHeader = pageData.hideInHeader || false
    this.hideInFooter = pageData.hideInFooter || false

    // Layout options (per-page overrides for header/footer/panels)
    this.layout = {
      header: pageData.layout?.header !== false,
      footer: pageData.layout?.footer !== false,
      leftPanel: pageData.layout?.leftPanel !== false,
      rightPanel: pageData.layout?.rightPanel !== false,
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

    // Child pages (for nested hierarchy) - populated by Website
    this.children = []

    // Back-reference to website
    this.website = website

    // Scroll position memory (for navigation restoration)
    this.scrollY = 0

    // Dynamic route context (for pages created from dynamic routes like /blog/:slug)
    this.dynamicContext = pageData.dynamicContext || null

    // Version context (for pages within versioned sections like /docs/v1/*)
    this.version = pageData.version || null // { id, label, latest, deprecated }
    this.versionMeta = pageData.versionMeta || null // { versions, latestId }
    this.versionScope = pageData.versionScope || null // The route where versioning starts

    // Build block groups for all layout areas
    this.pageBlocks = this.buildPageBlocks(
      pageData.sections,
      pageHeader?.sections,
      pageFooter?.sections,
      pageLeft?.sections,
      pageRight?.sections,
    )
  }

  /**
   * Get metadata for head tags
   * @returns {Object} Head metadata
   */
  getHeadMeta() {
    return {
      title: this.title,
      description: this.description,
      keywords: this.keywords,
      canonical: this.seo.canonical,
      robots: this.seo.noindex ? 'noindex, nofollow' : null,
      og: {
        title: this.seo.ogTitle || this.title,
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
   * Build the page block structure for all layout areas.
   * Each area can have multiple sections/blocks.
   *
   * @param {Array} body - Body sections from page content
   * @param {Array} header - Header sections from @header page
   * @param {Array} footer - Footer sections from @footer page
   * @param {Array} left - Left panel sections from @left page
   * @param {Array} right - Right panel sections from @right page
   * @returns {Object} Block groups for each layout area
   */
  buildPageBlocks(body, header, footer, left, right) {
    const buildBlocks = (sections, prefix) => {
      if (!sections || sections.length === 0) return null
      return sections.map((section, index) => {
        const block = new Block(section, `${prefix}-${index}`)
        this.initBlockReferences(block)
        return block
      })
    }

    const bodyBlocks = (body || []).map((section, index) => {
      const block = new Block(section, index)
      this.initBlockReferences(block)
      return block
    })

    return {
      header: buildBlocks(header, 'header'),
      body: bodyBlocks,
      footer: buildBlocks(footer, 'footer'),
      left: buildBlocks(left, 'left'),
      right: buildBlocks(right, 'right'),
    }
  }

  /**
   * Initialize block back-references to page and website.
   * Also recursively sets references for child blocks.
   *
   * @param {Block} block - The block to initialize
   */
  initBlockReferences(block) {
    block.page = this
    block.website = this.website

    // Recursively set references for child blocks
    if (block.childBlocks?.length) {
      for (const childBlock of block.childBlocks) {
        this.initBlockReferences(childBlock)
      }
    }
  }

  /**
   * Get all block groups (for Layout component)
   * @returns {Object} { header, body, footer, left, right }
   */
  getBlockGroups() {
    return this.pageBlocks
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
    const bodyBlocks = this.pageBlocks.body
    return bodyBlocks?.[0]?.getBlockInfo() || null
  }

  /**
   * Get all blocks (header, body, footer) as flat array
   * Respects page layout preferences (hasHeader, hasFooter, etc.)
   * @returns {Block[]}
   */
  getPageBlocks() {
    const blocks = []

    if (this.hasHeader() && this.pageBlocks.header) {
      blocks.push(...this.pageBlocks.header)
    }

    blocks.push(...this.pageBlocks.body)

    if (this.hasFooter() && this.pageBlocks.footer) {
      blocks.push(...this.pageBlocks.footer)
    }

    return blocks
  }

  /**
   * Get just body blocks
   * @returns {Block[]}
   */
  getBodyBlocks() {
    return this.pageBlocks.body
  }

  /**
   * Get header blocks (respects layout preference)
   * @returns {Block[]|null}
   */
  getHeaderBlocks() {
    if (!this.hasHeader()) return null
    return this.pageBlocks.header
  }

  /**
   * Get footer blocks (respects layout preference)
   * @returns {Block[]|null}
   */
  getFooterBlocks() {
    if (!this.hasFooter()) return null
    return this.pageBlocks.footer
  }

  /**
   * Get left panel blocks (respects layout preference)
   * @returns {Block[]|null}
   */
  getLeftBlocks() {
    if (!this.hasLeftPanel()) return null
    return this.pageBlocks.left
  }

  /**
   * Get right panel blocks (respects layout preference)
   * @returns {Block[]|null}
   */
  getRightBlocks() {
    if (!this.hasRightPanel()) return null
    return this.pageBlocks.right
  }

  /**
   * Get header block (legacy - returns first block)
   * @returns {Block|null}
   * @deprecated Use getHeaderBlocks() instead
   */
  getHeader() {
    return this.pageBlocks.header?.[0] || null
  }

  /**
   * Get footer block (legacy - returns first block)
   * @returns {Block|null}
   * @deprecated Use getFooterBlocks() instead
   */
  getFooter() {
    return this.pageBlocks.footer?.[0] || null
  }

  /**
   * Reset block states (for scroll restoration)
   */
  resetBlockStates() {
    const allBlocks = [
      ...(this.pageBlocks.header || []),
      ...this.pageBlocks.body,
      ...(this.pageBlocks.footer || []),
      ...(this.pageBlocks.left || []),
      ...(this.pageBlocks.right || []),
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
   * Get the navigation route (canonical route for links)
   * With the new routing model, route is already the canonical nav route.
   * Index pages have route set to parent route (e.g., '/' for homepage).
   * @returns {string}
   */
  getNavRoute() {
    return this.route
  }

  /**
   * Get display label for navigation (short form of title)
   * @returns {string}
   */
  getLabel() {
    return this.label || this.title
  }

  /**
   * Check if page should be hidden from navigation
   * @returns {boolean}
   */
  isHidden() {
    return this.hidden
  }

  /**
   * Check if page should appear in header navigation
   * @returns {boolean}
   */
  showInHeader() {
    return !this.hidden && !this.hideInHeader
  }

  /**
   * Check if page should appear in footer navigation
   * @returns {boolean}
   */
  showInFooter() {
    return !this.hidden && !this.hideInFooter
  }

  /**
   * Check if header should be rendered on this page
   * @returns {boolean}
   */
  hasHeader() {
    return this.layout.header
  }

  /**
   * Check if footer should be rendered on this page
   * @returns {boolean}
   */
  hasFooter() {
    return this.layout.footer
  }

  /**
   * Check if left panel should be rendered on this page
   * @returns {boolean}
   */
  hasLeftPanel() {
    return this.layout.leftPanel
  }

  /**
   * Check if right panel should be rendered on this page
   * @returns {boolean}
   */
  hasRightPanel() {
    return this.layout.rightPanel
  }

  /**
   * Check if page has child pages
   * @returns {boolean}
   */
  hasChildren() {
    return this.children.length > 0
  }

  /**
   * Check if page has body content (sections)
   * @returns {boolean}
   */
  hasContent() {
    return this.pageBlocks.body.length > 0
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
    for (const child of this.children || []) {
      const route = child.getNavigableRoute()
      if (route) return route
    }
    return this.route // Fallback to own route
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
