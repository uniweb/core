/**
 * Block
 *
 * Represents a section/block on a page. Contains content, properties,
 * child blocks, and state management. Connects to foundation components.
 */

import {
  parseContent as parseSemanticContent,
  resolveAssetUrl
} from '@uniweb/semantic-parser'
import { normalizeTokenValue } from '@uniweb/theming'
import { sectionDomId } from './section-id.js'

/**
 * Lift container fences out of a content document.
 *
 * A ` ```@Component{params} ` fence parses to an `inset_block` node carrying a
 * body of real block content. This rewrites each one to the `inset_placeholder`
 * a leaf inset leaves behind, so a container resolves through exactly the same
 * path: `getInset(refId)` → a Block → the foundation's component. Kit and the
 * SSR renderer already handle placeholders, so neither needs to know containers
 * exist.
 *
 * PURE with respect to the input. `blockData.content` is shared with the sync /
 * pull machinery, which must keep seeing `inset_block` — that is the canonical
 * stored shape. Nodes on the path to a container are cloned; everything else is
 * passed through by reference, so a document with no containers costs one array
 * walk and allocates nothing.
 *
 * Containers are NOT recursed into here. A container's body becomes its child
 * Block's content, and that Block's constructor lifts its own containers — so
 * nesting resolves one level at a time, each at the level that owns it.
 *
 * @param {Object} content - ProseMirror document (never mutated)
 * @returns {{ content: Object, refs: Array<{refId, type, params, content}> }}
 */
function liftContainers(content) {
  if (!content || !Array.isArray(content.content)) return { content, refs: [] }

  const refs = []

  const visit = (nodes) => {
    let changed = false
    const out = nodes.map((node) => {
      if (!node) return node

      if (node.type === 'inset_block') {
        const { component, ...params } = node.attrs || {}
        const refId = `container_${refs.length}`
        refs.push({
          refId,
          type: component,
          params,
          content: { type: 'doc', content: node.content || [] },
        })
        changed = true
        return { type: 'inset_placeholder', attrs: { refId, embedKind: 'block' } }
      }

      if (Array.isArray(node.content)) {
        const inner = visit(node.content)
        if (inner !== node.content) {
          changed = true
          return { ...node, content: inner }
        }
      }
      return node
    })
    return changed ? out : nodes
  }

  const next = visit(content.content)
  return next === content.content
    ? { content, refs }
    : { content: { ...content, content: next }, refs }
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
    // 1. Raw ProseMirror content (from a record)
    // 2. Pre-parsed content with main/items structure
    // For now, store raw and parse on demand
    //
    // Container fences (```@Component around a body) arrive as `inset_block`
    // nodes and are lifted out HERE, into the same placeholder + refId shape
    // the build gives leaf insets. Doing it at render-graph construction
    // rather than at build time is deliberate: `inset_block` is the canonical
    // STORED shape, so the content that syncs and round-trips must keep
    // carrying it. `blockData.content` is left untouched — the lift produces a
    // new tree and only this Block's view of it changes.
    const lifted = liftContainers(blockData.content)
    this.rawContent = lifted.content || {}
    this.parsedContent = this.parseContent(lifted.content)

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
    //
    // themeName values:
    //   '' (empty) = Auto — section inherits from site's appearance/scheme
    //   'light'    = Pinned to light context
    //   'medium'   = Pinned to dim context
    //   'dark'     = Pinned to dark context
    const rawTheme = blockConfig.theme
    if (rawTheme && typeof rawTheme === 'object') {
      const { mode, ...overrides } = rawTheme
      this.themeName = mode || ''
      if (Object.keys(overrides).length > 0) {
        for (const key of Object.keys(overrides)) {
          overrides[key] = normalizeTokenValue(overrides[key])
        }
        this.contextOverrides = overrides
      } else {
        this.contextOverrides = null
      }
    } else {
      this.themeName = rawTheme ?? ''
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
        background: Block.normalizeBackground(rawBg, this.parseOptions())
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
            refId: ref.refId,
          },
          `${id}_inset_${i}`,
          this.page
        )
        this.insets.push(child)
      }
    }

    // Containers, appended AFTER the leaf insets so `block.insets[0]` keeps
    // meaning what it meant to every foundation already using <Visual>.
    // Unlike a leaf inset, a container's body becomes the child Block's
    // content, so the foundation's component receives a fully parsed
    // `content` — title, paragraphs, items, sequence — exactly as a section
    // does. Nested containers resolve for free: the child Block runs this
    // same constructor over its own body.
    for (let i = 0; i < lifted.refs.length; i++) {
      const ref = lifted.refs[i]
      this.insets.push(
        new Block(
          {
            type: ref.type,
            params: ref.params || {},
            content: ref.content,
            stableId: ref.refId,
            refId: ref.refId,
          },
          `${id}_container_${i}`,
          this.page
        )
      )
    }

    // Fetch configuration (from section frontmatter)
    // Supports local files (path) or remote URLs (url)
    this.fetch = blockData.fetch || null

    // Data loading state — set by BlockRenderer when a runtime fetch is in progress
    // Components check this to show loading UI (spinners, skeletons)
    this.dataLoading = false

    // Data failure state — set by BlockRenderer when a runtime fetch FAILED:
    // `{ <binding key>: <message> }`, or null. A failed key is absent from
    // `content.data` (never `[]`, which is a delivered value), so this is the
    // only way a component can tell "no records" from "the request failed".
    this.dataError = null

    // Whether engine-level background is active (set by BlockRenderer/prerender)
    // Components check this to skip their own opaque background
    this.hasBackground = false

    // Inset identity — set on inset blocks for lookup via getInset()
    this.refId = blockData.refId || null

    // Dynamic route context (params from URL matching)
    // Set when accessing a dynamic page like /blog/:slug -> /blog/my-post.
    // ⭐ The PAGE's context is the fallback: the SPA stamps it on every section
    // as it creates the page, the static build stamps it on the page only, and a
    // section reading `block.dynamicContext` must see the same thing on both
    // lanes — it did not until 2026-09-04 (empty on every prerendered page).
    this.dynamicContext = blockData.dynamicContext || this.page?.dynamicContext || null

    // State management (dynamic, can change at runtime)
    this.startState = null
    this.state = null
    this.resetStateHook = null

    // Context (static, defined per component type)
    this.context = null

    // Component-level CSS variables (merged meta.js defaults + frontmatter overrides)
    // Populated by initComponent() — context-independent, emitted on #section-{id}
    this.componentVars = null

    Object.seal(this)
  }

  /**
   * The resolved URL path of the current page (e.g. /blog or /blog/1).
   * Use this to build child links: `${block.path}/${item.id}`
   *
   * Uses page.getNavRoute() which returns the path with its leading slash intact
   * and normalizes /index suffixes to the folder route. getNormalizedRoute() is
   * intentionally NOT used here — it strips the leading slash (designed for route
   * comparison), which would produce relative paths and cause double-segment URLs.
   *
   * Works in all scenarios:
   * - Static pages: page.route (/blog)
   * - Dynamic pages: concrete route (/blog/1), set by _createDynamicPage
   * - Editor: set by the editor to the page being previewed
   * - SSR/prerender: set from page data at build time
   */
  get path() {
    return this.page.getNavRoute()
  }

  /**
   * Unique key for this block across all pages.
   * Combines the page route with the block's positional id.
   * Use as a React key when cross-page uniqueness matters.
   */
  get key() {
    return `${this.path}-${this.id}`
  }

  /**
   * Report an event from this section — a video milestone, a download, an
   * expand, anything the foundation considers worth counting.
   *
   * ```js
   * block.track('video_milestone', { milestone: 50 })
   * ```
   *
   * The section type and the page path are attached automatically, because a
   * block already knows both — a foundation should not have to thread context
   * it was handed. Same arrangement as `useFormSubmit({ block })`.
   *
   * ## ⭐ `section` and `section_id` answer DIFFERENT questions — both ride
   *
   * `section` is the component **type** (`Hero`); `section_id` is this
   * **instance** (`section-hero`), the same string the renderers write as the
   * DOM id, so it joins to the anchor a search result already links to.
   *
   * | | cardinality to a collector | survives a foundation swap | survives a content rename |
   * |---|---|---|---|
   * | `section` (type) | the foundation's vocabulary — bounded, small | ⛔ no | ✅ yes |
   * | `section_id` (instance) | pages × sections — needs scoping to be storable | ✅ yes | ⛔ **no — a rename silently splits the series** |
   *
   * ⛔ **Both are sent, deliberately, and dropping either later is a wire
   * break.** A consumer storing only one is free to ignore the other — the cost
   * of carrying it is one field — whereas **collecting under an identity that is
   * later changed throws the data away rather than merely delaying it.**
   * *(Agreed across the producing and serving sides, 2026-08-17; the cardinality
   * numbers that are the reason are recorded internally.)*
   *
   * ⚠️ Instance identity on the wire is **`(path, section_id)`** — `path` is
   * already here, so no `path#section` composite is ever sent and neither side
   * keeps one in sync.
   *
   * ⛔ **No guard is needed at the call site.** A site with no tracking
   * destination is the default: the call returns having done nothing, opened no
   * connection and thrown nothing. Absent is the normal state, not an error.
   *
   * ⭐ **This is the one tracking entry point that is not behind kit**, and that
   * is deliberate rather than an exception: the block **arrives as a prop**
   * (`{ content, params, block }`), so calling a method on it is not reaching
   * for the `uniweb` global — which foundations must never do. For an event
   * with no block in hand, use kit's `useTracker()`.
   *
   * @param {string} event - event name; the registry is open
   * @param {Object} [data] - the caller's own fields
   */
  track(event, data = {}) {
    globalThis.uniweb?.tracking?.track(event, {
      path: this.path,
      section: this.type,
      section_id: sectionDomId(this),
      ...data
    })
  }

  /**
   * The parent page's URL path, one level up from the current page.
   * Use this for "Back" links in detail pages: /blog/1 → /blog
   *
   * For dynamic pages uses templateRoute (/blog/:id → /blog) rather than
   * the concrete route, so it correctly points to the index page regardless
   * of the param value.
   */
  get parentPath() {
    // Dynamic page: derive parent from the route template, not the concrete URL
    // e.g. templateRoute = '/blog/:id' → parent = '/blog'
    if (this.dynamicContext?.templateRoute) {
      const tmpl = this.dynamicContext.templateRoute
      return tmpl.split('/').slice(0, -1).join('/') || '/'
    }
    // Static page: go one level up from the normalized route
    const p = this.path
    return p.split('/').slice(0, -1).join('/') || '/'
  }

  /**
   * Parse content into a flat semantic structure using @uniweb/semantic-parser.
   *
   * Supports multiple input shapes:
   * 1. Pre-parsed groups structure (from the editor)
   * 2. ProseMirror document (from a markdown record)
   * 3. Wrapped ProseMirror document (content-API format)
   * 4. Plain object (passed through directly)
   *
   * Pure and idempotent — safe to call more than once on the same block.
   * The constructor calls it once to populate `this.parsedContent`; the
   * runtime's `prepareProps` may call it again after a foundation content
   * handler transforms `rawContent`, to produce fresh semantic content
   * from the instantiated tree.
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

    // Wrapped ProseMirror document (Content API format: { doc: { type: "doc", ... } })
    if (content?.doc?.type === 'doc') {
      return this.extractFromProseMirror(content.doc)
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
  /**
   * Options handed to the semantic parser for this block.
   *
   * `assets` carries the host's asset-URL pattern (`config.assets.url`) so a
   * node's `assetId`/`assetExt` resolve to a real URL. It is read from the
   * published payload and passed as an explicit input rather than reached for
   * as module state — the parser must never know a host, and a pattern is the
   * only thing that tells it one.
   *
   * ⚠️ This depends on `website.config` being populated before a Block is
   * constructed, and it is — but only because `Page.bodyBlocks` is a LAZY
   * getter, so blocks are built at render, long after the Website constructor
   * returns. The constructor itself assigns `this.pages` (line ~149) BEFORE
   * `this.config` (line ~159), so an eager Block would parse against an empty
   * config and every asset would silently fall through to `src` — working
   * output, no error, no resolution.
   *
   * ⚠️ **That getter now has a SECOND consumer, in another lane.** The editor
   * relies on it re-running: `updateParams` → `website.rebuild` → `_applyContent`
   * → `page.bodyBlocks` constructs fresh Blocks, which is what re-normalises a
   * section background on every live edit (traced by the frontend lane,
   * 2026-08-17, before deleting their own duplicate normaliser). So making block
   * construction eager breaks background editing as well as asset resolution —
   * two failures, two lanes, one cause, and neither visible from the other side.
   *
   * Do not make block construction eager
   * without moving the config assignment first.
   */
  parseOptions() {
    const assets = this.website?.config?.assets
    return assets ? { assets } : {}
  }

  extractFromProseMirror(doc) {
    try {
      // Parse with semantic-parser - returns flat structure
      const parsed = parseSemanticContent(doc, this.parseOptions())

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

    // Merge component-level CSS vars: meta.js defaults + frontmatter overrides
    // Source: meta.js vars field (defaults), section frontmatter vars: key (overrides)
    if (meta.vars) {
      this.componentVars = Block.mergeComponentVars(meta.vars, this.properties.vars)
    }

    return this.Component
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
    // Layout-area blocks (header/footer/panels) live on a shared, contentless
    // area page — not the content page being rendered — so walking their own
    // page's sequence never reaches the content. Their "next block" is the
    // first content section of the active page (a header adapting to the
    // section it floats over). Resolve against the active page instead.
    const active = this.website?.activePage
    if (active && active !== this.page) {
      return active.getFirstBodyBlockInfo()
    }
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
    // See getNextBlockInfo: from a shared layout-area block, "previous" is the
    // last content section of the active page (e.g. a footer adapting to it).
    const active = this.website?.activePage
    if (active && active !== this.page) {
      return active.getLastBodyBlockInfo()
    }
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
   * Merge component-level CSS variable defaults with frontmatter overrides.
   *
   * Schema vars (from meta.js) can be:
   * - String shorthand: 'card-gap': '1.5rem' → { default: '1.5rem' }
   * - Object: 'card-gap': { default: '1.5rem', label: 'Card Gap' }
   *
   * @param {Object} schemaVars - Var definitions from meta.js
   * @param {Object} [frontmatterVars] - Overrides from section frontmatter
   * @returns {Object} Flat { name: value } object for CSS emission
   */
  static mergeComponentVars(schemaVars, frontmatterVars = {}) {
    const merged = {}

    for (const [name, config] of Object.entries(schemaVars)) {
      const defaultVal = typeof config === 'string' ? config : config?.default
      if (defaultVal != null) {
        merged[name] = defaultVal
      }
    }

    if (frontmatterVars && typeof frontmatterVars === 'object') {
      for (const [name, value] of Object.entries(frontmatterVars)) {
        if (value != null && name in schemaVars) {
          merged[name] = String(value)
        }
      }
    }

    return Object.keys(merged).length > 0 ? merged : null
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
   * @param {Object} [options] - Parse options; `options.assets.url` is the host's
   *        asset-URL pattern, used to resolve a store-held background.
   * @returns {Object} Normalized background config with mode
   */
  static normalizeBackground(raw, options) {
    return Block.resolveBackgroundMedia(Block.normalizeBackgroundShape(raw), options)
  }

  /**
   * Resolve a store-held background asset (`assetId` + `assetExt`) to a `src`.
   *
   * ⭐ This runs HERE, at normalize time, and deliberately not at render. A
   * background is drawn by two twinned implementations — `Background.jsx` (SPA)
   * and `ssr-renderer.js` (SSG + edge) — which both read `background.image?.src`.
   * Resolving at render would mean the identical change in both, and the twins
   * drifting is this repo's standing hazard: the lane you tested keeps working
   * while the other is wrong in production. One resolution here, and both lanes
   * get it for free.
   *
   * Same precedence as the node path: a store-held asset wins WHEN IT RESOLVES,
   * so a producer may write `assetId` beside a `src` and the `src` carries the
   * render until a host declares a pattern.
   */
  static resolveBackgroundMedia(bg, options) {
    const pattern = options?.assets?.url
    if (!pattern || !bg || typeof bg !== 'object') return bg

    let out = bg
    for (const key of ['image', 'video']) {
      const media = bg[key]
      if (!media || typeof media !== 'object') continue
      const url = resolveAssetUrl(media.assetId, media.assetExt, pattern)
      if (url) out = { ...out, [key]: { ...media, src: url } }
    }
    return out
  }

  /** Shape normalization only — no resolution. See `normalizeBackground`. */
  static normalizeBackgroundShape(raw) {
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
      return { mode: 'color', color: normalizeTokenValue(raw) }
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
