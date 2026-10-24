/**
 * Escape a string for HTML text or a quoted attribute value — the one escaping a page's shell
 * (`./page-shell.js`) and a search result's snippet (`@uniweb/projections`) write by.
 *
 * Zero-dependency leaf.
 *
 * @param {*} str
 * @returns {string} `''` for a value that is empty or absent
 */
export function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
