/**
 * Substitute `{name}` placeholders in strings (or throughout an object tree)
 * using a flat context map. Used in two places:
 *
 *   - URL templates for detail queries: `detail: '/articles/{slug}'` gets
 *     `slug` resolved from the dynamic-route context. Encoding ON.
 *
 *   - POST `body:` objects where a field carries a route-param reference:
 *     `body: { variables: { slug: "{slug}" } }`. Encoding OFF — values go
 *     into JSON as-is.
 *
 * Behavior:
 *   - Matches `{name}` where `name` is `[A-Za-z_][A-Za-z0-9_]*`. This keeps
 *     the substitution *strict* so literal `{` / `}` elsewhere (notably
 *     GraphQL selection sets like `{ field }`) don't accidentally match.
 *     A whitespace inside the braces disqualifies the match.
 *   - Only keys actually present in `context` substitute. Unknown keys
 *     pass through unchanged, preserving the literal `{name}`.
 *   - Encoding uses `encodeURIComponent` when `encode: true`.
 *   - Object/array recursion is structural; primitives other than strings
 *     pass through. Returns a new object tree; input is not mutated.
 */

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * @param {*} value - The tree (string, object, array, primitive) to walk.
 * @param {Record<string, string|number>} context - Name → value map. Missing
 *   keys leave the placeholder literal in place.
 * @param {Object} [options]
 * @param {boolean} [options.encode=true] - When true, `encodeURIComponent` the
 *   substituted value. Turn off for JSON-body substitution where the value
 *   will be serialized by JSON.stringify.
 * @returns {*} New tree with substitutions applied.
 */
export function substitutePlaceholders(value, context, options = {}) {
  const { encode = true } = options

  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_RE, (literal, key) => {
      if (!(key in (context || {}))) return literal
      const raw = context[key]
      if (raw === undefined || raw === null) return literal
      return encode ? encodeURIComponent(String(raw)) : String(raw)
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => substitutePlaceholders(item, context, options))
  }

  if (value && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value)) {
      result[key] = substitutePlaceholders(value[key], context, options)
    }
    return result
  }

  return value
}

export default substitutePlaceholders
