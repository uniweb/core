/**
 * The DOM id of a rendered section — one rule, shared by everything that
 * needs to name a section.
 *
 * A section's id is written by the renderer and read by anything that links
 * to a section: the search index's anchors, a table of contents, a deep link
 * someone pastes. Those only agree if they derive the id the same way, and
 * they cannot check each other — a mismatch produces no error anywhere. The
 * link simply lands on the page and does not scroll, and if the target is the
 * page you are already on, nothing visibly happens at all.
 *
 * That is not hypothetical. The renderers moved from the positional `id` to
 * `stableId` (so an id survives reordering) and the search extractor was not
 * updated, so it kept emitting `Section1` while the DOM said
 * `section-what-is-uniweb`. Every section-level search result on every site
 * pointed at a fragment that did not exist, and no test failed.
 *
 * So this is deliberately the ONLY place the rule is written down, and it
 * captures both halves — which identity to use AND how to spell it. A helper
 * that only formatted a value the caller picked would have prevented the
 * spelling half of that bug and none of the identity half.
 *
 * **Zero imports, and it must stay that way.** `@uniweb/projections` consumes
 * this through the leaf subpath `@uniweb/core/section-id` because its
 * environment contract forbids the bare `@uniweb/core` entry (that pulls in
 * semantic-parser and theming). Adding an import here would break that
 * package's `tests/environment.test.js`.
 */

/** Prefix for every section wrapper id. */
const PREFIX = 'section-'

/**
 * The DOM id for a section, from either a Block or the raw section data.
 *
 * Accepts both shapes on purpose: the runtime holds `Block` instances while
 * build-time consumers hold plain objects off the wire. Both carry the same
 * two fields, so one function serves both rather than each growing its own.
 *
 * `stableId` is preferred because it is derived from the section's filename
 * (or an authored `id:`) and therefore survives reordering; the positional
 * `id` is the fallback for content that has no stable identity.
 *
 * @param {{stableId?: string, id?: string|number}} section - A Block, or a
 *   section object from site content.
 * @returns {string} e.g. `section-hero`. Returns `section-unknown` rather
 *   than an id ending in `undefined` when a section carries no identity at
 *   all — a wrong-but-obvious anchor beats a malformed one.
 */
export function sectionDomId(section) {
  if (!section) return `${PREFIX}unknown`
  const id = section.stableId || section.id
  return `${PREFIX}${id === undefined || id === null || id === '' ? 'unknown' : id}`
}

/**
 * The same id as a URL fragment, for building a link to a section.
 *
 * Exists so a caller composing an href never has to remember whether the
 * `#` is already included — the concatenation is the part people get wrong.
 *
 * @param {{stableId?: string, id?: string|number}} section
 * @returns {string} e.g. `#section-hero`
 */
export function sectionHash(section) {
  return `#${sectionDomId(section)}`
}
