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

/**
 * Normalize any authored `data:` schema shape to the rich form the editor
 * renders, or null when it is not a single form at all.
 *
 * WHY THIS EXISTS. `isRichSchema` answers "is this already the rich shape?",
 * which is the right question for dispatch and the wrong one for "can this be
 * edited". There are THREE authored shapes and it accepts exactly one:
 *
 *   { fields: [ {id, …} ] }        meta.js inline rich-form      → true
 *   { fields: { name: spec } }     a RESOLVED NAMED REF          → FALSE
 *   { name: spec }                 meta.js inline field map      → false
 *
 * The middle row is the important one and the reason this helper is in `core`
 * rather than in the editor. A named ref (`'@/article'`, `'@std/person'`) is the
 * FIRST authoring form the docs show, and `validateAndNormalizeSchema` in the
 * build resolves it to `{ fields: <MAP> }` — a map, not an array. So filtering
 * with `isRichSchema` discards not merely "simple" schemas but the primary
 * documented one, and any consumer that wants to render it has to re-derive the
 * conversion. Three consumers re-deriving it is exactly the divergence the
 * shared predicate was introduced to prevent.
 *
 * A field map is an unordered `fields[]`, so the conversion is mechanical.
 * Ordering comes from `Object.entries`, which is insertion order for string keys
 * — i.e. the order the author wrote, which is the order a form should show.
 *
 * `sections` returns null on purpose: a sectioned data-schema describes a Model
 * with several sections, which is not one form. Flattening it would invent a
 * layout the author never expressed.
 *
 * @param {*} schema - any authored or resolved `data:` schema value
 * @returns {{ fields: Array<object> } | null} the rich shape, or null
 */
export function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return null

  // Already rich — hand back untouched. Composite/childSchema variants are rich
  // by `isRichSchema`'s definition and are not ours to reshape.
  if (Array.isArray(schema.fields)) return schema
  if (schema.isComposite === true || schema.childSchema) return schema

  // A sectioned Model is not a single form.
  if (schema.sections !== undefined) return null

  const mapToFields = (map) =>
    Object.entries(map).map(([id, spec]) =>
      typeof spec === 'string' ? { id, type: spec } : { id, ...spec }
    )

  // A resolved named ref: `fields` present, as a map.
  if (schema.fields && typeof schema.fields === 'object') {
    const { fields, ...rest } = schema
    return { ...rest, fields: mapToFields(fields) }
  }

  // An inline field map: no `fields` key, so every value must be an OBJECT
  // carrying `type`.
  //
  // The bare-type string shorthand (`{ cpu: 'string' }`) is deliberately NOT
  // accepted here, even though schema FILES support it. Without a `fields` key
  // there is nothing to distinguish it from ordinary data: `{ name: 'Acme' }` and
  // `{ cpu: 'string' }` are the same shape, and an earlier cut of this function
  // turned `{ name, description }` into a two-field form. Erring toward null
  // costs an author the object spelling; erring the other way invents a form out
  // of a config block.
  const entries = Object.entries(schema)
  if (!entries.length) return null
  const isFieldSpec = ([, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) && v.type !== undefined
  if (!entries.every(isFieldSpec)) return null
  return { fields: mapToFields(schema) }
}
