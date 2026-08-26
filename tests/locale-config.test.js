/**
 * Shared locale-config helpers — the one home for the language rules
 * (the "Per-locale publish readiness" contract).
 */
import {
  normalizeLanguageList,
  isWildcardLanguages,
  resolveDefaultLocale,
  resolvePublishableLocales,
  validateLanguageConfig,
  localeLabel,
  LOCALE_DISPLAY_NAMES
} from '../src/locale-config.js'

describe('normalizeLanguageList', () => {
  test('non-arrays yield empty', () => {
    expect(normalizeLanguageList(undefined)).toEqual([])
    expect(normalizeLanguageList(null)).toEqual([])
    expect(normalizeLanguageList('en')).toEqual([])
    expect(normalizeLanguageList({ en: true })).toEqual([])
  })

  test('passes through clean string lists', () => {
    expect(normalizeLanguageList(['en', 'fr', 'de'])).toEqual(['en', 'fr', 'de'])
  })

  test('dedupes preserving first-seen order', () => {
    expect(normalizeLanguageList(['en', 'fr', 'en', 'fr'])).toEqual(['en', 'fr'])
  })

  test('drops invalid entries, trims strings', () => {
    expect(normalizeLanguageList(['en', '', '  fr  ', 42, null, {}])).toEqual(['en', 'fr'])
  })

  test('tolerates legacy { code } objects on read', () => {
    expect(normalizeLanguageList(['en', { code: 'fr', label: 'Français' }])).toEqual(['en', 'fr'])
    expect(normalizeLanguageList([{ label: 'no code' }])).toEqual([])
  })
})

describe('resolveDefaultLocale', () => {
  test('defaultLanguage wins', () => {
    expect(resolveDefaultLocale({ defaultLanguage: 'fr', languages: ['en', 'fr'] })).toBe('fr')
  })

  test('falls back to languages[0] — the previously inconsistent step', () => {
    expect(resolveDefaultLocale({ languages: ['fr', 'en'] })).toBe('fr')
  })

  test('falls back to en with no config at all', () => {
    expect(resolveDefaultLocale()).toBe('en')
    expect(resolveDefaultLocale({})).toBe('en')
    expect(resolveDefaultLocale({ languages: [] })).toBe('en')
    expect(resolveDefaultLocale(null)).toBe('en')
  })

  test('legacy object first entry contributes its code', () => {
    expect(resolveDefaultLocale({ languages: [{ code: 'es' }, 'en'] })).toBe('es')
  })

  test('blank defaultLanguage is ignored', () => {
    expect(resolveDefaultLocale({ defaultLanguage: '  ', languages: ['fr'] })).toBe('fr')
  })
})

describe('resolvePublishableLocales', () => {
  test('absent field → all declared publishable, explicit false', () => {
    expect(resolvePublishableLocales({ languages: ['en', 'fr'] })).toEqual({
      publishable: ['en', 'fr'],
      dangling: [],
      explicit: false
    })
  })

  test('present list → intersection in DECLARED order, explicit true', () => {
    expect(
      resolvePublishableLocales({ languages: ['en', 'fr', 'de'], publishLanguages: ['de', 'en'] })
    ).toEqual({ publishable: ['en', 'de'], dangling: [], explicit: true })
  })

  test('present-but-empty → nothing publishable, NOT treated as absent', () => {
    expect(resolvePublishableLocales({ languages: ['en'], publishLanguages: [] })).toEqual({
      publishable: [],
      dangling: [],
      explicit: true
    })
  })

  test('dangling codes reported, never merged into publishable', () => {
    expect(
      resolvePublishableLocales({ languages: ['en'], publishLanguages: ['en', 'fr'] })
    ).toEqual({ publishable: ['en'], dangling: ['fr'], explicit: true })
  })

  test('newly declared language defaults OUT when the field is present', () => {
    // author adds 'de' to languages without touching publishLanguages
    expect(
      resolvePublishableLocales({ languages: ['en', 'de'], publishLanguages: ['en'] }).publishable
    ).toEqual(['en'])
  })
})

describe('wildcard languages (auto-discover)', () => {
  test('isWildcardLanguages detects both forms', () => {
    expect(isWildcardLanguages('*')).toBe(true)
    expect(isWildcardLanguages(['*'])).toBe(true)
    expect(isWildcardLanguages(['en', '*'])).toBe(true)
    expect(isWildcardLanguages(['en'])).toBe(false)
    expect(isWildcardLanguages(undefined)).toBe(false)
  })

  test("'*' is never a locale code", () => {
    expect(normalizeLanguageList(['*', 'en'])).toEqual(['en'])
    expect(resolveDefaultLocale({ languages: ['*'] })).toBe('en')
  })

  test('wildcard + explicit publish list → publishable = the list, no dangling', () => {
    expect(resolvePublishableLocales({ languages: '*', publishLanguages: ['en', 'fr'] })).toEqual({
      publishable: ['en', 'fr'],
      dangling: [],
      explicit: true
    })
  })

  test('wildcard without publish list stays non-explicit', () => {
    expect(resolvePublishableLocales({ languages: '*' }).explicit).toBe(false)
  })

  test('wildcard marker does not warn in validation', () => {
    const res = validateLanguageConfig({ languages: '*', publishLanguages: ['en'] })
    expect(res.warnings).toEqual([])
    expect(res.errors).toEqual([])
  })

  test('wildcard + empty publish list still errors', () => {
    const res = validateLanguageConfig({ languages: '*', publishLanguages: [] })
    expect(res.errors.map((e) => e.code)).toEqual(['nothing-publishable'])
  })
})

describe('validateLanguageConfig', () => {
  const codes = (list) => list.map((p) => p.code)

  test('clean config → no problems', () => {
    const res = validateLanguageConfig({
      defaultLanguage: 'en',
      languages: ['en', 'fr'],
      publishLanguages: ['en', 'fr']
    })
    expect(res.errors).toEqual([])
    expect(res.warnings).toEqual([])
  })

  test('absent publishLanguages never errors (back-compat wildcard)', () => {
    expect(validateLanguageConfig({ languages: ['en', 'fr'] }).errors).toEqual([])
    expect(validateLanguageConfig({}).errors).toEqual([])
  })

  test('dangling publish code warns', () => {
    const res = validateLanguageConfig({ languages: ['en'], publishLanguages: ['en', 'fr'] })
    expect(codes(res.warnings)).toContain('dangling-publish-language')
    expect(res.errors).toEqual([])
  })

  test('explicit empty list → nothing-publishable error', () => {
    const res = validateLanguageConfig({ languages: ['en'], publishLanguages: [] })
    expect(codes(res.errors)).toEqual(['nothing-publishable'])
  })

  test('all-dangling list → nothing-publishable error', () => {
    const res = validateLanguageConfig({ languages: ['en'], publishLanguages: ['fr', 'de'] })
    expect(codes(res.errors)).toEqual(['nothing-publishable'])
  })

  test('effective default excluded from publish list → default-not-publishable', () => {
    const res = validateLanguageConfig({
      defaultLanguage: 'en',
      languages: ['en', 'fr'],
      publishLanguages: ['fr']
    })
    expect(codes(res.errors)).toEqual(['default-not-publishable'])
  })

  test('default from languages[0] participates in the intersection check', () => {
    // no defaultLanguage: effective default is 'fr' (languages[0]) — publishable, OK
    const ok = validateLanguageConfig({ languages: ['fr', 'en'], publishLanguages: ['fr'] })
    expect(ok.errors).toEqual([])
  })

  test('legacy object entry warns but still resolves', () => {
    const res = validateLanguageConfig({ languages: ['en', { code: 'fr' }] })
    expect(codes(res.warnings)).toContain('invalid-language-entry')
    expect(res.errors).toEqual([])
  })

  test('duplicates and invalid entries warn', () => {
    const res = validateLanguageConfig({ languages: ['en', 'en', 42] })
    expect(codes(res.warnings)).toEqual(
      expect.arrayContaining(['duplicate-language', 'invalid-language-entry'])
    )
  })

  test('non-array publishLanguages warns and is ignored', () => {
    const res = validateLanguageConfig({ languages: ['en'], publishLanguages: 'en' })
    expect(codes(res.warnings)).toContain('invalid-publish-language-entry')
    // string is not treated as a list → resolver sees [] → explicit empty
    expect(codes(res.errors)).toEqual(['nothing-publishable'])
  })
})


describe('localeLabel', () => {
  test('a bare code resolves through the display-name table', () => {
    expect(localeLabel('fr')).toBe('Français')
    expect(localeLabel('zh-CN')).toBe('简体中文')
  })

  test('an object without a label resolves the same as its bare code', () => {
    // This is the whole point: the plain-string form `languages: [fr]` must not
    // produce a worse label than the legacy `{ code: fr, label: Français }` it
    // is meant to replace.
    expect(localeLabel({ code: 'fr' })).toBe(localeLabel('fr'))
  })

  test('an explicit label always wins', () => {
    expect(localeLabel({ code: 'fr', label: 'Fr.' })).toBe('Fr.')
  })

  test('an unknown code falls back to the code uppercased', () => {
    expect(localeLabel('xx')).toBe('XX')
    expect(localeLabel({ code: 'xx' })).toBe('XX')
  })

  test('a codeless entry yields empty string rather than throwing', () => {
    expect(localeLabel(null)).toBe('')
    expect(localeLabel({})).toBe('')
    expect(localeLabel({ code: '' })).toBe('')
  })

  test('every declared display name is a non-empty string', () => {
    for (const [code, name] of Object.entries(LOCALE_DISPLAY_NAMES)) {
      expect(typeof name).toBe('string')
      expect(name.length).toBeGreaterThan(0)
      expect(code).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/)
    }
  })
})
