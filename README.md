# @uniweb/core

Core classes for the Uniweb Component Web Platform.

## Overview

This package provides the foundational classes that power Uniweb sites. It's a pure JavaScript library with no React dependencies, designed to be shared between the runtime and foundations.

## Installation

```bash
npm install @uniweb/core
```

## Usage

```js
import { createUniweb, getUniweb } from '@uniweb/core'

// Create the singleton instance (typically done by @uniweb/runtime)
const uniweb = createUniweb(siteConfig)

// Access the singleton from anywhere
const uniweb = getUniweb()

// Work with the active website
const website = uniweb.activeWebsite
const page = website.getPage('/about')
const language = website.getLanguage()
```

## API

### Factory Functions

| Function | Description |
|----------|-------------|
| `createUniweb(config)` | Create and register the global Uniweb instance |
| `getUniweb()` | Get the current Uniweb instance |

### Classes

#### Uniweb

The main runtime instance, available as `globalThis.uniweb`.

```js
uniweb.getComponent(name)     // Get component from foundation
uniweb.listComponents()       // List available components
uniweb.activeWebsite          // Current website instance
uniweb.setFoundation(module)  // Set the foundation module
```

#### Website

Manages pages, theme, and localization.

```js
// Page navigation
website.getPage(route)        // Get page by route
website.setActivePage(route)  // Navigate to page
website.activePage            // Current active page
website.pages                 // All pages
website.pageRoutes            // Array of route strings

// Page Hierarchy API (for navbars, footers, sitemaps)
website.getPageHierarchy(options)  // Get pages for navigation
website.getHeaderPages()           // Convenience: pages for header nav
website.getFooterPages()           // Convenience: pages for footer nav
website.getAllPages()              // Get flat list of all pages

// Locale API
website.getLocales()          // Get all locales: [{code, label, isDefault}]
website.getActiveLocale()     // Get current locale code
website.getDefaultLocale()    // Get default locale code
website.hasMultipleLocales()  // Check if site has multiple locales
website.getLocaleUrl(code, route)  // Build URL for a locale
website.setActiveLocale(code) // Set active locale
website.getLocale(code)       // Get locale info by code

// Content localization (for multilingual values)
website.localize(value)       // Localize {en: "Hello", es: "Hola"} to active lang
website.makeHref(href)        // Transform href for routing

// Deprecated (use Locale API instead)
website.getLanguage()         // Use getActiveLocale()
website.getLanguages()        // Use getLocales()
```

**Page Hierarchy API**

The `getPageHierarchy()` method returns pages filtered and formatted for navigation:

```js
// Get pages for header navigation
const headerPages = website.getPageHierarchy({ for: 'header' })
// Returns: [{ id, route, title, label, description, order, hasContent, children }]

// Get flat list of all pages (for sitemaps)
const allPages = website.getPageHierarchy({ nested: false, includeHidden: true })

// Custom filtering and sorting
const topLevel = website.getPageHierarchy({
  filter: (page) => page.order < 10,
  sort: (a, b) => a.title.localeCompare(b.title)
})
```

Options:
- `nested` (default: true) - Return with nested children or flat list
- `for` - Filter for 'header', 'footer', or undefined (all)
- `includeHidden` (default: false) - Include hidden pages
- `filter` - Custom filter function: `(page) => boolean`
- `sort` - Custom sort function: `(a, b) => number`

#### Page

Represents a page with its sections.

```js
// Basic properties
page.route                    // Page route path
page.title                    // Page title
page.description              // Page description
page.label                    // Short navigation label (or null)
page.order                    // Sort order
page.children                 // Child pages (for nested hierarchy)
page.website                  // Back-reference to parent Website

// Navigation visibility
page.hidden                   // Hidden from all navigation
page.hideInHeader             // Hidden from header nav only
page.hideInFooter             // Hidden from footer nav only
page.isHidden()               // Check if hidden from navigation
page.showInHeader()           // Should appear in header nav?
page.showInFooter()           // Should appear in footer nav?
page.getLabel()               // Get navigation label (falls back to title)

// Layout options (per-page overrides)
page.layout.header            // Show header on this page?
page.layout.footer            // Show footer on this page?
page.layout.leftPanel         // Show left panel?
page.layout.rightPanel        // Show right panel?
page.hasHeader()              // Convenience: page.layout.header
page.hasFooter()              // Convenience: page.layout.footer
page.hasLeftPanel()           // Convenience: page.layout.leftPanel
page.hasRightPanel()          // Convenience: page.layout.rightPanel

// Content
page.getPageBlocks()          // Get header + body + footer blocks
page.getBodyBlocks()          // Get just body blocks
page.getHeader()              // Get header block
page.getFooter()              // Get footer block
page.hasChildren()            // Has child pages?
page.getHeadMeta()            // Get SEO meta tags
```

**Page Configuration (page.yml)**

```yaml
title: About Us
description: Learn about our company
label: About                  # Short nav label (optional)
order: 2

# Navigation visibility
hidden: true                  # Hide from all navigation
hideInHeader: true            # Hide from header nav only
hideInFooter: true            # Hide from footer nav only

# Layout overrides (default: all true)
layout:
  header: false               # Don't show header on this page
  footer: false               # Don't show footer on this page
  leftPanel: false            # Don't show left panel
  rightPanel: false           # Don't show right panel

# SEO (optional)
seo:
  noindex: false
  image: /about-og.png
```

#### Block

Represents a section/component on a page.

```js
block.component               // Component name
block.getBlockContent()       // Get parsed content
block.getBlockProperties()    // Get configuration properties
block.childBlockRenderer      // Renderer for child blocks
```

#### Input

Handles form input fields with validation.

```js
input.value                   // Current value
input.validate()              // Run validation
input.errors                  // Validation errors
```

## Architecture

```
@uniweb/runtime (browser)
    │
    └── imports @uniweb/core
            │
            ├── createUniweb() - creates singleton
            ├── Uniweb - main instance
            ├── Website - page/locale management
            ├── Page - page representation
            ├── Block - section representation
            └── Input - form handling

@uniweb/kit (foundation components)
    │
    └── imports @uniweb/core
            │
            └── getUniweb() - access singleton
```

## For Foundation Creators

Foundations typically don't import from `@uniweb/core` directly. Instead, use `@uniweb/kit` which provides React hooks and components that abstract the core:

```js
// Prefer this (kit)
import { useWebsite } from '@uniweb/kit'
const { localize, website } = useWebsite()

// Instead of this (core)
import { getUniweb } from '@uniweb/core'
const website = getUniweb().activeWebsite
```

Mark `@uniweb/core` as external in your foundation's Vite config:

```js
// vite.config.js
export default {
  build: {
    rollupOptions: {
      external: ['react', 'react-dom', 'react-router-dom', '@uniweb/core']
    }
  }
}
```

## Related Packages

- [`@uniweb/runtime`](https://github.com/uniweb/runtime) - Browser runtime (creates the Uniweb instance)
- [`@uniweb/kit`](https://github.com/uniweb/kit) - Component library for foundations
- [`@uniweb/build`](https://github.com/uniweb/build) - Build tooling

## License

Apache 2.0
