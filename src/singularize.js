/**
 * Singularize a plural schema name
 *
 * Converts common English plural forms to singular.
 * Used by EntityStore to derive singular keys (e.g., 'articles' → 'article').
 *
 * @param {string} name - Plural name
 * @returns {string} Singular form
 */
export default function singularize(name) {
  if (!name) return name
  // Common irregular plurals
  const irregulars = {
    people: 'person',
    children: 'child',
    men: 'men',
    women: 'woman',
    series: 'series',
  }
  if (irregulars[name]) return irregulars[name]
  // -ies → -y (categories → category)
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y'
  // -es endings that should only remove 's' (not 'es')
  // e.g., articles → article, courses → course
  if (name.endsWith('es')) {
    // Check if the base word ends in a consonant that requires 'es' plural
    // (boxes, dishes, classes, heroes) vs just 's' plural (articles, courses)
    const base = name.slice(0, -2)
    const lastChar = base.slice(-1)
    // If base ends in s, x, z, ch, sh - these need 'es' for plural, so remove 'es'
    if (['s', 'x', 'z'].includes(lastChar) || base.endsWith('ch') || base.endsWith('sh')) {
      return base
    }
    // Otherwise just remove 's' (articles → article)
    return name.slice(0, -1)
  }
  // Regular -s plurals
  if (name.endsWith('s')) return name.slice(0, -1)
  return name
}
