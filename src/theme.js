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

// Default semantic tokens by context
const DEFAULT_CONTEXT_TOKENS = {
  light: {
    bg: 'var(--neutral-50)',
    text: 'var(--neutral-950)',
    heading: 'var(--neutral-900)',
    link: 'var(--primary-600)',
  },
  medium: {
    bg: 'var(--neutral-100)',
    text: 'var(--neutral-950)',
    heading: 'var(--neutral-900)',
    link: 'var(--primary-600)',
  },
  dark: {
    bg: 'var(--neutral-900)',
    text: 'var(--neutral-50)',
    heading: 'white',
    link: 'var(--primary-400)',
  },
}

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

  /**
   * Get a semantic token value for a context
   *
   * @param {string} context - Context name ('light', 'medium', 'dark')
   * @param {string} token - Token name (e.g., 'bg', 'text', 'link')
   * @returns {string|null} Token value or null
   *
   * @example
   * theme.getContextToken('light', 'bg') // → "var(--neutral-50)"
   * theme.getContextToken('dark', 'text') // → "var(--neutral-50)"
   */
  getContextToken(context, token) {
    // Check custom context tokens first
    const customContext = this._contexts[context]
    if (customContext && customContext[token]) {
      return customContext[token]
    }

    // Fall back to defaults
    const defaults = DEFAULT_CONTEXT_TOKENS[context]
    return defaults?.[token] || null
  }

  /**
   * Get all tokens for a context
   *
   * @param {string} context - Context name
   * @returns {Object} Token name → value mapping
   */
  getContextTokens(context) {
    const defaults = DEFAULT_CONTEXT_TOKENS[context] || {}
    const custom = this._contexts[context] || {}
    return { ...defaults, ...custom }
  }

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
   * @param {string} type - Font type ('body', 'heading', 'mono')
   * @returns {string|null} Font family string or null
   */
  getFont(type) {
    return this._fonts[type] || null
  }

  /**
   * Get CSS variable reference for a font
   *
   * @param {string} type - Font type
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
