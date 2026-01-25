import { describe, it, expect } from '@jest/globals'
import Theme from '../src/theme.js'

describe('Theme', () => {
  describe('constructor', () => {
    it('creates instance with empty config', () => {
      const theme = new Theme()
      expect(theme).toBeInstanceOf(Theme)
    })

    it('creates instance with full config', () => {
      const theme = new Theme({
        palettes: { primary: { 500: 'oklch(55% 0.2 260)' } },
        colors: { primary: '#3b82f6' },
        contexts: { light: { bg: 'white' } },
        fonts: { body: 'Inter' },
        appearance: { default: 'dark', allowToggle: true },
        foundationVars: { 'header-height': { default: '64px' } },
        css: ':root { --primary-500: oklch(55% 0.2 260); }',
      })

      expect(theme.css).toContain('--primary-500')
      expect(theme.data).toHaveProperty('palettes')
    })
  })

  describe('Color Access', () => {
    const theme = new Theme({
      palettes: {
        primary: {
          50: 'oklch(97% 0.03 260)',
          500: 'oklch(55% 0.2 260)',
          950: 'oklch(14% 0.08 260)',
        },
        neutral: {
          500: 'oklch(55% 0 0)',
        },
      },
    })

    describe('getColor', () => {
      it('returns color for valid palette and shade', () => {
        expect(theme.getColor('primary', 500)).toBe('oklch(55% 0.2 260)')
      })

      it('defaults to shade 500', () => {
        expect(theme.getColor('primary')).toBe('oklch(55% 0.2 260)')
      })

      it('returns null for non-existent palette', () => {
        expect(theme.getColor('nonexistent')).toBeNull()
      })

      it('returns null for non-existent shade', () => {
        expect(theme.getColor('primary', 999)).toBeNull()
      })
    })

    describe('getPalette', () => {
      it('returns full palette object', () => {
        const palette = theme.getPalette('primary')
        expect(palette).toHaveProperty('50')
        expect(palette).toHaveProperty('500')
        expect(palette).toHaveProperty('950')
      })

      it('returns null for non-existent palette', () => {
        expect(theme.getPalette('nonexistent')).toBeNull()
      })
    })

    describe('getPaletteNames', () => {
      it('returns array of palette names', () => {
        const names = theme.getPaletteNames()
        expect(names).toContain('primary')
        expect(names).toContain('neutral')
      })
    })

    describe('hasPalette', () => {
      it('returns true for existing palette', () => {
        expect(theme.hasPalette('primary')).toBe(true)
      })

      it('returns false for non-existent palette', () => {
        expect(theme.hasPalette('nonexistent')).toBe(false)
      })
    })

    describe('getColorVar', () => {
      it('returns CSS var reference', () => {
        expect(theme.getColorVar('primary', 600)).toBe('var(--primary-600)')
      })

      it('defaults to shade 500', () => {
        expect(theme.getColorVar('primary')).toBe('var(--primary-500)')
      })
    })
  })

  describe('Context Access', () => {
    const theme = new Theme({
      contexts: {
        light: { bg: 'white', 'custom-token': '#ff0000' },
        dark: { bg: 'black' },
      },
    })

    describe('getContextToken', () => {
      it('returns custom token value', () => {
        expect(theme.getContextToken('light', 'bg')).toBe('white')
        expect(theme.getContextToken('light', 'custom-token')).toBe('#ff0000')
      })

      it('returns default token when not overridden', () => {
        // Default light text is var(--neutral-950)
        expect(theme.getContextToken('light', 'text')).toBe('var(--neutral-950)')
      })

      it('returns null for non-existent token in non-existent context', () => {
        expect(theme.getContextToken('nonexistent', 'bg')).toBeNull()
      })
    })

    describe('getContextTokens', () => {
      it('returns merged default and custom tokens', () => {
        const tokens = theme.getContextTokens('light')
        expect(tokens.bg).toBe('white') // Custom
        expect(tokens.text).toBe('var(--neutral-950)') // Default
        expect(tokens['custom-token']).toBe('#ff0000') // Custom
      })

      it('returns defaults for context without customization', () => {
        const theme = new Theme({})
        const tokens = theme.getContextTokens('medium')
        expect(tokens).toHaveProperty('bg')
        expect(tokens).toHaveProperty('text')
      })
    })

    describe('getContextClass', () => {
      it('returns context class name', () => {
        expect(theme.getContextClass('light')).toBe('context-light')
        expect(theme.getContextClass('medium')).toBe('context-medium')
        expect(theme.getContextClass('dark')).toBe('context-dark')
      })

      it('falls back to light for invalid context', () => {
        expect(theme.getContextClass('invalid')).toBe('context-light')
      })
    })

    describe('isValidContext', () => {
      it('returns true for valid contexts', () => {
        expect(theme.isValidContext('light')).toBe(true)
        expect(theme.isValidContext('medium')).toBe(true)
        expect(theme.isValidContext('dark')).toBe(true)
      })

      it('returns false for invalid contexts', () => {
        expect(theme.isValidContext('invalid')).toBe(false)
        expect(theme.isValidContext('')).toBe(false)
      })
    })

    describe('getValidContexts', () => {
      it('returns array of valid context names', () => {
        const contexts = theme.getValidContexts()
        expect(contexts).toEqual(['light', 'medium', 'dark'])
      })

      it('returns a copy (not mutable)', () => {
        const contexts1 = theme.getValidContexts()
        contexts1.push('extra')
        const contexts2 = theme.getValidContexts()
        expect(contexts2).not.toContain('extra')
      })
    })
  })

  describe('Appearance (Color Scheme)', () => {
    describe('getAppearance', () => {
      it('returns default appearance config', () => {
        const theme = new Theme({})
        const appearance = theme.getAppearance()

        expect(appearance.default).toBe('light')
        expect(appearance.allowToggle).toBe(false)
        expect(appearance.respectSystemPreference).toBe(true)
        expect(appearance.schemes).toEqual(['light'])
      })

      it('returns custom appearance config', () => {
        const theme = new Theme({
          appearance: {
            default: 'dark',
            allowToggle: true,
            respectSystemPreference: false,
            schemes: ['light', 'dark'],
          },
        })
        const appearance = theme.getAppearance()

        expect(appearance.default).toBe('dark')
        expect(appearance.allowToggle).toBe(true)
        expect(appearance.respectSystemPreference).toBe(false)
        expect(appearance.schemes).toEqual(['light', 'dark'])
      })
    })

    describe('getDefaultScheme', () => {
      it('returns default scheme', () => {
        const theme = new Theme({ appearance: { default: 'dark' } })
        expect(theme.getDefaultScheme()).toBe('dark')
      })

      it('defaults to light', () => {
        const theme = new Theme({})
        expect(theme.getDefaultScheme()).toBe('light')
      })
    })

    describe('supportsScheme', () => {
      it('returns true for supported schemes', () => {
        const theme = new Theme({
          appearance: { schemes: ['light', 'dark'] },
        })
        expect(theme.supportsScheme('light')).toBe(true)
        expect(theme.supportsScheme('dark')).toBe(true)
      })

      it('returns false for unsupported schemes', () => {
        const theme = new Theme({
          appearance: { schemes: ['light'] },
        })
        expect(theme.supportsScheme('dark')).toBe(false)
      })
    })

    describe('hasSchemeToggle', () => {
      it('returns true when toggle is enabled', () => {
        const theme = new Theme({ appearance: { allowToggle: true } })
        expect(theme.hasSchemeToggle()).toBe(true)
      })

      it('returns false when toggle is disabled', () => {
        const theme = new Theme({ appearance: { allowToggle: false } })
        expect(theme.hasSchemeToggle()).toBe(false)
      })

      it('defaults to false', () => {
        const theme = new Theme({})
        expect(theme.hasSchemeToggle()).toBe(false)
      })
    })

    describe('getSchemeClass', () => {
      it('returns scheme class name', () => {
        const theme = new Theme({})
        expect(theme.getSchemeClass('dark')).toBe('scheme-dark')
        expect(theme.getSchemeClass('light')).toBe('scheme-light')
      })
    })
  })

  describe('Fonts', () => {
    const theme = new Theme({
      fonts: {
        body: 'Inter, sans-serif',
        heading: 'Poppins, sans-serif',
        mono: 'Fira Code, monospace',
      },
    })

    describe('getFonts', () => {
      it('returns all font configuration', () => {
        const fonts = theme.getFonts()
        expect(fonts.body).toBe('Inter, sans-serif')
        expect(fonts.heading).toBe('Poppins, sans-serif')
        expect(fonts.mono).toBe('Fira Code, monospace')
      })

      it('returns a copy (not mutable)', () => {
        const fonts1 = theme.getFonts()
        fonts1.body = 'modified'
        const fonts2 = theme.getFonts()
        expect(fonts2.body).toBe('Inter, sans-serif')
      })
    })

    describe('getFont', () => {
      it('returns font family for type', () => {
        expect(theme.getFont('body')).toBe('Inter, sans-serif')
        expect(theme.getFont('heading')).toBe('Poppins, sans-serif')
      })

      it('returns null for non-existent type', () => {
        expect(theme.getFont('nonexistent')).toBeNull()
      })
    })

    describe('getFontVar', () => {
      it('returns CSS var reference for font', () => {
        expect(theme.getFontVar('body')).toBe('var(--font-body)')
        expect(theme.getFontVar('heading')).toBe('var(--font-heading)')
      })
    })
  })

  describe('Foundation Variables', () => {
    const theme = new Theme({
      foundationVars: {
        'header-height': { default: '64px', description: 'Header height' },
        'sidebar-width': '280px', // Simple string value
        'max-width': { default: '1200px' },
      },
    })

    describe('getFoundationVar', () => {
      it('returns value from object config', () => {
        expect(theme.getFoundationVar('header-height')).toBe('64px')
        expect(theme.getFoundationVar('max-width')).toBe('1200px')
      })

      it('returns value from simple string', () => {
        expect(theme.getFoundationVar('sidebar-width')).toBe('280px')
      })

      it('returns null for non-existent var', () => {
        expect(theme.getFoundationVar('nonexistent')).toBeNull()
      })
    })

    describe('getFoundationVars', () => {
      it('returns all foundation variables as values', () => {
        const vars = theme.getFoundationVars()
        expect(vars['header-height']).toBe('64px')
        expect(vars['sidebar-width']).toBe('280px')
        expect(vars['max-width']).toBe('1200px')
      })
    })

    describe('getFoundationVarRef', () => {
      it('returns CSS var reference', () => {
        expect(theme.getFoundationVarRef('header-height')).toBe('var(--header-height)')
      })
    })
  })

  describe('Utility Methods', () => {
    describe('getShadeLevels', () => {
      it('returns all shade levels', () => {
        const theme = new Theme({})
        const levels = theme.getShadeLevels()
        expect(levels).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
      })

      it('returns a copy (not mutable)', () => {
        const theme = new Theme({})
        const levels1 = theme.getShadeLevels()
        levels1.push(999)
        const levels2 = theme.getShadeLevels()
        expect(levels2).not.toContain(999)
      })
    })

    describe('hasCustomization', () => {
      it('returns true when palettes are customized', () => {
        const theme = new Theme({ palettes: { primary: { 500: '#000' } } })
        expect(theme.hasCustomization()).toBe(true)
      })

      it('returns true when contexts are customized', () => {
        const theme = new Theme({ contexts: { light: { bg: 'white' } } })
        expect(theme.hasCustomization()).toBe(true)
      })

      it('returns true when fonts are customized', () => {
        const theme = new Theme({ fonts: { body: 'Inter' } })
        expect(theme.hasCustomization()).toBe(true)
      })

      it('returns false when no customization', () => {
        const theme = new Theme({})
        expect(theme.hasCustomization()).toBe(false)
      })
    })

    describe('toJSON', () => {
      it('returns serializable object', () => {
        const theme = new Theme({
          palettes: { primary: { 500: '#000' } },
          colors: { primary: '#3b82f6' },
          contexts: { light: { bg: 'white' } },
          fonts: { body: 'Inter' },
          appearance: { default: 'dark' },
          foundationVars: { 'header-height': '64px' },
        })

        const json = theme.toJSON()

        expect(json).toHaveProperty('palettes')
        expect(json).toHaveProperty('colors')
        expect(json).toHaveProperty('contexts')
        expect(json).toHaveProperty('fonts')
        expect(json).toHaveProperty('appearance')
        expect(json).toHaveProperty('foundationVars')
      })

      it('is JSON serializable', () => {
        const theme = new Theme({ palettes: { primary: { 500: '#000' } } })
        const str = JSON.stringify(theme.toJSON())
        const parsed = JSON.parse(str)
        expect(parsed.palettes.primary['500']).toBe('#000')
      })
    })
  })

  describe('css property', () => {
    it('returns pre-generated CSS', () => {
      const css = ':root { --primary-500: #3b82f6; }'
      const theme = new Theme({ css })
      expect(theme.css).toBe(css)
    })

    it('returns null when no CSS provided', () => {
      const theme = new Theme({})
      expect(theme.css).toBeNull()
    })
  })

  describe('data property', () => {
    it('returns raw theme data', () => {
      const data = { palettes: { primary: { 500: '#000' } } }
      const theme = new Theme(data)
      expect(theme.data).toBe(data)
    })
  })
})
