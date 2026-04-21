/**
 * Shared helpers for rich form schemas.
 *
 * Rich form schemas (as consumed by the FormBlock editor widget and the
 * runtime's `applySchemas`) can declare a `condition` on any field:
 *
 *   { id: 'department', type: 'text', condition: { for: 'scholar' } }
 *   { id: 'label',      type: 'text', condition: { for: { $in: ['a','b'] } } }
 *   { id: 'toggle',     type: 'checkbox' },
 *   { id: 'detail',     type: 'text', condition: { toggle: { $truthy: true } } }
 *
 * Semantics:
 *   - Object keys are AND'd together. All must match for the field to show.
 *   - Shorthand `{ key: value }` means strict equality (`$eq`).
 *   - Operator form `{ key: { $eq | $neq | $in | $nin | $truthy | $falsy: ... } }`.
 *
 * When no condition is present, the field is always visible.
 *
 * This evaluator is imported by both the editor (FormBlock UI) and the
 * runtime (`prepare-props` → `applySchemas`) so semantics stay in sync.
 */

/**
 * Evaluate a rich-schema field visibility condition against a row of data.
 *
 * @param {Object|undefined|null} condition - The `field.condition` object (or nothing).
 * @param {Object} row - The row of data to check (object keyed by field id).
 * @returns {boolean} - true when the field should be visible.
 */
export function evaluateCondition(condition, row) {
  if (!condition || typeof condition !== 'object') return true
  if (!row || typeof row !== 'object') return false

  for (const [key, spec] of Object.entries(condition)) {
    if (!checkOne(row[key], spec)) return false
  }
  return true
}

/**
 * Does a `data.schemas` entry look like a rich form schema?
 *
 * Rich schemas drive the FormBlock editor widget and participate in
 * runtime default-application / condition-stripping. Distinguishing markers
 * are any of:
 *   - `fields` is an array (ordered field list)
 *   - `isComposite: true`
 *   - `childSchema` present
 *
 * Simple keyed-object schemas (used for tagged markdown blocks) don't match.
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

function checkOne(value, spec) {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    for (const [op, arg] of Object.entries(spec)) {
      switch (op) {
        case '$eq':
          if (value !== arg) return false
          break
        case '$neq':
          if (value === arg) return false
          break
        case '$in':
          if (!Array.isArray(arg) || !arg.includes(value)) return false
          break
        case '$nin':
          if (!Array.isArray(arg) || arg.includes(value)) return false
          break
        case '$truthy':
          if (arg ? !value : !!value) return false
          break
        case '$falsy':
          if (arg ? !!value : !value) return false
          break
        default:
          // Unknown operator: treat as "not matched" so authors find the typo fast.
          return false
      }
    }
    return true
  }
  // Shorthand: implicit equality
  return value === spec
}
