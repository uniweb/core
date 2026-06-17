/**
 * Canonical SEO / social-card shape.
 *
 * Shared by Website (site-level defaults) and Page (per-page), so the same
 * concept has the same shape at every level. Site `seo` cascades as the
 * default; a page overrides any field it sets (see Page.getHeadMeta).
 *
 * Field names are camelCase to match the framework's authored convention
 * (`defaultLanguage`, etc.). `changefreq`/`priority` are sitemap hints — only
 * meaningful per-page, but carried uniformly so the shape never drifts.
 *
 * @param {Object} [raw] - raw `seo:` block from site.yml / page.yml
 * @returns {{ noindex: boolean, image: string|null, ogTitle: string|null,
 *   ogDescription: string|null, canonical: string|null, changefreq: string|null,
 *   priority: (string|number)|null }}
 */
export function normalizeSeo(raw) {
  const seo = raw || {}
  return {
    noindex: seo.noindex || false,
    image: seo.image || null,
    ogTitle: seo.ogTitle || null,
    ogDescription: seo.ogDescription || null,
    canonical: seo.canonical || null,
    changefreq: seo.changefreq || null,
    priority: seo.priority || null,
  }
}
