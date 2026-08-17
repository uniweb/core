import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Block from '../src/block.js'
import { sectionDomId } from '../src/section-id.js'

// Minimal page/website mock
function mockPage() {
  return {
    website: {
      getDefaultBlockType: () => 'DefaultSection',
    },
    getBlockIndex: () => 0,
    getBlockInfo: () => null,
  }
}

describe('Block', () => {
  describe('insets (@ component references)', () => {
    it('creates inset blocks from insets data', () => {
      const page = mockPage()
      const blockData = {
        type: 'SplitContent',
        content: {},
        insets: [
          { refId: 'inline_0', type: 'NetworkDiagram', params: { variant: 'compact' }, description: 'diagram' },
          { refId: 'inline_1', type: 'Chart', params: {} },
        ],
      }

      const block = new Block(blockData, '1', page)

      expect(block.insets).toHaveLength(2)
      expect(block.insets[0].refId).toBe('inline_0')
      expect(block.insets[0].type).toBe('NetworkDiagram')
      expect(block.insets[0].properties.variant).toBe('compact')

      expect(block.insets[1].refId).toBe('inline_1')
      expect(block.insets[1].type).toBe('Chart')
    })

    it('getInset returns correct inset by refId', () => {
      const page = mockPage()
      const blockData = {
        type: 'Hero',
        content: {},
        insets: [
          { refId: 'inline_0', type: 'Widget', params: {} },
        ],
      }

      const block = new Block(blockData, '1', page)

      const inset = block.getInset('inline_0')
      expect(inset).not.toBeNull()
      expect(inset.type).toBe('Widget')
      expect(inset.refId).toBe('inline_0')

      expect(block.getInset('nonexistent')).toBeNull()
    })

    it('insets are separate from file-based childBlocks', () => {
      const page = mockPage()
      const blockData = {
        type: 'SplitContent',
        content: {},
        subsections: [
          { type: 'ChildA', content: {} },
        ],
        insets: [
          { refId: 'inline_0', type: 'ChildB', params: {} },
        ],
      }

      const block = new Block(blockData, '1', page)

      // childBlocks has file-based children only
      expect(block.childBlocks).toHaveLength(1)
      expect(block.childBlocks[0].type).toBe('ChildA')
      // insets are separate
      expect(block.insets).toHaveLength(1)
      expect(block.insets[0].type).toBe('ChildB')
      expect(block.insets[0].refId).toBe('inline_0')
    })

    it('insets have alt text as title content', () => {
      const page = mockPage()
      const blockData = {
        type: 'Hero',
        content: {},
        insets: [
          { refId: 'inline_0', type: 'Diagram', params: {}, title: 'Architecture overview' },
        ],
      }

      const block = new Block(blockData, '1', page)
      const inset = block.insets[0]

      expect(inset.childBlocks).toHaveLength(0)
    })

    it('no insets when insets data is absent', () => {
      const page = mockPage()
      const blockData = { type: 'Hero', content: {} }

      const block = new Block(blockData, '1', page)
      expect(block.insets).toHaveLength(0)
    })
  })

  describe('themeName (Auto context)', () => {
    it('defaults to empty string (Auto) when no theme specified', () => {
      const page = mockPage()
      const block = new Block({ type: 'Hero', content: {} }, '0', page)
      expect(block.themeName).toBe('')
    })

    it('preserves explicit context string', () => {
      const page = mockPage()
      const block = new Block({
        type: 'Hero',
        content: {},
        params: { theme: 'dark' },
      }, '0', page)
      expect(block.themeName).toBe('dark')
    })

    it('preserves medium context', () => {
      const page = mockPage()
      const block = new Block({
        type: 'Hero',
        content: {},
        params: { theme: 'medium' },
      }, '0', page)
      expect(block.themeName).toBe('medium')
    })

    it('extracts mode from theme object', () => {
      const page = mockPage()
      const block = new Block({
        type: 'Hero',
        content: {},
        params: { theme: { mode: 'dark', heading: 'neutral-100' } },
      }, '0', page)
      expect(block.themeName).toBe('dark')
      expect(block.contextOverrides).toEqual({ heading: 'var(--neutral-100)' })
    })

    it('defaults to Auto when theme object has no mode', () => {
      const page = mockPage()
      const block = new Block({
        type: 'Hero',
        content: {},
        params: { theme: { heading: 'neutral-900' } },
      }, '0', page)
      expect(block.themeName).toBe('')
      expect(block.contextOverrides).toEqual({ heading: 'var(--neutral-900)' })
    })
  })

  describe('parseContent purity', () => {
    const sampleDoc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Hello' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'World' }],
        },
      ],
    }

    beforeEach(() => {
      delete globalThis.uniweb
    })

    it('does not read from globalThis.uniweb.foundationConfig', () => {
      const page = mockPage()

      // First block: no globalThis.uniweb at all
      const noGlobal = new Block({ type: 'Hero', content: sampleDoc }, '0', page)

      // Second block: globalThis.uniweb with a handler that would mutate content
      // if parseContent still read it. The handler must NOT run.
      let handlerCalls = 0
      globalThis.uniweb = {
        foundationConfig: {
          handlers: {
            content: (content) => {
              handlerCalls++
              return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MUTATED' }] }] }
            },
          },
        },
      }
      const withGlobal = new Block({ type: 'Hero', content: sampleDoc }, '1', page)

      expect(handlerCalls).toBe(0)
      expect(withGlobal.parsedContent.title).toBe(noGlobal.parsedContent.title)
      expect(withGlobal.parsedContent.title).toBe('Hello')
    })

    it('is idempotent — re-parsing the same raw content yields structurally equal output', () => {
      const page = mockPage()
      const block = new Block({ type: 'Hero', content: sampleDoc }, '0', page)

      const first = block.parsedContent
      const second = block.parseContent(block.rawContent)

      // Not the same reference — parseContent returns a fresh object
      expect(second).not.toBe(first)
      // But the semantic shape matches
      expect(second.title).toBe(first.title)
      expect(second.paragraphs).toEqual(first.paragraphs)
      expect(second.sequence).toEqual(first.sequence)
    })
  })

  describe('sealed object shape', () => {
    it('rejects new properties on block instances', () => {
      const page = mockPage()
      const block = new Block({ type: 'Hero', content: {} }, '0', page)

      expect(() => { block.newProp = 'nope' }).toThrow(TypeError)
    })

    it('allows modification of existing properties', () => {
      const page = mockPage()
      const block = new Block({ type: 'Hero', content: {} }, '0', page)

      block.dataLoading = true
      expect(block.dataLoading).toBe(true)

      block.hasBackground = true
      expect(block.hasBackground).toBe(true)
    })
  })
})

describe('Block.track', () => {
  function trackingPage(route = '/blog') {
    return {
      website: { getDefaultBlockType: () => 'DefaultSection' },
      getBlockIndex: () => 0,
      getBlockInfo: () => null,
      getNavRoute: () => route,
    }
  }

  afterEach(() => {
    delete globalThis.uniweb
  })

  it('attaches the page path, the section type and the section instance id', () => {
    const track = vi.fn()
    globalThis.uniweb = { tracking: { track } }
    const block = new Block(
      { type: 'VideoHero', stableId: 'hero', content: {} },
      '1',
      trackingPage('/about')
    )

    block.track('video_milestone', { milestone: 50 })

    expect(track).toHaveBeenCalledWith('video_milestone', {
      path: '/about',
      section: 'VideoHero',
      section_id: 'section-hero',
      milestone: 50,
    })
  })

  // `section` and `section_id` answer different questions and a consumer may
  // store either, so BOTH must ride — see the table in Block.track's docblock.
  // The instance id is the one the renderers write as the DOM id, so it joins
  // to the anchor a search result links to; deriving it here rather than
  // formatting a string keeps `@uniweb/core/section-id` the only place the rule
  // is written down (the search extractor already drifted from it once).
  it('derives section_id by the SHARED rule, not a local spelling', () => {
    const track = vi.fn()
    globalThis.uniweb = { tracking: { track } }
    const block = new Block({ type: 'Hero', stableId: 'pricing', content: {} }, '3', trackingPage())

    block.track('section_view')

    expect(track.mock.calls[0][1].section_id).toBe(sectionDomId(block))
    expect(track.mock.calls[0][1].section_id).toBe('section-pricing')
  })

  // Caveat 2 of the wire contract: with no stableId the id falls back to the
  // POSITIONAL index, which moves under reordering. A consumer detects that
  // from the string itself — a purely numeric suffix means "do not trend this".
  it('falls back to the positional id when a section has no stable identity', () => {
    const track = vi.fn()
    globalThis.uniweb = { tracking: { track } }
    const block = new Block({ type: 'Hero', content: {} }, '2', trackingPage())

    block.track('section_view')

    expect(track.mock.calls[0][1].section_id).toBe('section-2')
  })

  it('lets the caller override the derived context', () => {
    const track = vi.fn()
    globalThis.uniweb = { tracking: { track } }
    const block = new Block({ type: 'Hero', stableId: 'a', content: {} }, '1', trackingPage('/a'))

    block.track('custom', { section: 'Elsewhere', section_id: 'section-elsewhere' })

    expect(track).toHaveBeenCalledWith('custom', {
      path: '/a',
      section: 'Elsewhere',
      section_id: 'section-elsewhere',
    })
  })

  // The whole point of the no-op contract: a foundation calls this
  // unconditionally, and a site with no tracking destination is the default.
  it('does not throw when nothing is wired', () => {
    const block = new Block({ type: 'Hero', content: {} }, '1', trackingPage())
    expect(() => block.track('x', { a: 1 })).not.toThrow()

    globalThis.uniweb = {} // singleton present, tracker absent
    expect(() => block.track('x')).not.toThrow()
  })
})
