import { describe, it, expect } from 'vitest'
import { jsonForScript, splitPageSections, dataScript } from '../src/data-script.js'

// What a browser does with a `<script id="__DATA__">`: take the element's text, parse it as JSON.
const elementText = (html) => html.match(/^<script id="__DATA__" type="application\/json">([\s\S]*)<\/script>$/)[1]

describe('jsonForScript — JSON a <script> element can carry', () => {
  it('escapes every < as \\u003c, and parses back to the same value', () => {
    const value = { text: '<!-- note --> and </script><script>alert(1)</script>' }
    const text = jsonForScript(value)
    expect(text).not.toContain('<')
    expect(JSON.parse(text)).toEqual(value)
  })

  it('CONTROL — the JavaScript-string escape is not JSON: `<\\!--` does not parse', () => {
    expect(() => JSON.parse('{"text":"<\\!-- note -->"}')).toThrow()
  })
})

const PAGES = [
  { route: '/', hasContent: true, sections: [{ id: 'hero' }] },
  { route: '/docs', hasContent: false, sections: [] },
  { route: '/docs/intro', sections: [{ id: 'intro' }] },
  { route: '/blog/:slug', isDynamic: true, hasContent: true, sections: [{ id: 'article' }] },
]

describe('splitPageSections — one page’s sections, every page’s entry', () => {
  it('keeps the served page’s sections and every dynamic template’s, and drops the rest', () => {
    const pages = splitPageSections(PAGES, '/')
    expect(pages.map((p) => p.route)).toEqual(PAGES.map((p) => p.route))
    expect(pages[0].sections).toEqual([{ id: 'hero' }])
    expect('sections' in pages[2]).toBe(false)
    expect(pages[3].sections).toEqual([{ id: 'article' }])
  })

  it('a page whose sections leave says hasContent, so it is not taken for an empty folder', () => {
    const pages = splitPageSections(PAGES, '/')
    expect(pages[2].hasContent).toBe(true) // it had sections and no flag
    expect(pages[1].hasContent).toBe(false) // the flag it carried stands
  })

  it('a page that cannot be fetched keeps its sections inline', () => {
    const pages = splitPageSections(PAGES, '/', { fetchable: (page) => page.route !== '/docs/intro' })
    expect(pages[2].sections).toEqual([{ id: 'intro' }])
  })
})

describe('dataScript — the __DATA__ element a host writes', () => {
  const foundation = { url: 'https://cdn.test/f/entry.js', cssUrl: 'https://cdn.test/f/style.css' }
  const content = (config = {}) => ({
    config: { activeLocale: 'en', ...config },
    pages: [
      { route: '/', sections: [{ id: 'hero', content: { text: 'see <!-- this --> and </script>' } }] },
      { route: '/docs/intro', sections: [{ id: 'intro' }] },
    ],
  })

  it('is a script element whose text parses as the payload, whatever the content holds', () => {
    const html = dataScript({ foundation, content: content() }, { route: '/' })
    const parsed = JSON.parse(elementText(html))
    expect(parsed.foundation).toEqual(foundation)
    expect(parsed.content.pages[0].sections[0].content.text).toBe('see <!-- this --> and </script>')
  })

  it('carries every page’s sections while the content names no addresses for them', () => {
    const parsed = JSON.parse(elementText(dataScript({ foundation, content: content() }, { route: '/' })))
    expect(parsed.content.pages[1].sections).toEqual([{ id: 'intro' }])
  })

  it('carries only the served page’s sections when config.pageHashes names where the others are', () => {
    const split = content({ pageHashes: { en: { '/': '/_pages/index.a1.json', '/docs/intro': '/_pages/docs/intro.b2.json' } } })
    const parsed = JSON.parse(elementText(dataScript({ foundation, content: split }, { route: '/' })))
    expect(parsed.content.pages[0].sections).toHaveLength(1)
    expect('sections' in parsed.content.pages[1]).toBe(false)
    expect(parsed.content.pages[1].hasContent).toBe(true)
    expect(parsed.content.config.pageHashes).toEqual(split.config.pageHashes)
  })

  it('CONTROL — addresses for another locale split nothing', () => {
    const split = content({ pageHashes: { fr: { '/docs/intro': '/_pages/fr/docs/intro.c3.json' } } })
    const parsed = JSON.parse(elementText(dataScript({ foundation, content: split }, { route: '/' })))
    expect(parsed.content.pages[1].sections).toEqual([{ id: 'intro' }])
  })
})
