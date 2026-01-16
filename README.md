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
website.getPage(route)        // Get page by route
website.setActivePage(route)  // Navigate to page
website.localize(value)       // Localize a multilingual value
website.getLanguage()         // Get current language code
website.getLanguages()        // Get available languages
website.makeHref(href)        // Transform href for routing
```

#### Page

Represents a page with its sections.

```js
page.route                    // Page route path
page.title                    // Page title
page.sections                 // Array of section blocks
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
