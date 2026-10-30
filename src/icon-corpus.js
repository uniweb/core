/**
 * The icon corpus — its default origin and its filename rule.
 *
 * ## Why this is one module and not five constants
 *
 * An icon referenced by `library` + `name` is **our own asset**, not the site's.
 * We publish the families, we document them, and `@uniweb/icons`'
 * `scripts/build-cdn.js` writes the files. So unlike a site asset — whose URL
 * pattern the HOST declares because the bytes are in the host's store — the
 * layout here is ours to name, and a default origin is the correct answer
 * rather than a guessed one.
 *
 * That makes this a **writer/reader pair**, which is the part that needs a
 * single definition:
 *
 *   writer   @uniweb/icons scripts/build-cdn.js   emits cdn/{family}/{family}-{name}.svg
 *   readers  @uniweb/runtime setup.js             browser resolution
 *            @uniweb/runtime ssr-renderer.js      prerender + Worker isolate prefetch
 *            @uniweb/icons  src/resolver.js       local-then-CDN resolution
 *
 * Before 2026-08-17 the origin was spelled out in three of those and the
 * filename rule in all four. A writer and its readers drifting is the exact
 * defect `@uniweb/core/route-match` exists to prevent, and the one the runtime
 * channel's bridge-filename helper prevents by construction. Same treatment
 * here: one helper, no second spelling.
 *
 * ## ⛔ Keep this a LEAF — zero imports
 *
 * `ssr-renderer.js` is bundled into the SSR isolate that runs in a Cloudflare
 * Worker, so anything it reaches must import nothing: no `node:*`, no DOM, no
 * `@uniweb/core` root (which pulls semantic-parser and theming). That is the
 * same constraint `route-match` and `locale-config` carry, and the reason this
 * lives in core rather than in `@uniweb/icons` — a Worker cannot take a package
 * whose value is ~3,200 icon modules behind a dynamic import, and `@uniweb/runtime`
 * depends on core already.
 *
 * A host may override the ORIGIN — a mirror of this corpus is a legitimate
 * deployment choice, and on a hosted site the base comes from the payload the
 * host serves. It may not override the LAYOUT: a mirror mirrors. Re-deriving
 * filenames instead of copying them is what produced two incompatible spellings
 * of the same corpus once already.
 *
 * @module @uniweb/core/icon-corpus
 */

/**
 * Where the framework publishes its own icon corpus.
 *
 * Not a fallback for a missing host address — it is the address of OUR artifact,
 * and it is what makes `![](lu-house)` work in a project with no backend at all.
 * A host that mirrors the corpus supplies its own origin on the payload.
 */
export const DEFAULT_ICON_BASE = 'https://uniweb.github.io/icons'

/**
 * The family code for each name a library goes by, friendly or short: what an address is built from.
 * A library that is not here has no address, and its icon resolves to nothing.
 */
export const ICON_FAMILY_MAP = {
  lucide: 'lu',
  heroicons: 'hi',
  heroicons2: 'hi2',
  phosphor: 'pi',
  tabler: 'tb',
  feather: 'fi',
  fa: 'fa',
  fa6: 'fa6',
  bootstrap: 'bs',
  'material-design': 'md',
  'ant-design': 'ai',
  remix: 'ri',
  'simple-icons': 'si',
  ionicons: 'io5',
  boxicons: 'bi',
  vscode: 'vsc',
  weather: 'wi',
  game: 'gi',
  lu: 'lu',
  hi: 'hi',
  hi2: 'hi2',
  pi: 'pi',
  tb: 'tb',
  fi: 'fi',
  bs: 'bs',
  md: 'md',
  ai: 'ai',
  ri: 'ri',
  io5: 'io5',
  bi: 'bi',
  si: 'si',
  vsc: 'vsc',
  wi: 'wi',
  gi: 'gi',
}

/**
 * Families whose own sites spell a digit off by a hyphen (Lucide's `building-2` and `grid-2x2`,
 * Heroicons' `bars-3`, Feather's `bar-chart-2`), where the corpus, named after react-icons, does
 * not (`building2`, `grid2-x2`, `bars3`, `bar-chart2`). An author copies a name from the family's
 * site, so for these the corpus answers that spelling too.
 *
 * ⛔ Only families the rule leaves every corpus name of unchanged, since the writer composes its
 * paths with it too. Material's `3d-rotation` and Tabler's `cube3d-sphere` keep a letter after a
 * digit unhyphenated, so the rule would move them. `_contracts/icon-corpus-names.test.js` holds
 * these four to it, over every name their manifests list.
 */
const UPSTREAM_SPELLED = new Set(['lu', 'hi', 'hi2', 'fi'])

/**
 * An icon's name as the corpus spells it. In a family above, a digit takes no hyphen before it,
 * and a letter after a digit takes one: `building-2` → `building2`, `grid-2x2` → `grid2-x2`. A
 * name the corpus already spells comes back unchanged.
 *
 * ⛔ *Until 2026-10-24 a name was taken as written, so the 107 Lucide icons whose names hold a
 * digit answered 404 to the spelling on Lucide's own site.*
 *
 * @param {string} family - short family code
 * @param {string} name - icon id as written
 * @returns {string}
 */
export function corpusIconName(family, name) {
  const written = String(name ?? '')
  if (!UPSTREAM_SPELLED.has(family)) return written
  return written.replace(/-(?=\d)/g, '').replace(/(\d)([a-z])/g, '$1-$2')
}

/**
 * The corpus path for one icon, relative to any origin serving it.
 *
 * `{family}/{family}-{name}.svg` — the family repeats deliberately: the
 * directory groups, and the filename prefix keeps ids unique across families so
 * a name alone is never ambiguous. The name is the corpus's spelling of it
 * (`corpusIconName`).
 *
 * @param {string} family - short family code (`lu`, `hi2`, `fa6`)
 * @param {string} name - icon id within that family (`house`, `a-arrow-down`)
 * @returns {string} e.g. `lu/lu-house.svg`
 */
export function iconPath(family, name) {
  return `${family}/${family}-${corpusIconName(family, name)}.svg`
}

/**
 * The full URL for one icon against a serving origin.
 *
 * @param {string} family - short family code
 * @param {string} name - icon id within that family
 * @param {string} [base] - serving origin; defaults to the framework's own
 * @returns {string}
 */
export function iconUrl(family, name, base = DEFAULT_ICON_BASE) {
  return `${String(base).replace(/\/+$/, '')}/${iconPath(family, name)}`
}
