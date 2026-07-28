/**
 * Theme Class
 *
 * Runtime representation of a site's theme configuration.
 * Provides access to colors, semantic tokens, and appearance settings.
 *
 * @module @uniweb/core/theme
 */

// Standard shade levels
const SHADE_LEVELS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

// Valid color contexts
const VALID_CONTEXTS = ['light', 'medium', 'dark']

/**
 * Theme class for runtime theme access
 */
export default class Theme {
  /**
   * Create a Theme instance
   *
   * @param {Object} themeData - Processed theme data from build
   * @param {Object} themeData.palettes - Generated color palettes (name → { shade → value })
   * @param {Object} themeData.colors - Raw colors (for reference)
   * @param {Object} themeData.contexts - Context token overrides
   * @param {Object} themeData.fonts - Font configuration
   * @param {Object} themeData.appearance - Appearance settings
   * @param {Object} themeData.foundationVars - Foundation variables
   * @param {string} themeData.css - Pre-generated CSS (optional)
   */
  constructor(themeData = {}) {
    this._data = themeData
    // Use palettes if available, fall back to colors for backwards compatibility
    this._palettes = themeData.palettes || themeData.colors || {}
    this._rawColors = themeData.colors || {}
    this._contexts = themeData.contexts || {}
    this._fonts = themeData.fonts || {}
    this._appearance = themeData.appearance || { default: 'light' }
    this._foundationVars = themeData.foundationVars || {}
    this._css = themeData.css || null

    Object.seal(this)
  }

  /**
   * Get the pre-generated CSS string
   * @returns {string|null}
   */
  get css() {
    return this._css
  }

  /**
   * Get the raw theme data
   * @returns {Object}
   */
  get data() {
    return this._data
  }

  // ============================================================
  // Color Access
  // ============================================================

  /**
   * Get a color value from a palette
   *
   * @param {string} name - Palette name (e.g., 'primary', 'neutral')
   * @param {number} shade - Shade level (50-950), defaults to 500
   * @returns {string|null} Color value (oklch string) or null if not found
   *
   * @example
   * theme.getColor('primary', 500) // → "oklch(55.0% 0.2000 260.0)"
   * theme.getColor('primary')      // → same as above (500 is default)
   */
  getColor(name, shade = 500) {
    const palette = this._palettes[name]
    if (!palette) return null

    return palette[shade] || null
  }

  /**
   * Get all shades for a color palette
   *
   * @param {string} name - Palette name
   * @returns {Object|null} Object with shade levels as keys, or null
   *
   * @example
   * theme.getPalette('primary')
   * // → { 50: "oklch(...)", 100: "oklch(...)", ... }
   */
  getPalette(name) {
    return this._palettes[name] || null
  }

  /**
   * Get all available palette names
   *
   * @returns {string[]} Array of palette names
   */
  getPaletteNames() {
    return Object.keys(this._palettes)
  }

  /**
   * Check if a palette exists
   *
   * @param {string} name - Palette name
   * @returns {boolean}
   */
  hasPalette(name) {
    return name in this._palettes
  }

  /**
   * Get a CSS variable reference for a color
   *
   * @param {string} name - Palette name
   * @param {number} shade - Shade level
   * @returns {string} CSS var() reference
   *
   * @example
   * theme.getColorVar('primary', 600) // → "var(--primary-600)"
   */
  getColorVar(name, shade = 500) {
    return `var(--${name}-${shade})`
  }

  // ============================================================
  // Context Access
  // ============================================================

  /*
   * REMOVED 2026-07-28: getContextToken(context, token) and
   * getContextTokens(context), plus the DEFAULT_CONTEXT_TOKENS table backing
   * them. Read this before reintroducing either.
   *
   * They were unreachable-by-design rather than merely stale. A lookup keyed on
   * (context, token) answers "what does the .context-<name> class set by
   * default?", but the question callers ask is "what colour is --heading HERE",
   * and those diverge for two reasons no such lookup can see:
   *
   *   - a section's own `theme:` overrides, emitted as `#section-{id} { … }` by
   *     @uniweb/theming's buildSectionOverrides;
   *   - the active site scheme, where `.scheme-dark` redefines the root tokens.
   *
   * So a correct-looking answer would still be wrong whenever a section
   * overrides tokens or the visitor is in dark mode — the failure being a
   * confident wrong value, not an error. (The table had also drifted: it held
   * `bg`/`text`, retired in favour of `section`/`body`, and four tokens where
   * the live set is ~25. Repopulating it would have made a misleading API look
   * trustworthy, which is worse than leaving it visibly incomplete.)
   *
   * What to use instead:
   *   - an actually-resolved value (canvas, SVG, a chart matching the theme):
   *     getComputedStyle(el).getPropertyValue('--heading') — this accounts for
   *     both section overrides and the active scheme, which no static table can;
   *   - the defaults table itself (tooling, a theme editor):
   *     getDefaultContextTokens() from @uniweb/theming, which owns it;
   *   - ordinary component styling: the CSS variables directly. Reading tokens
   *     into JS to branch on them is the `isDark ? … : …` pattern semantic
   *     tokens exist to remove.
   *
   * SHADE_LEVELS below is duplicated from @uniweb/theming too, and was left
   * deliberately: both copies are identical and the 11-step scale is fixed by
   * the design, so there is no drift to prevent — noted so the next reader
   * knows it was considered rather than missed.
   */

  /**
   * Get the CSS class name for a context
   *
   * @param {string} context - Context name
   * @returns {string} CSS class name
   *
   * @example
   * theme.getContextClass('dark') // → "context-dark"
   */
  getContextClass(context) {
    if (!VALID_CONTEXTS.includes(context)) {
      console.warn(`Invalid context: ${context}. Using 'light'.`)
      return 'context-light'
    }
    return `context-${context}`
  }

  /**
   * Check if a context is valid
   *
   * @param {string} context - Context name
   * @returns {boolean}
   */
  isValidContext(context) {
    return VALID_CONTEXTS.includes(context)
  }

  /**
   * Get all valid context names
   *
   * @returns {string[]}
   */
  getValidContexts() {
    return [...VALID_CONTEXTS]
  }

  // ============================================================
  // Appearance (Color Scheme)
  // ============================================================

  /**
   * Get appearance configuration
   *
   * @returns {Object} Appearance settings
   * @property {string} default - Default scheme ('light', 'dark', 'system')
   * @property {boolean} allowToggle - Whether scheme toggle is enabled
   * @property {boolean} respectSystemPreference - Honor prefers-color-scheme
   * @property {string[]} schemes - Available schemes
   */
  getAppearance() {
    return {
      default: this._appearance.default || 'light',
      allowToggle: this._appearance.allowToggle || false,
      respectSystemPreference: this._appearance.respectSystemPreference ?? true,
      schemes: this._appearance.schemes || ['light'],
    }
  }

  /**
   * Get the default color scheme
   *
   * @returns {string} 'light', 'dark', or 'system'
   */
  getDefaultScheme() {
    return this._appearance.default || 'light'
  }

  /**
   * Check if a color scheme is supported
   *
   * @param {string} scheme - Scheme name
   * @returns {boolean}
   */
  supportsScheme(scheme) {
    const schemes = this._appearance.schemes || ['light']
    return schemes.includes(scheme)
  }

  /**
   * Check if scheme toggle is enabled
   *
   * @returns {boolean}
   */
  hasSchemeToggle() {
    return this._appearance.allowToggle === true
  }

  /**
   * Get the CSS class for a scheme
   *
   * @param {string} scheme - Scheme name
   * @returns {string} CSS class name
   *
   * @example
   * theme.getSchemeClass('dark') // → "scheme-dark"
   */
  getSchemeClass(scheme) {
    return `scheme-${scheme}`
  }

  // ============================================================
  // Fonts
  // ============================================================

  /**
   * Get font configuration
   *
   * @returns {Object} Font settings
   */
  getFonts() {
    return { ...this._fonts }
  }

  /**
   * Get a specific font family
   *
   * @param {string} type - Font role name ('body', 'heading', 'code', or a
   *   foundation-defined role)
   * @returns {string|null} Font family string or null
   */
  getFont(type) {
    return this._fonts[type] || null
  }

  /**
   * Get CSS variable reference for a font
   *
   * @param {string} type - Font role name
   * @returns {string} CSS var() reference
   */
  getFontVar(type) {
    return `var(--font-${type})`
  }

  // ============================================================
  // Foundation Variables
  // ============================================================

  /**
   * Get a foundation variable value
   *
   * @param {string} name - Variable name
   * @returns {string|null} Variable value or null
   */
  getFoundationVar(name) {
    const config = this._foundationVars[name]
    if (!config) return null
    return typeof config === 'object' ? config.default : config
  }

  /**
   * Get all foundation variables
   *
   * @returns {Object} Variable name → value mapping
   */
  getFoundationVars() {
    const vars = {}
    for (const [name, config] of Object.entries(this._foundationVars)) {
      vars[name] = typeof config === 'object' ? config.default : config
    }
    return vars
  }

  /**
   * Get CSS variable reference for a foundation variable
   *
   * @param {string} name - Variable name
   * @returns {string} CSS var() reference
   */
  getFoundationVarRef(name) {
    return `var(--${name})`
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Get all shade levels
   *
   * @returns {number[]}
   */
  getShadeLevels() {
    return [...SHADE_LEVELS]
  }

  /**
   * Check if theme has any custom configuration
   *
   * @returns {boolean}
   */
  hasCustomization() {
    return (
      Object.keys(this._palettes).length > 0 ||
      Object.keys(this._contexts).length > 0 ||
      Object.keys(this._fonts).length > 0
    )
  }

  /**
   * Convert theme to a plain object (for serialization)
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      palettes: this._palettes,
      colors: this._rawColors,
      contexts: this._contexts,
      fonts: this._fonts,
      appearance: this._appearance,
      foundationVars: this._foundationVars,
    }
  }
}

/**
 * Does a site's appearance config make the dark scheme reachable at all?
 *
 * This is the behavioral "can this site ever show dark" predicate — distinct
 * from Theme.supportsScheme(), which literally answers "is this scheme listed
 * in `schemes:`". A site reaches dark if it offers a toggle, defaults to dark
 * or system, or explicitly lists dark in `schemes`.
 *
 * CANONICAL SHARED PREDICATE. It MUST stay in lockstep with the dark-CSS
 * emission guard in @uniweb/theming's css-generator.js (`generateThemeCSS`,
 * "Dark scheme support" block): that guard decides whether the `.scheme-dark`
 * rules physically exist, and this decides whether the runtime may boot into
 * or switch to dark. If the two disagree, you get a scheme with no matching
 * CSS (page claims dark, renders light) — the exact desync class this unifies
 * away. @uniweb/theming cannot import @uniweb/core, so its copy is annotated to
 * point here; everything that consumes the model (runtime boot, kit's
 * useAppearance) imports THIS one.
 *
 * A warning is not a mechanism, and this one has been tested: while it stood,
 * a SECOND shared table in this same file — DEFAULT_CONTEXT_TOKENS, duplicating
 * @uniweb/theming's — drifted to retired token names and lost twenty entries
 * without anyone noticing, because nothing called the two methods that read it.
 * It was removed 2026-07-28 (see the note where it sat). Treat the lockstep
 * above as a live obligation with a track record, not a formality: if you find
 * yourself copying a value out of @uniweb/theming into this file, that is the
 * moment this comment is for.
 *
 * @param {Object} appearance - the resolved theme.yml `appearance:` block
 * @returns {boolean}
 */
export function hasDarkScheme(appearance = {}) {
  return Boolean(
    appearance.allowToggle ||
      appearance.default === 'dark' ||
      appearance.default === 'system' ||
      appearance.schemes?.includes('dark')
  )
}
