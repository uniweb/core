/**
 * The host's asset template must actually reach a Block's parse.
 *
 * ⚠️ This guards an ordering that holds by an easily-undone fact. `Website`'s
 * constructor assigns `this.pages` BEFORE `this.config`, and a Block parses its
 * content at construction — so a Block built during that window parses against
 * an EMPTY config. Every asset would then fall through to `src`, and nothing
 * would error. It works today only because `Page.bodyBlocks` is a lazy getter,
 * so blocks are built at render, long after the constructor returns.
 *
 * ⭐ Why this needs a test and not just the comment already in `block.js`: the
 * two silent failures are not the same and only one of them is intended.
 *
 *   - **absent template** — the deployment declared nothing. Falling back is
 *     correct, and it is what lets a producer write `assetId` before any host
 *     emits a template.
 *   - **present-but-unread** — the deployment declared correctly and the value
 *     never reached the parser. That renders a working site with stale URLs,
 *     which is strictly harder to notice, and no other lane can detect it from
 *     the payload it emitted.
 *
 * The second is what breaks if the lazy getter goes away, and it is
 * indistinguishable from the first by looking at output alone.
 */

import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

const ID = 'a'.repeat(64)
const TEMPLATE = 'https://assets.example.com/dist/{id}/base.{ext}'

const contentWith = (config) => ({
  config: { name: 'Test', defaultLanguage: 'en', ...config },
  theme: {},
  pages: [
    {
      route: '/',
      isIndex: true,
      title: 'Home',
      sections: [
        {
          type: 'Hero',
          content: {
            type: 'doc',
            content: [
              { type: 'image', attrs: { assetId: ID, assetExt: 'png', src: '/fallback.png' } },
            ],
          },
        },
      ],
    },
  ],
})

const firstImageUrl = (website) => {
  const block = website.pages[0].bodyBlocks[0]
  const el = block.parsedContent.sequence.find((e) => e.type === 'image')
  return el?.attrs?.url
}

describe('config.assets reaches a Block at parse time', () => {
  it('resolves assetId through the template the site was published with', () => {
    const w = new Website({ content: contentWith({ assets: { url: TEMPLATE } }) })
    expect(firstImageUrl(w)).toBe(`https://assets.example.com/dist/${ID}/base.png`)
  })

  it('CONTROL: falls back to src when the site declares no template', () => {
    // Distinguishes "the template was absent" from "the template was present and
    // unread" — without this the assertion above could pass for a build that
    // never reads config at all, and this one would still pass too.
    const w = new Website({ content: contentWith({}) })
    expect(firstImageUrl(w)).toBe('/fallback.png')
  })
})
