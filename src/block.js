/**
 * Block
 *
 * Represents a section/block on a page. Contains content, properties,
 * child blocks, and state management. Connects to foundation components.
 */

import { parseContent as parseSemanticContent } from '@uniweb/semantic-parser'

/**
 * Resolve bare palette references to var() in theme overrides.
 * Allows content authors to write `primary: neutral-900` in frontmatter
 * instead of `primary: var(--neutral-900)`.
 */
const SHADE_LEVELS = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])

function resolveOverrideValue(value) {
  if (typeof value !== 'string' || value.includes('(') || value.startsWith('#')) return value
  const bare = value.replace(/^-{0,2}/, '')
  const match = bare.match(/^([a-z][a-z0-9]*)-(\d+)$/)
  if (match && SHADE_LEVELS.has(parseInt(match[2], 10))) return `var(--${bare})`
  return value
}

export default class Block {
  constructor(blockData, id, page) {
    this.id = id
    this.stableId = blockData.stableId || null // Stable section ID for scroll targeting (from filename or frontmatter)
    this.page = page
    this.website = page.website
    this.type = blockData.type || this.website.getDefaultBlockType()
    this.Component = null

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
    // parsedContent now has: title, pretitle, paragraphs, links, images, items, etc.
    this.items = this.parsedContent.items || []

    // Block configuration
    const blockConfig = blockData.params || blockData.config || {}
    this.preset = blockData.preset

    // Normalize theme: supports string ("light") or object ({ mode, ...tokenOverrides })
    // Resolve bare palette refs (e.g. "primary: neutral-900" → var(--neutral-900))
    const rawTheme = blockConfig.theme
    if (rawTheme && typeof rawTheme === 'object') {
      const { mode, ...overrides } = rawTheme
      this.themeName = mode || 'light'
      if (Object.keys(overrides).length > 0) {
        for (const key of Object.keys(overrides)) {
          overrides[key] = resolveOverrideValue(overrides[key])
        }
        this.contextOverrides = overrides
      } else {
        this.contextOverrides = null
      }
    } else {
      this.themeName = rawTheme || 'light'
      this.contextOverrides = null
    }

    this.standardOptions = blockConfig.standardOptions || {}
    this.properties = blockConfig.properties || blockConfig

    // Normalize params.theme to string so components always see "light"/"dark"/"medium",
    // not the raw object. Done after properties assignment to avoid mutating source data.
    if (this.properties.theme && typeof this.properties.theme === 'object') {
      this.properties = { ...this.properties, theme: this.themeName }
    }

    // Extract background from params into standardOptions
    // Content authors set background in section frontmatter; the runtime
    // reads it from standardOptions to render the Background component.
    const rawBg = blockConfig.background
    if (rawBg && !this.standardOptions.background) {
      this.standardOptions = {
        ...this.standardOptions,
        background: Block.normalizeBackground(rawBg)
      }
    }

    // Child blocks (subsections)
    this.childBlocks = blockData.subsections
      ? blockData.subsections.map((block, i) => new Block(block, `${id}_${i}`, this.page))
      : []

    // Insets — inline @-referenced components positioned in content flow
    this.insets = []
    const insetData = blockData.insets
    if (insetData?.length > 0) {
      for (let i = 0; i < insetData.length; i++) {
        const ref = insetData[i]
        const title = ref.title || ''
        const child = new Block(
          {
            type: ref.type,
            params: ref.params || {},
            content: { title },
            stableId: ref.refId,
          },
          `${id}_inset_${i}`,
          this.page
        )
        child.inline = true
        child.refId = ref.refId
        this.insets.push(child)
      }
    }

    // Fetch configuration (from section frontmatter)
    // Supports local files (path) or remote URLs (url)
    this.fetch = blockData.fetch || null

    // Data loading state — set by BlockRenderer when a runtime fetch is in progress
    // Components check this to show loading UI (spinners, skeletons)
    this.dataLoading = false

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
   * 3. Plain object (passed through directly)
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

    // Plain object content — pass through directly.
    // guaranteeContentStructure() in prepare-props will fill in missing fields.
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      return content
    }

    // Fallback — empty flat structure
    return {
      title: '',
      paragraphs: [],
      items: [],
      sequence: []
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
      images: [],
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
      description: c.headings?.[0] || '',
      paragraphs: c.paragraphs || [],
      images: c.images || [],
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
   * Get an inset block by its refId
   * @param {string} refId - The reference ID (e.g., 'inset_0')
   * @returns {Block|null}
   */
  getInset(refId) {
    return this.insets.find(c => c.refId === refId) || null
  }


  /**
   * Get child block renderer from runtime.
   * @deprecated Use `ChildBlocks` from `@uniweb/kit` instead.
   */
  getChildBlockRenderer() {
    return globalThis.uniweb.childBlockRenderer
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
      contextOverrides: this.contextOverrides,
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
   * Normalize a background value from section frontmatter
   *
   * Accepts:
   * - String URL: "/images/hero.jpg" → { mode: 'image', image: { src } }
   * - String URL (video): "/videos/bg.mp4" → { mode: 'video', video: { src } }
   * - Object with mode: passed through as-is
   * - Object without mode: mode inferred from which fields are present
   *
   * @param {string|Object} raw - Raw background value from frontmatter
   * @returns {Object} Normalized background config with mode
   */
  static normalizeBackground(raw) {
    // String shorthand — classify by content
    if (typeof raw === 'string') {
      // URL or path → image/video
      if (/^(\/|\.\/|\.\.\/|https?:\/\/)/.test(raw) || /\.(jpe?g|png|webp|gif|svg|avif|mp4|webm|ogv|ogg)$/i.test(raw)) {
        const ext = raw.split('.').pop()?.toLowerCase()
        const isVideo = ['mp4', 'webm', 'ogv', 'ogg'].includes(ext)
        if (isVideo) return { mode: 'video', video: { src: raw } }
        return { mode: 'image', image: { src: raw } }
      }

      // CSS gradient function
      if (/^(linear|radial|conic)-gradient\(/.test(raw)) {
        return { mode: 'gradient', gradient: raw }
      }

      // Anything else → CSS color (hex, rgb, hsl, oklch, named color, var())
      // Resolve bare palette refs (e.g. "primary-900" → "var(--primary-900)")
      return { mode: 'color', color: resolveOverrideValue(raw) }
    }

    // Object with explicit mode — pass through
    if (raw.mode) return raw

    // Normalize overlay shorthand: number → { enabled: true, type: 'dark', opacity }
    if (typeof raw.overlay === 'number') {
      raw = { ...raw, overlay: { enabled: true, type: 'dark', opacity: raw.overlay } }
    }

    // Infer mode from fields
    if (raw.video || raw.sources) return { mode: 'video', ...raw }
    if (raw.image || raw.src) {
      // Support flat { src, position, size } shorthand
      if (raw.src) {
        const { src, position, size, lazy, ...rest } = raw
        return { mode: 'image', image: { src, position, size, lazy }, ...rest }
      }
      // Support string shorthand: { image: "url" } → { image: { src: "url" } }
      if (typeof raw.image === 'string') {
        const { image, ...rest } = raw
        return { mode: 'image', image: { src: image }, ...rest }
      }
      return { mode: 'image', ...raw }
    }
    if (raw.gradient) return { mode: 'gradient', ...raw }
    if (raw.color) return { mode: 'color', ...raw }

    // Can't infer — return as-is (BlockRenderer checks for mode)
    return raw
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
