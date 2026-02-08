import { describe, it, expect, beforeEach } from '@jest/globals'
import Block from '../src/block.js'

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
  describe('inline children (@ component references)', () => {
    it('creates child blocks from inlineChildren', () => {
      const page = mockPage()
      const blockData = {
        type: 'SplitContent',
        content: {},
        inlineChildren: [
          { refId: 'inline_0', type: 'NetworkDiagram', params: { variant: 'compact' }, alt: 'diagram' },
          { refId: 'inline_1', type: 'Chart', params: {}, alt: null },
        ],
      }

      const block = new Block(blockData, '1', page)

      expect(block.childBlocks).toHaveLength(2)
      expect(block.childBlocks[0].inline).toBe(true)
      expect(block.childBlocks[0].refId).toBe('inline_0')
      expect(block.childBlocks[0].type).toBe('NetworkDiagram')
      expect(block.childBlocks[0].alt).toBe('diagram')
      expect(block.childBlocks[0].properties.variant).toBe('compact')

      expect(block.childBlocks[1].inline).toBe(true)
      expect(block.childBlocks[1].refId).toBe('inline_1')
      expect(block.childBlocks[1].type).toBe('Chart')
      expect(block.childBlocks[1].alt).toBe('')
    })

    it('getInlineChild returns correct child by refId', () => {
      const page = mockPage()
      const blockData = {
        type: 'Hero',
        content: {},
        inlineChildren: [
          { refId: 'inline_0', type: 'Widget', params: {}, alt: null },
        ],
      }

      const block = new Block(blockData, '1', page)

      const child = block.getInlineChild('inline_0')
      expect(child).not.toBeNull()
      expect(child.type).toBe('Widget')
      expect(child.inline).toBe(true)

      expect(block.getInlineChild('nonexistent')).toBeNull()
    })

    it('merges inline children with file-based subsections', () => {
      const page = mockPage()
      const blockData = {
        type: 'SplitContent',
        content: {},
        subsections: [
          { type: 'ChildA', content: {} },
        ],
        inlineChildren: [
          { refId: 'inline_0', type: 'ChildB', params: {}, alt: null },
        ],
      }

      const block = new Block(blockData, '1', page)

      // Should have both file-based and inline children
      expect(block.childBlocks).toHaveLength(2)
      expect(block.childBlocks[0].type).toBe('ChildA')
      expect(block.childBlocks[0].inline).toBeUndefined()
      expect(block.childBlocks[1].type).toBe('ChildB')
      expect(block.childBlocks[1].inline).toBe(true)
    })

    it('inline children have empty content', () => {
      const page = mockPage()
      const blockData = {
        type: 'Hero',
        content: {},
        inlineChildren: [
          { refId: 'inline_0', type: 'Diagram', params: {}, alt: null },
        ],
      }

      const block = new Block(blockData, '1', page)
      const child = block.childBlocks[0]

      // Inline children receive empty content (plain object pass-through)
      expect(child.rawContent).toEqual({})
      expect(child.childBlocks).toHaveLength(0)
    })

    it('no inline children when inlineChildren is absent', () => {
      const page = mockPage()
      const blockData = { type: 'Hero', content: {} }

      const block = new Block(blockData, '1', page)
      expect(block.childBlocks).toHaveLength(0)
    })
  })
})
