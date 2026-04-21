/**
 * Shared helpers for rich form schemas.
 *
 * Rich schemas live under `data.schemas` in a component's meta.js. They
 * drive two author input paths that both land at `content.data[schema-id]`:
 *
 *   1. Tagged markdown blocks (``` ```yaml:<id> ``` ```)
 *   2. The FormBlock editor widget
 *
 * Detection is shared across the build pipeline (emit path), the runtime
 * (dispatch in applySchemas), and the editor (filter for FormBlock menu)
 * so all three agree on what counts as a rich schema.
 *
 * Conditional field visibility (a rich-schema feature) is an editor-only
 * concern and is not implemented here — the editor owns its own evaluator.
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
