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
    this.route = pageData.route
    this.isIndex = pageData.isIndex || false // True if this page is the index for its parent route
    this.title = pageData.title || ''
    this.description = pageData.description || ''
    this.label = pageData.label || null // Short label for navigation (null = use title)
    this.keywords = pageData.keywords || null
    this.order = pageData.order ?? 0
    this.lastModified = pageData.lastModified || null

    // Navigation visibility options
    this.hidden = pageData.hidden || false
    this.hideInHeader = pageData.hideInHeader || false
    this.hideInFooter = pageData.hideInFooter || false

    // Layout options (per-page overrides for header/footer/panels)
    this.layout = {
      header: pageData.layout?.header !== false,
      footer: pageData.layout?.footer !== false,
      left: pageData.layout?.left !== false,
      right: pageData.layout?.right !== false,
      // Aliases for backwards compatibility
      leftPanel: pageData.layout?.left !== false,
      rightPanel: pageData.layout?.right !== false,
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
   * For index pages, returns the parent route (e.g., '/' for homepage)
   * For regular pages, returns the actual route
   * @returns {string}
   */
  getNavRoute() {
    if (!this.isIndex) {
      return this.route
    }
    // Index page - compute parent route
    // /home -> /
    // /docs/getting-started -> /docs
    const segments = this.route.split('/').filter(Boolean)
    if (segments.length <= 1) {
      return '/'
    }
    return '/' + segments.slice(0, -1).join('/')
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
    return this.website?.normalizeRoute(this.route) || ''
  }

  /**
   * Check if this page matches the given route exactly.
   * Delegates to Website.isRouteActive() for consistent comparison.
   *
   * @param {string} currentRoute - Current route to compare against
   * @returns {boolean} True if this page's route matches
   */
  isActiveFor(currentRoute) {
    return this.website?.isRouteActive(this.route, currentRoute) || false
  }

  /**
   * Check if this page or any descendant matches the given route.
   * Useful for highlighting parent nav items when a child page is active.
   * Delegates to Website.isRouteActiveOrAncestor() for consistent logic.
   *
   * @param {string} currentRoute - Current route to compare against
   * @returns {boolean} True if this page or a descendant is active
   *
   * @example
   * // Page route: '/docs'
   * // Current route: 'docs/getting-started/installation'
   * page.isActiveOrAncestor('docs/getting-started/installation') // true
   */
  isActiveOrAncestor(currentRoute) {
    return this.website?.isRouteActiveOrAncestor(this.route, currentRoute) || false
  }
}
