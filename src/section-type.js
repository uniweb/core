/**
 * Section types — the ONE rule for what renders a section that names none.
 *
 * A section names the section type that renders it (`type: Hero` in its file's
 * frontmatter). One that names none renders with the foundation's `defaultSection`,
 * else `Section`. The site's object graph asks this when it builds a Block
 * (`Website.getDefaultBlockType`), and a push asks it for the type a store requires
 * of every section — so a host rendering what the store holds renders what the
 * site's files render. ⛔ Until 2026-10-23 a push sent `Content` for such a section,
 * which no starter template's foundation has, and a hosted page showed
 * "Component not found: Content" where the files rendered `Section`.
 *
 * Zero-dependency leaf, like `layout-name.js`: the build imports it, and should not
 * pull more of core to agree on a type.
 */

/** What renders a section when neither it nor its foundation names a type. */
export const DEFAULT_SECTION_TYPE = 'Section'

/**
 * The type a section that names none renders with: the foundation's
 * `defaultSection`, else `Section`.
 *
 * @param {Object|null|undefined} foundation - the foundation's declarations: its
 *   `main.js` default export, its schema's `_self`, or the runtime's foundation config
 * @returns {string}
 */
export function defaultSectionType(foundation) {
  const declared = foundation?.defaultSection
  return typeof declared === 'string' && declared ? declared : DEFAULT_SECTION_TYPE
}
