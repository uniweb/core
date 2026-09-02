/**
 * The rich-form-schema predicate. One function, and deliberately only one.
 *
 * Rich schemas live under `data.schemas` in a component's meta.js. They drive
 * two author input paths that both land at `content.data[schema-id]`: tagged
 * markdown blocks (``` ```yaml:<id> ``` ```) and the editor's FormBlock widget.
 *
 * `isRichSchema` is a **dispatch** predicate — "is this already the rich shape?"
 * — and it is read at render by `runtime/src/prepare-props.js` (`applySchemas`)
 * and at build by `build/src/runtime-schema.js`. Both are on the hot path of
 * every site, which is what earns it a place in this package.
 *
 * ⛔ **Do not add editor-side schema code here.** `normalizeSchema` — "can this
 * be edited, and as what?" — sat beside this function until 2026-09-01 purely
 * because the two were adjacent; it never called `isRichSchema` and had no
 * consumer outside the editor. `@uniweb/core` loads on every site in every lane
 * and is not tree-shaken on the hosted one, so an editor-only function on its
 * entry is paid for by every visitor of every site. It now lives in the
 * zero-dependency leaf that owns what a data-schema *means*:
 * **`@uniweb/schemas/editor-form`**.
 *
 * Conditional field visibility (a rich-schema feature) is likewise editor-only
 * and is not implemented here — the editor owns its own evaluator.
 */

/**
 * Does a `data.schemas` entry look like a rich form schema?
 *
 * Rich schemas have an ordered `fields` array (composite arrays and
 * nested objects), distinct from simple keyed-object schemas used for
 * tagged blocks. Markers (any of):
 *   - `fields` is an array
 *   - `isComposite: true`
 *   - `childSchema` present
 *
 * @param {*} schema - Schema value to inspect.
 * @returns {boolean}
 */
export function isRichSchema(schema) {
  if (!schema || typeof schema !== 'object') return false
  if (Array.isArray(schema.fields)) return true
  if (schema.isComposite === true) return true
  if (schema.childSchema && typeof schema.childSchema === 'object') return true
  return false
}
