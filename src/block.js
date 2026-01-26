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
    this.stableId = blockData.stableId || null // Stable section ID for scroll targeting (from filename or frontmatter)
    // 'type' matches frontmatter convention; 'component' supported for backwards compatibility
    this.type = blockData.type || blockData.component || 'Section'
    this.Component = null

    // Back-references (set by Page when creating blocks)
    this.page = null
    this.website = null

    // Content structure
    // The content can be:
    // 1. Raw ProseMirror content (from content collection)
    // 2. Pre-parsed content with main/items structure
    // For now, store raw and parse on demand
    this.rawContent = blockData.content || {}
    this.parsedContent = this.parseContent(blockData.content)

    // Merge fetched data from prerender (if present)
    // Prerender stores fetched data in blockData.parsedContent.data
    if (blockData.parsedContent?.data) {
      this.parsedContent.data = {
        ...(this.parsedContent.data || {}),
        ...blockData.parsedContent.data,
      }
    }

    // Flat content structure - no more nested main/items
    // parsedContent now has: title, pretitle, paragraphs, links, imgs, items, etc.
    this.items = this.parsedContent.items || []

    // Block configuration
    const blockConfig = blockData.params || blockData.config || {}
    this.preset = blockData.preset
    this.themeName = blockConfig.theme || 'light'
    this.standardOptions = blockConfig.standardOptions || {}
    this.properties = blockConfig.properties || blockConfig

    // Child blocks (subsections)
    this.childBlocks = blockData.subsections
      ? blockData.subsections.map((block, i) => new Block(block, `${id}_${i}`))
      : []

    // Input data
    this.input = blockData.input || null

    // Fetch configuration (from section frontmatter)
    // Supports local files (path) or remote URLs (url)
    this.fetch = blockData.fetch || null

    // Cascaded data from page/site level fetches
    // Populated during render for components with inheritData
    this.cascadedData = blockData.cascadedData || {}

    // Dynamic route context (params from URL matching)
    // Set when accessing a dynamic page like /blog/:slug -> /blog/my-post
    this.dynamicContext = blockData.dynamicContext || null

    // State management (dynamic, can change at runtime)
    this.startState = null
    this.state = null
    this.resetStateHook = null

    // Context (static, defined per component type)
    this.context = null
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
      // Mark as PoC format so runtime can detect and pass through
      return {
        _isPoc: true,
        _pocContent: content
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
   * Returns flat content structure
   */
  extractFromProseMirror(doc) {
    try {
      // Parse with semantic-parser - returns flat structure
      const parsed = parseSemanticContent(doc)

      // Parsed content is now flat: { title, pretitle, paragraphs, links, items, sequence, ... }
      return parsed
    } catch (err) {
      console.warn('[Block] Semantic parser error, using fallback:', err.message)
      return this.extractFromProseMirrorFallback(doc)
    }
  }

  /**
   * Fallback extraction when semantic-parser fails
   * Returns flat content structure matching new parser output
   */
  extractFromProseMirrorFallback(doc) {
    const content = {
      title: '',
      pretitle: '',
      subtitle: '',
      paragraphs: [],
      links: [],
      imgs: [],
      lists: [],
      icons: [],
      items: [],
      sequence: []
    }

    if (!doc.content) return content

    for (const node of doc.content) {
      if (node.type === 'heading') {
        const text = this.extractText(node)
        if (node.attrs?.level === 1) {
          content.title = text
        } else if (node.attrs?.level === 2) {
          content.subtitle = text
        }
      } else if (node.type === 'paragraph') {
        const text = this.extractText(node)
        content.paragraphs.push(text)
      }
    }

    return content
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

    this.Component = globalThis.uniweb?.getComponent(this.type)

    if (!this.Component) {
      console.warn(`[Block] Component not found: ${this.type}`)
      return null
    }

    // Get runtime metadata for this component (from meta.js, extracted at build time)
    const meta = globalThis.uniweb?.getComponentMeta(this.type) || {}

    // Initialize state (dynamic, can change at runtime)
    // Source: meta.js initialState field
    const stateDefaults = meta.initialState
    this.startState = stateDefaults ? { ...stateDefaults } : null
    this.initState()

    // Initialize context (static, per component type)
    // Source: meta.js context field
    this.context = meta.context ? { ...meta.context } : null

    return this.Component
  }

  /**
   * Get structured block content for components
   * Returns flat content structure
   */
  getBlockContent() {
    const c = this.parsedContent || {}

    return {
      pretitle: c.pretitle || '',
      title: c.title || '',
      subtitle: c.subtitle || '',
      description: c.subtitle2 || '',
      paragraphs: c.paragraphs || [],
      images: c.imgs || [],
      links: c.links || [],
      icons: c.icons || [],
      properties: c.propertyBlocks?.[0] || c.properties || {},
      videos: c.videos || [],
      lists: c.lists || [],
      buttons: c.buttons || [],
      items: c.items || [],
      data: c.data || {}
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
    const c = this.parsedContent || {}

    if (options.nested) {
      const lists = c.lists || []
      const links = lists[0]
      return Block.parseNestedLinks(links, website)
    }

    const links = c.links || []
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

  // ─────────────────────────────────────────────────────────────────
  // Cross-Block Communication
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get this block's index within its page.
   * Useful for finding neighboring blocks.
   *
   * @returns {number} The index, or -1 if not found
   */
  getIndex() {
    if (!this.page) return -1
    return this.page.getBlockIndex(this)
  }

  /**
   * Get information about this block for cross-component communication.
   * Other components (like NavBar) can use this to adapt their behavior.
   *
   * @returns {Object} Block info: { type, theme, state, context }
   */
  getBlockInfo() {
    return {
      type: this.type,
      theme: this.themeName,
      state: this.state,
      context: this.context
    }
  }

  /**
   * Get information about the next block in the page.
   * Commonly used by headers/navbars to adapt to the first content section.
   *
   * @returns {Object|null} Next block's info or null
   */
  getNextBlockInfo() {
    const index = this.getIndex()
    if (index < 0 || !this.page) return null
    return this.page.getBlockInfo(index + 1)
  }

  /**
   * Get information about the previous block in the page.
   *
   * @returns {Object|null} Previous block's info or null
   */
  getPrevBlockInfo() {
    const index = this.getIndex()
    if (index <= 0 || !this.page) return null
    return this.page.getBlockInfo(index - 1)
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

  // ─────────────────────────────────────────────────────────────────
  // Dynamic Route Data Resolution
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get dynamic route context (params from URL matching)
   * @returns {Object|null} Dynamic context with params, or null if not a dynamic page
   *
   * @example
   * // For route /blog/:slug matched against /blog/my-post
   * block.getDynamicContext()
   * // { templateRoute: '/blog/:slug', params: { slug: 'my-post' }, paramName: 'slug', paramValue: 'my-post' }
   */
  getDynamicContext() {
    return this.dynamicContext
  }

  /**
   * Get the current item from cascaded data using dynamic route params
   * Looks up the item in cascadedData that matches the URL param value
   *
   * @param {string} [schema] - Schema name to look up (e.g., 'articles'). If omitted, uses parentSchema from dynamicContext.
   * @returns {Object|null} The matched item, or null if not found
   *
   * @example
   * // URL: /blog/my-post, cascadedData: { articles: [{slug: 'my-post', title: 'My Post'}, ...] }
   * block.getCurrentItem('articles')
   * // { slug: 'my-post', title: 'My Post', ... }
   */
  getCurrentItem(schema) {
    const ctx = this.dynamicContext
    if (!ctx) return null

    const { paramName, paramValue } = ctx

    // If schema not provided, try to infer from cascadedData keys
    const lookupSchema = schema || this._inferSchema()
    if (!lookupSchema) return null

    const items = this.cascadedData[lookupSchema]
    if (!Array.isArray(items)) return null

    // Find item where the param field matches the URL value
    return items.find(item => String(item[paramName]) === String(paramValue)) || null
  }

  /**
   * Get all items from cascaded data for the dynamic route's schema
   *
   * @param {string} [schema] - Schema name to look up. If omitted, uses parentSchema from dynamicContext.
   * @returns {Array} Array of items, or empty array if not found
   */
  getAllItems(schema) {
    const lookupSchema = schema || this._inferSchema()
    if (!lookupSchema) return []

    const items = this.cascadedData[lookupSchema]
    return Array.isArray(items) ? items : []
  }

  /**
   * Infer the schema name from cascaded data keys
   * Looks for the first array in cascadedData
   * @private
   */
  _inferSchema() {
    for (const key of Object.keys(this.cascadedData)) {
      if (Array.isArray(this.cascadedData[key])) {
        return key
      }
    }
    return null
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
