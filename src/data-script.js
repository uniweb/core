/**
 * The data a page's shell carries — the ONE rule for writing it, for every lane that writes a
 * shell: a static build (`__SITE_CONTENT__`) and a host that assembles one per request
 * (`__DATA__`, `{ foundation, content }`, which the runtime reads in `decodeData`).
 *
 * Two jobs, both easy to get subtly wrong in a copy:
 *
 * 1. ⭐ JSON INSIDE A `<script>` ESCAPES EVERY `<` AS `<`. A `<script>` element's text ends at
 *    `</script` and changes state at `<!--`, so either inside a string value would break the page;
 *    `<` is a JSON escape, so the text still parses as the same value. ⛔ A JavaScript-string
 *    escape is not a JSON one: `<\!--` keeps the HTML parser calm and makes the whole payload
 *    invalid JSON. Measured 2026-10-23 on a hosted site, whose every page then stayed its server
 *    render with no client app.
 *
 * 2. ⭐ SPLIT CONTENT CARRIES ONE PAGE'S SECTIONS. When a site's content is split, a page's data
 *    keeps every page's entry but only its own sections and every dynamic template's, which a
 *    route's record page is built from. Every other page's sections are fetched when the page is
 *    visited (`Page.loadContent`), from the address `config.pageHashes[locale][route]` names on a
 *    host, or `_pages/<route>.json` in a static build. A page whose sections leave says
 *    `hasContent`, so it is not taken for an empty folder.
 *
 * Zero-dependency leaf: the build imports it, and a host reaches it through `@uniweb/runtime/ssr`.
 */

/**
 * A value as JSON text that can sit inside a `<script>` element: every `<` as `<`.
 *
 * @param {*} value
 * @returns {string}
 */
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * The pages a split page's data carries: every entry, with sections only for the page being served
 * and for every dynamic template. A page whose sections leave says `hasContent`.
 *
 * @param {Array<Object>} pages - the site content's `pages`
 * @param {string|null} route - the route of the page being served
 * @param {Object} [options]
 * @param {(page: Object) => boolean} [options.fetchable] - whether a page's sections can be fetched
 *   when it is visited; a page whose cannot keeps them inline
 * @returns {Array<Object>}
 */
export function splitPageSections(pages, route, { fetchable = () => true } = {}) {
  return pages.map((page) => {
    if (page.route === route || page.isDynamic || !Array.isArray(page.sections) || !fetchable(page)) {
      return page
    }
    const { sections, ...entry } = page
    return { ...entry, hasContent: entry.hasContent ?? sections.length > 0 }
  })
}

/**
 * The `<script id="__DATA__">` element a host writes into a page's shell — the boot payload
 * `{ foundation, content }`, as JSON a `<script>` cannot end or misparse (`jsonForScript`).
 *
 * When the content names where each page's sections are served — `content.config.pageHashes`,
 * per locale — it carries only the served page's sections and every dynamic template's
 * (`splitPageSections`); a page with no address keeps its sections inline. Without that map it
 * carries the content as it is.
 *
 * @param {{ foundation: Object, content: Object }} data
 * @param {Object} [options]
 * @param {string} [options.route] - the route of the page being served, as the content names it (a
 *   dynamic page's own template route for one of its records)
 * @param {string} [options.locale] - the locale the content is for; by default its `activeLocale`
 * @returns {string}
 */
export function dataScript({ foundation, content }, { route = null, locale } = {}) {
  const addresses = content?.config?.pageHashes?.[locale ?? content?.config?.activeLocale]
  const carried =
    addresses && Array.isArray(content.pages)
      ? {
          ...content,
          pages: splitPageSections(content.pages, route, { fetchable: (page) => Boolean(addresses[page.route]) }),
        }
      : content
  return `<script id="__DATA__" type="application/json">${jsonForScript({ foundation, content: carried })}</script>`
}
