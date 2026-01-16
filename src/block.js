/**
 * Block
 *
 * Represents a section/block on a page. Contains content, properties,
 * child blocks, and state management. Connects to foundation components.
 */

import { parseContent as parseSemanticContent } from '@uniweb/semantic-parser'

export default class Block {
  constructor(blockData, id) {
    this.id = id
    this.component = blockData.component || 'Section'
    this.Component = null

    // Content structure
    // The content can be:
    // 1. Raw ProseMirror content (from content collection)
    // 2. Pre-parsed content with main/items structure
    // For now, store raw and parse on demand
    this.rawContent = blockData.content || {}
    this.parsedContent = this.parseContent(blockData.content)

    const { main, items } = this.parsedContent
    this.main = main
    this.items = items

    // Block configuration
    const blockConfig = blockData.params || blockData.config || {}
    this.preset = blockData.preset
    this.themeName = `context__${blockConfig.theme || 'light'}`
    this.standardOptions = blockConfig.standardOptions || {}
    this.properties = blockConfig.properties || blockConfig

    // Child blocks (subsections)
    this.childBlocks = blockData.subsections
      ? blockData.subsections.map((block, i) => new Block(block, `${id}_${i}`))
      : []

    // Input data
    this.input = blockData.input || null

    // State management
    this.startState = null
    this.state = null
    this.resetStateHook = null
  }

  /**
   * Parse content into structured format using semantic-parser
   * Supports multiple content formats:
   * 1. Pre-parsed groups structure (from editor)
   * 2. ProseMirror document (from markdown collection)
   * 3. Simple key-value content (PoC style)
   *
   * Uses @uniweb/semantic-parser for rich content extraction including:
   * - Pretitle detection (H3 before H1)
   * - Banner/background image detection
   * - Semantic grouping (main + items)
   * - Lists, links, buttons, etc.
   */
  parseContent(content) {
    // If content is already parsed with groups structure
    if (content?.groups) {
      return content.groups
    }

    // ProseMirror document - use semantic-parser
    if (content?.type === 'doc') {
      return this.extractFromProseMirror(content)
    }

    // Simple key-value content (PoC style) - pass through directly
    // This allows components to receive content like { title, subtitle, items }
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      return {
        main: { header: {}, body: {} },
        items: [],
        // Store raw content for direct access
        raw: content
      }
    }

    // Fallback
    return {
      main: { header: {}, body: {} },
      items: []
    }
  }

  /**
   * Extract structured content from ProseMirror document
   * Uses @uniweb/semantic-parser for intelligent content extraction
   */
  extractFromProseMirror(doc) {
    try {
      // Parse with semantic-parser
      const { groups, sequence, byType } = parseSemanticContent(doc)

      // Transform groups structure to match expected format
      const main = groups.main || { header: {}, body: {} }
      const items = groups.items || []

      return {
        main,
        items,
        // Include additional data for advanced use cases
        sequence,
        byType,
        metadata: groups.metadata
      }
    } catch (err) {
      console.warn('[Block] Semantic parser error, using fallback:', err.message)
      return this.extractFromProseMirrorFallback(doc)
    }
  }

  /**
   * Fallback extraction when semantic-parser fails
   */
  extractFromProseMirrorFallback(doc) {
    const main = { header: {}, body: {} }
    const items = []

    if (!doc.content) return { main, items }

    for (const node of doc.content) {
      if (node.type === 'heading') {
        const text = this.extractText(node)
        if (node.attrs?.level === 1) {
          main.header.title = text
        } else if (node.attrs?.level === 2) {
          main.header.subtitle = text
        }
      } else if (node.type === 'paragraph') {
        const text = this.extractText(node)
        if (!main.body.paragraphs) main.body.paragraphs = []
        main.body.paragraphs.push(text)
      }
    }

    return { main, items }
  }

  /**
   * Extract text from a node
   */
  extractText(node) {
    if (!node.content) return ''
    return node.content
      .filter((n) => n.type === 'text')
      .map((n) => n.text)
      .join('')
  }

  /**
   * Initialize the component from the foundation
   * @returns {React.ComponentType|null}
   */
  initComponent() {
    if (this.Component) return this.Component

    this.Component = globalThis.uniweb?.getComponent(this.component)

    if (!this.Component) {
      console.warn(`[Block] Component not found: ${this.component}`)
      return null
    }

    // Initialize state from component defaults
    const defaults = this.Component.blockDefaults || { state: this.Component.blockState }
    this.startState = defaults.state ? { ...defaults.state } : null
    this.initState()

    return this.Component
  }

  /**
   * Get structured block content for components
   */
  getBlockContent() {
    const mainHeader = this.main?.header || {}
    const mainBody = this.main?.body || {}
    const banner = this.main?.banner || null

    return {
      banner,
      pretitle: mainHeader.pretitle || '',
      title: mainHeader.title || '',
      subtitle: mainHeader.subtitle || '',
      description: mainHeader.description || '',
      paragraphs: mainBody.paragraphs || [],
      images: mainBody.imgs || mainBody.images || [],
      links: mainBody.links || [],
      icons: mainBody.icons || [],
      properties: mainBody.propertyBlocks?.[0] || {},
      videos: mainBody.videos || [],
      lists: mainBody.lists || [],
      buttons: mainBody.buttons || []
    }
  }

  /**
   * Get block properties
   */
  getBlockProperties() {
    return this.properties
  }

  /**
   * Get child block renderer from runtime
   */
  getChildBlockRenderer() {
    return globalThis.uniweb?.childBlockRenderer
  }

  /**
   * Get links from block content
   * @param {Object} options
   * @returns {Array}
   */
  getBlockLinks(options = {}) {
    const website = globalThis.uniweb?.activeWebsite

    if (options.nested) {
      const lists = this.main?.body?.lists || []
      const links = lists[0]
      return Block.parseNestedLinks(links, website)
    }

    const links = this.main?.body?.links || []
    return links.map((link) => ({
      route: website?.makeHref(link.href) || link.href,
      label: link.label
    }))
  }

  /**
   * Initialize block state
   */
  initState() {
    this.state = this.startState
    if (this.resetStateHook) this.resetStateHook()
  }

  /**
   * React hook for block state management
   * @param {Function} useState - React useState hook
   * @param {any} initState - Initial state
   * @returns {[any, Function]}
   */
  useBlockState(useState, initState) {
    if (initState !== undefined && this.startState === null) {
      this.startState = initState
      this.state = initState
    } else {
      initState = this.startState
    }

    const [state, setState] = useState(initState)

    this.resetStateHook = () => setState(initState)

    return [state, (newState) => setState((this.state = newState))]
  }

  /**
   * Parse nested links structure
   */
  static parseNestedLinks(list, website) {
    const parsed = []

    if (!list?.length) return parsed

    for (const listItem of list) {
      const { links = [], lists = [], paragraphs = [] } = listItem

      const link = links[0]
      const nestedList = lists[0]
      const text = paragraphs[0]

      let label = ''
      let href = ''
      let subLinks = []
      let hasData = true

      if (link) {
        label = link.label
        href = link.href
        if (nestedList) {
          subLinks = Block.parseNestedLinks(nestedList, website)
        }
      } else {
        label = text
        hasData = false
        if (nestedList) {
          subLinks = Block.parseNestedLinks(nestedList, website)
        }
      }

      parsed.push({
        label,
        route: website?.makeHref(href) || href,
        child_items: subLinks,
        hasData
      })
    }

    return parsed
  }
}
