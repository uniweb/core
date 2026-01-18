/**
 * Page
 *
 * Represents a single page with header, body sections, and footer.
 */

import Block from './block.js'

export default class Page {
  constructor(pageData, id, pageHeader, pageFooter) {
    this.id = id
    this.route = pageData.route
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
      leftPanel: pageData.layout?.leftPanel !== false,
      rightPanel: pageData.layout?.rightPanel !== false
    }

    // SEO configuration
    this.seo = {
      noindex: pageData.seo?.noindex || false,
      image: pageData.seo?.image || null,
      ogTitle: pageData.seo?.ogTitle || null,
      ogDescription: pageData.seo?.ogDescription || null,
      canonical: pageData.seo?.canonical || null,
      changefreq: pageData.seo?.changefreq || null,
      priority: pageData.seo?.priority || null
    }

    // Child pages (for nested hierarchy) - populated by Website
    this.children = []

    // Back-reference to website (set by Website constructor)
    this.website = null
    this.site = null // Alias

    this.pageBlocks = this.buildPageBlocks(
      pageData.sections,
      pageHeader?.sections,
      pageFooter?.sections
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
        url: this.route
      }
    }
  }

  /**
   * Build the page block structure
   */
  buildPageBlocks(body, header, footer) {
    const headerSection = header?.[0]
    const footerSection = footer?.[0]
    const bodySections = body || []

    return {
      header: headerSection ? new Block(headerSection, 'header') : null,
      body: bodySections.map((section, index) => new Block(section, index)),
      footer: footerSection ? new Block(footerSection, 'footer') : null,
      leftPanel: null,
      rightPanel: null
    }
  }

  /**
   * Get all blocks (header, body, footer) as flat array
   * @returns {Block[]}
   */
  getPageBlocks() {
    return [
      this.pageBlocks.header,
      ...this.pageBlocks.body,
      this.pageBlocks.footer
    ].filter(Boolean)
  }

  /**
   * Get just body blocks
   * @returns {Block[]}
   */
  getBodyBlocks() {
    return this.pageBlocks.body
  }

  /**
   * Get header block
   * @returns {Block|null}
   */
  getHeader() {
    return this.pageBlocks.header
  }

  /**
   * Get footer block
   * @returns {Block|null}
   */
  getFooter() {
    return this.pageBlocks.footer
  }

  // ─────────────────────────────────────────────────────────────────
  // Navigation and Layout Helpers
  // ─────────────────────────────────────────────────────────────────

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
}
