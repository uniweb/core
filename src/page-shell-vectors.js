/**
 * The inputs `pageShellFingerprint` renders (`page-shell.js`). Together they reach every branch of
 * `pageShell` and of the `__DATA__` it writes (`dataScript`, `splitPageSections`), so a change to
 * the HTML for any input changes the fingerprint.
 *
 * ⭐ A branch added to `pageShell`, to `data-script.js` or to a helper they call takes a vector here
 * in the same commit. Adding one changes the fingerprint, which is what a new branch needs: a page
 * cached before it was written without it.
 *
 * ⛔ Editing a vector changes the fingerprint too, and a host that keys its cache on it renders
 * every page it cached again. Change one only to reach a branch.
 *
 * Pure data, so a bundle that never calls `pageShellFingerprint` leaves it out — the runtime's
 * browser build, which imports `foundationCssUrl` from `page-shell.js`, carries none of it.
 */
export const PAGE_SHELL_VECTORS = [
  // The least a host passes: no name, icon, locale, extensions, entry or preloads.
  {
    content: { config: {}, pages: [{ route: '/', sections: [] }] },
    foundation: { url: '/f/entry.js' },
    runtime: { base: '', manifest: {} },
  },

  // Every part of the head, and text an author wrote that must be escaped where it lands.
  {
    content: {
      config: {
        name: `Café & "Co" <Ltd>'s`,
        favicon: '/favicon.svg?v=2',
        touchIcon: '/touch-icon.png?a="1"',
        activeLocale: 'fr',
        extensions: ['https://assets.test/effects/entry.js', { url: '/ext/charts/entry.js' }, null],
      },
      pages: [{ route: '/', sections: [{ type: 'Hero', content: { text: 'a </script><!-- b' } }] }],
    },
    route: '/',
    foundation: {
      url: 'https://assets.test/foundations/acme/site/1.0.0/entry.js',
      cssUrl: 'https://assets.test/foundations/acme/site/1.0.0/custom.css',
    },
    runtime: {
      base: 'https://cdn.test/runtime/1.1.17',
      manifest: {
        entry: '/assets/index-AAA.js',
        preloads: ['assets/setup-BBB.js'],
        importMap: { react: '/_importmap/react.js', '@uniweb/core': '_importmap/core.js' },
      },
    },
  },

  // Split content: the served page and a dynamic template keep their sections; a page with an
  // address leaves them, saying whether it has content; one with no address, or no sections, stays.
  {
    content: {
      config: {
        activeLocale: 'en',
        favicon: '/icon.png',
        pageHashes: {
          en: {
            '/': '/_pages/a.json',
            '/about': '/_pages/b.json',
            '/empty': '/_pages/c.json',
            '/docs': '/_pages/d.json',
            '/blog/:slug': '/_pages/e.json',
            '/group': '/_pages/f.json',
          },
        },
      },
      pages: [
        { route: '/', sections: [{ type: 'Hero' }] },
        { route: '/about', sections: [{ type: 'Text' }] },
        { route: '/empty', sections: [] },
        { route: '/docs', sections: [], hasContent: true },
        { route: '/blog/:slug', isDynamic: true, sections: [{ type: 'Post' }] },
        { route: '/contact', sections: [{ type: 'Form' }] },
        { route: '/group' },
      ],
    },
    route: '/',
    foundation: { url: '/f/entry.js' },
    runtime: { base: 'https://cdn.test/runtime/1.1.17/', manifest: { entry: 'assets/index-AAA.js' } },
  },

  // Addresses, but no locale named to read them by, so nothing splits; an empty import map; a
  // relative base.
  {
    content: {
      config: { favicon: '/favicon.ico', pageHashes: { de: { '/': '/_pages/x.json' } } },
      pages: [
        { route: '/', sections: [{ type: 'Hero' }] },
        { route: '/about', sections: [{ type: 'Text' }] },
      ],
    },
    route: '/',
    foundation: { url: '/f/entry.js' },
    runtime: { base: '/rt', manifest: { importMap: {} } },
  },

  // An icon of no known type, addresses but no pages, no foundation entry, no manifest.
  {
    content: { config: { activeLocale: 'en', favicon: '/logo.gif', pageHashes: { en: { '/': '/_pages/y.json' } } } },
    foundation: {},
    runtime: { base: 'https://cdn.test/rt/' },
  },

  // Content with no config, and an empty preload list.
  {
    content: { pages: [] },
    foundation: { url: 'https://assets.test/f/entry.js' },
    runtime: { base: 'https://cdn.test/rt', manifest: { entry: 'assets/index-AAA.js', preloads: [] } },
  },
]
