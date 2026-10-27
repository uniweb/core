import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pageShell, pageShellFingerprint, foundationCssUrl, faviconType, escapeHtml } from '../src/page-shell.js'
import { PAGE_SHELL_VECTORS } from '../src/page-shell-vectors.js'

// One locale's content, as a host stamps it, and the inputs only a host holds.
const content = (config = {}, pages = [{ route: '/', sections: [{ id: 'hero' }] }]) => ({
  config: { name: 'Uniweb', favicon: '/favicon.svg', activeLocale: 'en', base: '/', ...config },
  pages,
})
const input = (config, pages) => ({
  content: content(config, pages),
  route: '/',
  foundation: { url: 'https://assets.test/foundations/acme/site/1.0.0/entry.js' },
  runtime: {
    base: 'https://cdn.test/runtime/1.1.15/',
    manifest: {
      entry: 'assets/index-AAA.js',
      preloads: ['assets/setup-BBB.js', 'assets/react-CCC.js'],
      importMap: { react: '_importmap/react.js', '@uniweb/core': '_importmap/core.js' },
    },
  },
})

const lines = (html) => html.split('\n')
const dataOf = (html) => JSON.parse(html.match(/<script id="__DATA__" type="application\/json">([\s\S]*?)<\/script>/)[1])

describe('pageShell — the HTML a page starts as', () => {
  it('writes the head, an empty root and __DATA__, in the order a host has served them', () => {
    const html = pageShell(input())
    expect(lines(html)).toEqual([
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>Uniweb</title>',
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
      '<link rel="stylesheet" href="https://assets.test/foundations/acme/site/1.0.0/assets/style.css">',
      '<script type="importmap">{"imports":{"react":"https://cdn.test/runtime/1.1.15/_importmap/react.js","@uniweb/core":"https://cdn.test/runtime/1.1.15/_importmap/core.js"}}</script>',
      '<script type="module" crossorigin src="https://cdn.test/runtime/1.1.15/assets/index-AAA.js"></script>',
      '<link rel="modulepreload" crossorigin href="https://cdn.test/runtime/1.1.15/assets/setup-BBB.js">',
      '<link rel="modulepreload" crossorigin href="https://cdn.test/runtime/1.1.15/assets/react-CCC.js">',
      '<link rel="modulepreload" crossorigin href="https://assets.test/foundations/acme/site/1.0.0/entry.js">',
      '</head>',
      '<body>',
      '<div id="root"></div>',
      expect.stringMatching(/^<script id="__DATA__" type="application\/json">/),
      '</body>',
      '</html>',
      '',
    ])
  })

  it('carries the stylesheet the head links — byte for byte — in __DATA__, so the runtime does not load it twice', () => {
    const html = pageShell(input())
    const data = dataOf(html)
    expect(data.foundation).toEqual({
      url: 'https://assets.test/foundations/acme/site/1.0.0/entry.js',
      cssUrl: 'https://assets.test/foundations/acme/site/1.0.0/assets/style.css',
    })
    expect(html).toContain(`<link rel="stylesheet" href="${data.foundation.cssUrl}">`)
  })

  it('preloads each extension after the foundation, in declared order, from config.extensions', () => {
    const html = pageShell(input({ extensions: ['https://x.test/a/entry.js', { url: 'https://x.test/b/entry.js' }] }))
    const preloads = lines(html).filter((l) => l.includes('modulepreload')).map((l) => l.match(/href="([^"]+)"/)[1])
    expect(preloads.slice(-3)).toEqual([
      'https://assets.test/foundations/acme/site/1.0.0/entry.js',
      'https://x.test/a/entry.js',
      'https://x.test/b/entry.js',
    ])
  })

  it('escapes what an author wrote where it lands — the name as text, the icon as an attribute', () => {
    const html = pageShell(input({ name: 'A <b>&</b> "site"', favicon: '/i.png?a="1"&b=2' }))
    expect(html).toContain('<title>A &lt;b&gt;&amp;&lt;/b&gt; &quot;site&quot;</title>')
    expect(html).toContain('<link rel="icon" type="image/png" href="/i.png?a=&quot;1&quot;&amp;b=2">')
  })

  it('links the touch icon a config names, after the favicon', () => {
    const order = lines(pageShell(input({ touchIcon: 'https://assets.test/t.png?a="1"' })))
    const icon = order.indexOf('<link rel="icon" type="image/svg+xml" href="/favicon.svg">')
    expect(order[icon + 1]).toBe('<link rel="apple-touch-icon" href="https://assets.test/t.png?a=&quot;1&quot;">')
  })

  it('writes no tag for a name or an icon the config does not have', () => {
    const html = pageShell(input({ name: undefined, favicon: undefined }))
    expect(html).not.toContain('<title>')
    expect(html).not.toContain('rel="icon"')
    expect(html).not.toContain('rel="apple-touch-icon"')
  })

  it('puts the import map before the module script and every preload', () => {
    const order = lines(pageShell(input()))
    const map = order.findIndex((l) => l.startsWith('<script type="importmap">'))
    const first = order.findIndex((l) => l.startsWith('<script type="module"') || l.includes('modulepreload'))
    expect(map).toBeGreaterThan(-1)
    expect(map).toBeLessThan(first)
  })

  it('gives the same bytes for the same inputs — one cache entry serves every hostname', () => {
    expect(pageShell(input())).toBe(pageShell(input()))
  })

  it('writes __DATA__ that parses whatever the content holds, and splits it when the content says where pages are', () => {
    const pages = [
      { route: '/', sections: [{ text: '<!-- a --> </script>' }] },
      { route: '/docs', sections: [{ text: 'docs' }] },
    ]
    const whole = dataOf(pageShell(input({}, pages)))
    expect(whole.content.pages[1].sections).toEqual([{ text: 'docs' }])
    const split = dataOf(pageShell(input({ pageHashes: { en: { '/docs': '/_pages/d.json' } } }, pages)))
    expect(split.content.pages[0].sections).toEqual([{ text: '<!-- a --> </script>' }])
    expect('sections' in split.content.pages[1]).toBe(false)
  })
})

describe('pageShellFingerprint — it changes when the pages the shell writes change, and only then', () => {
  // ⛔ A host keys its cache on this value, so a new one renders every page it cached again. When
  // this fails, the HTML pageShell writes has changed: check that you meant it, then pin the new
  // value here.
  it('is pinned, so a change to the pages it writes is seen in review', () => {
    expect(pageShellFingerprint()).toBe('a9b61ada')
  })

  it('is the same on every call', () => {
    expect(pageShellFingerprint()).toBe(pageShellFingerprint())
  })

  it('renders vectors that are each a different page, with a __DATA__ that parses', () => {
    const pages = PAGE_SHELL_VECTORS.map((vector) => pageShell(vector))
    expect(new Set(pages).size).toBe(PAGE_SHELL_VECTORS.length)
    for (const html of pages) expect(() => dataOf(html)).not.toThrow()
  })

  it('reaches every branch pageShell can take, so no page is left out of the fingerprint', () => {
    // A branch no vector reaches is a page whose change the fingerprint cannot see: give it a
    // vector (`page-shell-vectors.js`). What may stay unexecuted is the three defaults pageShell
    // never takes — an empty value to escape or to type, and a split with no `fetchable`.
    const script = fileURLToPath(new URL('./page-shell-coverage.mjs', import.meta.url))
    const shell = new URL('../src/page-shell.js', import.meta.url).href
    const unexecuted = JSON.parse(execFileSync(process.execPath, [script, shell], { encoding: 'utf8' }))
    expect(unexecuted.sort()).toEqual([
      "data-script.js: () => true",
      "page-shell.js: return ''",
      "page-shell.js: || ''",
    ])
  })
})

describe('the conventions it holds', () => {
  it('foundationCssUrl: entry.js → assets/style.css', () => {
    expect(foundationCssUrl('https://a.test/f/1.0.0/entry.js')).toBe('https://a.test/f/1.0.0/assets/style.css')
    expect(foundationCssUrl('/foundations/f/entry.js')).toBe('/foundations/f/assets/style.css')
    expect(foundationCssUrl(null)).toBeNull()
  })

  it('faviconType: by the file extension, null when unknown', () => {
    expect(faviconType('/a.svg')).toBe('image/svg+xml')
    expect(faviconType('/a.ICO?v=2')).toBe('image/x-icon')
    expect(faviconType('/a.png')).toBe('image/png')
    expect(faviconType('/a.webp')).toBeNull()
  })

  it('escapeHtml: text and double- or single-quoted attributes', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    expect(escapeHtml(null)).toBe('')
  })
})
