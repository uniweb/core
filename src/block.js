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
import { liftInsets } from './insets.js'

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
    // Insets arrive as the author wrote them — `inset_ref` for a leaf, `inset_block`
    // for a ```@Component fence — and are lifted out HERE into placeholders plus
    // inset Blocks (`liftInsets`). Doing it at render-graph construction rather than
    // at build time is deliberate: what the author wrote is the canonical STORED
    // shape, so the content that syncs and round-trips keeps carrying it.
    // `blockData.content` is left untouched — the lift produces a new tree and only
    // this Block's view of it changes. ⛔ A stored `insets[]` — what the build extracted
    // before 2026-09-27 — is no longer read: no store serves one since the site-content
    // Model dropped the field (2026-09-28), and a site pushed again carries its insets in
    // its content.
    const lifted = liftInsets(blockData.content)
    this.rawContent = lifted.content || {}
    this.parsedContent = this.parseContent(lifted.content)

    // Merge fetched data from prerender (if present)
    // Prerender stores fetched data in blockData.parsedContent.data
    //
    // ⭐ THE SECTION'S OWN DATA WINS, as it does when nothing was prerendered: a tagged
    // data block fills its key first, and a fetch fills only what is left. ⛔ The
    // prerendered answer was spread LAST until 2026-09-14, so a key held by both a
    // tagged block and the section's own fetch showed the fetch's records on a
    // prerendered page and the tagged block in the browser.
    if (blockData.parsedContent?.data) {
      this.parsedContent.data = {
        ...blockData.parsedContent.data,
        ...(this.parsedContent.data || {}),
      }
    }

    // ⭐ WHAT THE SECTION HOLDS before any fetch answers it: its tagged data blocks, and
    // its own fetches' answers a static build prerendered into it, by key. A declared key
    // it holds is filled from here first (`runtime/src/prepare-props.js`), and a fetch
    // whose answer is here is not asked again (`EntityStore`). Kept apart from
    // `parsedContent.data`, which each render rebuilds from the declared keys.
    this.heldData = this.parsedContent.data || {}

    // Flat content structure - no more nested main/items
    // parsedContent now has: title, pretitle, paragraphs, links, images, items, etc.
    this.items = this.parsedContent.items || []

    // Block configuration
    const blockConfig = blockData.params || blockData.config || {}
    this.preset = blockData.preset

    // ⭐ THE SECTION'S OWN SETTINGS — the names framework reserves in its params
    // (`@uniweb/schemas/section`): `theme`, `background`, `grid`, `vars`, `fetch`. Framework applies
    // each — the runtime paints the background and the color context around the component,
    // the page stylesheet applies the section's theme and its component's variables, kit's
    // `ChildGrid` lays out the child sections — so each is lifted onto the block, normalized
    // once for every renderer, and a component NEVER receives one as a param [Diego,
    // 2026-09-28]. It reads them from the block, or through kit. ⛔ Until then a component
    // also received `theme` (the mode), `background` and `vars` as params, and nothing read
    // them there. `standardOptions` and `properties` are the older editor envelopes.
    const own = blockConfig.properties || blockConfig
    const setting = (name) => (blockConfig[name] !== undefined ? blockConfig[name] : own[name])
    const rawTheme = setting('theme')
    const rawBg = setting('background')
    const gridParam = setting('grid')
    const varsParam = setting('vars')
    const fetchParam = setting('fetch')
    const standardOptions = blockConfig.standardOptions
    const {
      theme: _theme, background: _background, grid: _grid, vars: _vars, fetch: _fetch,
      standardOptions: _standardOptions, properties: _properties,
      ...componentParams
    } = own
    this.properties = componentParams

    // The section's theme: `theme.yml`'s own keys scoped to the section — `colors`,
    // `contexts`, `vars` — plus `mode`, the color context it pins. `theme: dark` is the
    // shorthand for `{ mode: dark }`, and a token written beside `mode` applies to the section
    // in any context (`normalizeSectionTheme`). The page stylesheet applies the overrides
    // (`buildSectionOverrides`, @uniweb/theming).
    //
    // themeName values:
    //   '' (empty) = Auto — the section follows the site's light/dark scheme
    //   'light'    = Pinned to light context
    //   'medium'   = Pinned to dim context
    //   'dark'     = Pinned to dark context
    const theme = Block.normalizeSectionTheme(rawTheme)
    this.themeName = theme.mode
    this.themeOverrides = theme.overrides
    // The tokens in effect whatever the scheme (`normalizeSectionTheme`): the renderers apply
    // them inline on the section, and a neighbour reads them through `getBlockInfo()`.
    this.contextOverrides = theme.effectiveTokens

    // ⚠️ The older editor envelope: `colors` (a section palette, and tokens per context) and
    // `foundationStyles`, read by the page stylesheet until an editor writes the section's
    // `theme` instead (uwx-format.md § A page section's fields). Nothing else reads it.
    this.standardOptions = standardOptions || {}

    // What the runtime draws behind the section — normalized once (its shape, and store-held
    // assets resolved to URLs) for every renderer, and for a component that draws it itself
    // (`background: 'self'` in `meta.js`, with kit's `SectionBackground`). An editor's preview
    // may still send it inside the older envelope, which wins while it does.
    this.background =
      this.standardOptions.background ||
      (rawBg ? Block.normalizeBackground(rawBg, this.parseOptions()) : null)

    // Values for the CSS variables the component declares in `meta.js` `vars:` — merged into
    // `componentVars` when the component is known (`initComponent`).
    this.sectionVars = varsParam && typeof varsParam === 'object' ? varsParam : null

    // Child blocks (subsections)
    this.childBlocks = blockData.subsections
      ? blockData.subsections.map((block, i) => new Block(block, `${id}_${i}`, this.page))
      : []

    // Insets — inline @-referenced components positioned in content flow: the leaves
    // lifted from the content, in document order. Each receives its `[…]` text as
    // `content.title` and its `{…}` as params.
    this.insets = []
    const insetData = lifted.leaves
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

    // Containers, appended AFTER the leaf insets so `block.insets[0]` keeps
    // meaning what it meant to every foundation already using <Visual>.
    // Unlike a leaf inset, a container's body becomes the child Block's
    // content, so the foundation's component receives a fully parsed
    // `content` — title, paragraphs, items, sequence — exactly as a section
    // does. Nested containers resolve for free: the child Block runs this
    // same constructor over its own body, leaf insets included.
    for (let i = 0; i < lifted.containers.length; i++) {
      const ref = lifted.containers[i]
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

    // The section's own data — what its `query:` / `fetch:` declares. A stored section carries it
    // in `params.fetch` [Diego, 2026-09-28], which wins when present; the `fetch` beside the params
    // is framework's own build output, and a store's older field.
    this.fetch = fetchParam || blockData.fetch || null

    // The layout the author chose for this section's child sections — the reserved
    // `grid:` section key [Diego, 2026-09-27]: `3` (equal columns) or `'40/60'`
    // (relative widths). Carried as written; kit's `ChildGrid` lays the children out
    // from it (`@uniweb/schemas/grid`). A section key, never a param: a component
    // declares the layouts it offers in `meta.js` `children.grid`, and does not see
    // `grid` among its params (above).
    // ⭐ It is read from the params, where it is stored and synced — no field of its
    // own, so no store has to declare one. `blockData.grid` is `@uniweb/build@0.67.0`'s
    // spelling, which carried it beside the params for a few hours on 2026-09-27.
    this.grid = gridParam ?? blockData.grid ?? null

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
      this.componentVars = Block.mergeComponentVars(meta.vars, this.sectionVars)
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
  /**
   * A section's theme, from its `theme:` — `theme.yml`'s own keys scoped to the section,
   * plus `mode`, the color context it pins:
   *
   *     theme: dark                      the shorthand for { mode: dark }
   *     theme:
   *       mode: dark                     light | medium | dark; left out, the section follows the site
   *       colors: { primary: '#0a6' }    like theme.yml `colors` — a palette, shades generated
   *       contexts: { dark: { … } }      like theme.yml `contexts` — tokens per color context
   *       vars: { header-height: 5rem }  like theme.yml `vars` — the foundation's variables
   *       heading: primary-900          a token beside `mode` — the section's in any context
   *
   * Token values resolve bare palette references (`neutral-900` → `var(--neutral-900)`).
   *
   * @param {string|Object|null|undefined} raw
   * @returns {{ mode: string, overrides: Object|null, effectiveTokens: Object|null }}
   *   `overrides` is `{ colors, contexts, vars, tokens }` (each null when unset) or null when
   *   the section overrides nothing; `effectiveTokens` are the tokens in effect whatever the
   *   scheme — a pinned section's context's own over those beside `mode`; for a section that
   *   follows the site, those beside `mode` it sets in no context — or null. The renderers
   *   apply them inline, so they reach the page even where a host places no page stylesheet.
   */
  static normalizeSectionTheme(raw) {
    if (raw === undefined || raw === null || raw === '') return { mode: '', overrides: null, effectiveTokens: null }
    if (typeof raw !== 'object' || Array.isArray(raw)) return { mode: String(raw), overrides: null, effectiveTokens: null }

    const { mode, colors, contexts, vars, ...tokens } = raw
    const tokenMap = (map) => {
      if (!map || typeof map !== 'object' || Array.isArray(map)) return null
      const out = {}
      for (const [name, value] of Object.entries(map)) {
        if (value === undefined || value === null || value === '') continue
        out[name] = normalizeTokenValue(value)
      }
      return Object.keys(out).length > 0 ? out : null
    }
    const nonEmpty = (map) =>
      map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).length > 0 ? { ...map } : null

    const byContext = {}
    if (contexts && typeof contexts === 'object') {
      for (const [context, map] of Object.entries(contexts)) {
        const normalized = tokenMap(map)
        if (normalized) byContext[context] = normalized
      }
    }
    const overrides = {
      colors: nonEmpty(colors),
      contexts: Object.keys(byContext).length > 0 ? byContext : null,
      vars: nonEmpty(vars),
      tokens: tokenMap(tokens),
    }
    const pinned = typeof mode === 'string' ? mode : ''
    // A context's own token beats one written beside `mode`, as in the page stylesheet. A
    // section that follows the site has no context of its own, so a token it also sets per
    // context is left to the stylesheet's per-scheme rules rather than applied here.
    const perContext = new Set(Object.values(byContext).flatMap((map) => Object.keys(map)))
    const effective = pinned
      ? { ...(overrides.tokens || {}), ...(byContext[pinned] || {}) }
      : Object.fromEntries(Object.entries(overrides.tokens || {}).filter(([name]) => !perContext.has(name)))
    return {
      mode: pinned,
      overrides: Object.values(overrides).some(Boolean) ? overrides : null,
      effectiveTokens: Object.keys(effective).length > 0 ? effective : null,
    }
  }

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
