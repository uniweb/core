/**
 * Shared locale-config helpers — the ONE home for the language rules that
 * build, sync, runtime, and the CLI all apply to a site's config.
 *
 * Contract ("Per-locale publish readiness"):
 * - `languages` (site.yml) / `info.languages` (wire) — the DECLARED working
 *   set. A plain, strongly-validated string list.
 * - `publishLanguages` (site.yml) / `info.publish_languages` (wire) — publish
 *   intent. Publishable = intersection with declared; absent field = all
 *   declared publishable; present-but-empty = nothing publishable; dangling
 *   codes (listed but not declared) are benign — warn, ignore in the
 *   intersection, round-trip verbatim.
 * - Effective default locale = `defaultLanguage || languages[0] || 'en'` —
 *   one rule everywhere. (Historically half the call sites skipped the
 *   `languages[0]` step; this module exists so that can't drift again.)
 */

/**
 * Extract a locale code from a declared-language entry. The contract is
 * strings-only; legacy `{ code, label }` objects are tolerated on read
 * (they appeared in older configs and the runtime's buildLocalesList
 * accepted them) but are never produced. The `'*'` wildcard marker
 * (auto-discover from `locales/`) is not a locale code.
 *
 * @param {*} entry - Declared-language entry.
 * @returns {string|null} The locale code, or null when unusable.
 */
function codeOf(entry) {
  if (typeof entry === 'string' && entry.trim() && entry.trim() !== '*') return entry.trim()
  if (entry && typeof entry === 'object' && typeof entry.code === 'string' && entry.code.trim()) {
    return entry.code.trim()
  }
  return null
}

/**
 * Whether `languages` uses the auto-discover wildcard (`'*'`, or an array
 * containing it). The declared set is then filesystem-derived and unknown
 * to these pure helpers.
 *
 * @param {*} value - The authored `languages` value.
 * @returns {boolean}
 */
export function isWildcardLanguages(value) {
  return value === '*' || (Array.isArray(value) && value.includes('*'))
}

/**
 * Normalize a language list to validated string codes: invalid entries
 * dropped, duplicates deduped, order preserved.
 *
 * @param {*} value - The authored list (anything; non-arrays yield []).
 * @returns {string[]} Clean locale codes.
 */
export function normalizeLanguageList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const codes = []
  for (const entry of value) {
    const code = codeOf(entry)
    if (!code || seen.has(code)) continue
    seen.add(code)
    codes.push(code)
  }
  return codes
}

/**
 * The effective default locale: `defaultLanguage || languages[0] || 'en'`.
 * Works on authored site.yml, built site-content config, and served payload
 * config alike (all carry the same camelCase keys).
 *
 * @param {Object} [config] - Site config (`{ defaultLanguage?, languages? }`).
 * @returns {string} The effective default locale code.
 */
export function resolveDefaultLocale(config = {}) {
  if (typeof config?.defaultLanguage === 'string' && config.defaultLanguage.trim()) {
    return config.defaultLanguage.trim()
  }
  return normalizeLanguageList(config?.languages)[0] || 'en'
}

/**
 * The publishable set: `publishLanguages ∩ languages`, in declared order.
 *
 * - Absent `publishLanguages` → all declared publishable (`explicit: false`).
 * - Present (even empty) → the intersection (`explicit: true`); an authored
 *   empty list means nothing publishable — NOT treated as absent.
 * - Dangling codes are returned for the caller to warn about; they are never
 *   silently pruned from the authored/stored list (the verbatim round-trip is
 *   what preserves publish intent across a remove + re-add in `languages`).
 *
 * With wildcard `languages` (`'*'`), the declared set is unknown here
 * (filesystem-derived), so the intersection with "all" is the publish list
 * itself and dangling codes cannot exist.
 *
 * @param {Object} [config] - Site config (`{ languages?, publishLanguages? }`).
 * @returns {{ publishable: string[], dangling: string[], explicit: boolean }}
 */
export function resolvePublishableLocales(config = {}) {
  const declared = normalizeLanguageList(config?.languages)
  const raw = config?.publishLanguages
  if (raw == null) return { publishable: declared, dangling: [], explicit: false }
  const listed = normalizeLanguageList(raw)
  if (isWildcardLanguages(config?.languages)) {
    return { publishable: listed, dangling: [], explicit: true }
  }
  const declaredSet = new Set(declared)
  const listedSet = new Set(listed)
  return {
    publishable: declared.filter((code) => listedSet.has(code)),
    dangling: listed.filter((code) => !declaredSet.has(code)),
    explicit: true
  }
}

/**
 * Validate a site's language configuration against the contract. Pure — the
 * caller decides how to surface results (build warnings, publish hard error).
 *
 * Errors (producers hard-error at build/deploy/push):
 * - `nothing-publishable` — an explicit publish list intersects declared to ∅.
 * - `default-not-publishable` — the effective default is excluded from the
 *   publishable set.
 *
 * Warnings:
 * - `invalid-language-entry` / `invalid-publish-language-entry` — non-string
 *   entries (dropped by normalization).
 * - `duplicate-language` — repeated codes (deduped).
 * - `dangling-publish-language` — listed but not declared (ignored at
 *   publish, preserved in the file/wire).
 *
 * @param {Object} [config] - Site config.
 * @returns {{ errors: {code: string, message: string}[],
 *             warnings: {code: string, message: string}[] }}
 */
export function validateLanguageConfig(config = {}) {
  const errors = []
  const warnings = []

  const inspectList = (value, field, entryCode) => {
    if (value == null) return
    if (value === '*') return // auto-discover wildcard (languages only)
    if (!Array.isArray(value)) {
      warnings.push({
        code: entryCode,
        message: `${field} must be a list of locale codes (got ${typeof value}) — ignored`
      })
      return
    }
    const seen = new Set()
    for (const entry of value) {
      if (entry === '*') continue // auto-discover wildcard marker, not a code
      const code = codeOf(entry)
      if (!code) {
        warnings.push({
          code: entryCode,
          message: `${field} entry ${JSON.stringify(entry)} is not a locale code string — dropped`
        })
        continue
      }
      if (typeof entry !== 'string') {
        warnings.push({
          code: entryCode,
          message: `${field} entry for '${code}' uses the legacy object form — use the plain string '${code}'`
        })
      }
      if (seen.has(code)) {
        warnings.push({ code: 'duplicate-language', message: `${field} lists '${code}' more than once — deduped` })
      }
      seen.add(code)
    }
  }

  inspectList(config?.languages, 'languages', 'invalid-language-entry')
  inspectList(config?.publishLanguages, 'publishLanguages', 'invalid-publish-language-entry')

  const { publishable, dangling, explicit } = resolvePublishableLocales(config)
  for (const code of dangling) {
    warnings.push({
      code: 'dangling-publish-language',
      message: `publishLanguages lists '${code}' but languages does not declare it — ignored at publish (kept in the file so a re-declared language keeps its publish intent)`
    })
  }

  if (explicit && publishable.length === 0) {
    errors.push({
      code: 'nothing-publishable',
      message: 'publishLanguages leaves no publishable language (empty list, or nothing it lists is declared) — a publishable default language is required'
    })
  } else if (explicit) {
    const defaultLocale = resolveDefaultLocale(config)
    if (!publishable.includes(defaultLocale)) {
      errors.push({
        code: 'default-not-publishable',
        message: `the default language '${defaultLocale}' is not in publishLanguages — the effective default must be publishable`
      })
    }
  }

  return { errors, warnings }
}
