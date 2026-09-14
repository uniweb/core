/**
 * Field paths — the ONE rule for which dotted keys the query language admits.
 *
 * A `where` key and a `sort` field name a field of the record, or a path into it:
 * `tenure.start`, `education.degree`. Every `.` is a step. ⭐ Two shapes are outside
 * the language on both lanes (the records service's rule, stated by backend on
 * 2026-09-14): a path with an **empty step** (`a..b`, `.a`, `a.`), and a path whose first
 * step starts with **`$`** (`$meta.x`). A single `$` field — `$name`, `$uuid` — is not a
 * path and stays a field. A `where` key outside the language selects no records; a
 * `sort` field outside it is refused where it is authored.
 *
 * Zero-dependency leaf: the where evaluator and the sort evaluator both read it.
 */

/**
 * Why a field key is outside the language, or null when it is inside.
 *
 * @param {string} key
 * @returns {string|null} the problem, as a sentence
 */
export function fieldPathProblem(key) {
  if (typeof key !== 'string' || key.indexOf('.') === -1) return null
  const steps = key.split('.')
  if (steps.some((step) => step === '')) {
    return `\`${key}\` has an empty step — a path is field names joined by single dots`
  }
  if (steps[0].startsWith('$')) {
    return `\`${key}\` starts with \`$\` — a path starts at one of the record's own fields`
  }
  return null
}
