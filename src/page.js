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

    this.pageBlocks = this.buildPageBlocks(
      pageData.sections,
      pageHeader?.sections,
      pageFooter?.sections
    )
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
}
