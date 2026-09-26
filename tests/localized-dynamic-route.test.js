/**
 * ⭐ A PARAMETRIC PAGE OF A LOCALIZED PAYLOAD IS FOUND BY ITS LOCALIZED URL.
 *
 * A published payload's pages carry each locale's own routes — `/noticias`, `/noticias/:slug` — where
 * the file lane's keep the canonical ones and add the translation map; `getPage` accepts both shapes.
 * A static page of either shape was found. A parametric one was matched on the canonical route only,
 * so on a backend-served site `/es/noticias/x` showed the not-found page without asking for its
 * record (measured 2026-09-26).
 */
import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

const RT = { es: { '/blog': '/noticias', '/blog/:slug': '/noticias/:slug' } }
const LIST = { query: 'articles', path: '/data/articles.json', as: 'articles' }

function site(pages) {
  return new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en', activeLocale: 'es', i18n: { routeTranslations: RT } },
      theme: {},
      pages: [{ route: '/', isIndex: true, title: 'Inicio', sections: [] }, ...pages],
    },
  })
}

describe('a parametric page reached by its localized URL', () => {
  it('⭐ in a payload whose routes are localized — as a backend publishes them', () => {
    const w = site([
      { route: '/noticias', title: 'Noticias', sections: [], fetch: LIST },
      { route: '/noticias/:slug', isDynamic: true, paramName: 'slug', title: 'Artículo', sections: [] },
    ])
    const page = w.getPage('/es/noticias/hola')
    expect(page).toBeTruthy()
    expect(page.route).toBe('/noticias/hola')
  })

  it('CONTROL — in a payload whose routes are canonical, as the file lane builds them', () => {
    const w = site([
      { route: '/blog', title: 'Blog', sections: [], fetch: LIST },
      { route: '/blog/:slug', isDynamic: true, paramName: 'slug', title: 'Article', sections: [] },
    ])
    const page = w.getPage('/es/noticias/hola')
    expect(page).toBeTruthy()
    expect(page.route).toBe('/blog/hola')
  })

  it('CONTROL — a URL no page matches is still not found', () => {
    const w = site([
      { route: '/noticias', title: 'Noticias', sections: [], fetch: LIST },
      { route: '/noticias/:slug', isDynamic: true, paramName: 'slug', title: 'Artículo', sections: [] },
    ])
    expect(w.getPage('/es/otra/hola')).toBeUndefined()
  })
})
