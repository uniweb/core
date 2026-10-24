/**
 * A page's shell — the ONE writer of the HTML a page starts as, for a host that assembles pages:
 * the head (charset, viewport, title, icon, the foundation's stylesheet, the runtime's import map,
 * entry and preloads), an empty `#root`, and `__DATA__`. A host calls it through its own link for a
 * page it serves without rendering it, and inside an isolate (`@uniweb/runtime/ssr` re-exports it,
 * versioned with the runtime) as the shell `createPageRenderer` renders into.
 *
 * ⭐ Page assembly is framework's [Diego, 2026-10-23: a host is "supposed to do hosting right,
 * not rendering or page assembling. That's our job."]. A host hands in what only it knows — the
 * addresses it resolved and the content it read — and serves what comes back. ⛔ Until then each
 * host wrote its own shell, and one escaped `__DATA__` its own way, as invalid JSON, so no page
 * of the site it served could start.
 *
 * Its output is a function of its inputs only — no request, no clock — because a host caches it
 * under a key of publish-time facts, one entry serving a site's every hostname.
 *
 * Zero-dependency leaf, like `data-script.js`, which writes its `__DATA__`.
 */
import { dataScript, jsonForScript } from './data-script.js'
import { escapeHtml } from './escape-html.js'

// The escaping the shell writes by, exported beside it (`@uniweb/runtime/ssr` re-exports it from
// here).
export { escapeHtml }

/**
 * The MIME type of a favicon, by its file's extension — or null when unknown, and the `type`
 * attribute is then left out.
 *
 * @param {string} href
 * @returns {string|null}
 */
export function faviconType(href) {
  const ext = String(href || '').split('?')[0].split('.').pop()?.toLowerCase()
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'ico') return 'image/x-icon'
  if (ext === 'png') return 'image/png'
  return null
}

/**
 * A foundation's stylesheet, by the convention every foundation build follows: `…/entry.js` →
 * `…/assets/style.css`. The runtime's loader derives an extension's the same way.
 *
 * @param {string} url - the foundation's (or an extension's) entry
 * @returns {string|null}
 */
export function foundationCssUrl(url) {
  return typeof url === 'string' && url ? url.replace(/[^/]+\.js$/, 'assets/style.css') : null
}

/** A runtime file's address: its path in the manifest, on the runtime's base. */
function onBase(base, path) {
  return `${base.endsWith('/') ? base : `${base}/`}${String(path).replace(/^\/+/, '')}`
}

const extensionUrl = (entry) => (typeof entry === 'string' ? entry : entry?.url) || null

/**
 * The HTML a page starts as.
 *
 * @param {Object} input
 * @param {Object} input.content - one locale's content as the host stamped it: `config` (`name`,
 *   `favicon`, `activeLocale`, `extensions` — each extension's entry URL, in declared order), the
 *   pages, and any `fetchedData`
 * @param {string} [input.route] - the served page's route as the content names it, so a split
 *   site's `__DATA__` carries that page's sections (`dataScript`)
 * @param {{ url: string, cssUrl?: string }} input.foundation - the foundation's entry; its
 *   stylesheet is `foundationCssUrl(url)` unless given
 * @param {{ base: string, manifest: { entry: string, preloads?: string[], importMap?: Object } }}
 *   input.runtime - the runtime's base address, absolute, and its `manifest.json`
 * @returns {string}
 */
export function pageShell({ content, route = null, foundation, runtime }) {
  const config = content?.config || {}
  const manifest = runtime?.manifest || {}
  const base = runtime?.base || ''
  const cssUrl = foundation?.cssUrl || foundationCssUrl(foundation?.url)
  const extensions = (Array.isArray(config.extensions) ? config.extensions : []).map(extensionUrl).filter(Boolean)
  const importMap = Object.fromEntries(
    Object.entries(manifest.importMap || {}).map(([specifier, path]) => [specifier, onBase(base, path)])
  )
  const preloads = [
    ...(Array.isArray(manifest.preloads) ? manifest.preloads : []).map((path) => onBase(base, path)),
    foundation?.url,
    ...extensions,
  ].filter(Boolean)
  const lang = config.activeLocale

  const head = [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    config.name ? `<title>${escapeHtml(config.name)}</title>` : null,
    config.favicon
      ? `<link rel="icon"${faviconType(config.favicon) ? ` type="${faviconType(config.favicon)}"` : ''} href="${escapeHtml(config.favicon)}">`
      : null,
    cssUrl ? `<link rel="stylesheet" href="${escapeHtml(cssUrl)}">` : null,
    // Before the module script and every preload: a browser reads an import map only ahead of them.
    `<script type="importmap">${jsonForScript({ imports: importMap })}</script>`,
    manifest.entry ? `<script type="module" crossorigin src="${escapeHtml(onBase(base, manifest.entry))}"></script>` : null,
    ...preloads.map((href) => `<link rel="modulepreload" crossorigin href="${escapeHtml(href)}">`),
  ].filter(Boolean)

  return [
    '<!DOCTYPE html>',
    lang ? `<html lang="${escapeHtml(lang)}">` : '<html>',
    '<head>',
    ...head,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    dataScript({ foundation: { url: foundation?.url, cssUrl }, content }, { route, locale: lang }),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
