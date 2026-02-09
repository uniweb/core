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
      expect(block.insets[0].inline).toBe(true)
      expect(block.insets[0].refId).toBe('inline_0')
      expect(block.insets[0].type).toBe('NetworkDiagram')
      expect(block.insets[0].properties.variant).toBe('compact')

      expect(block.insets[1].inline).toBe(true)
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
      expect(inset.inline).toBe(true)

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
      expect(block.insets[0].inline).toBe(true)
    })

    it('insets have description as title content', () => {
      const page = mockPage()
      const blockData = {
        type: 'Hero',
        content: {},
        insets: [
          { refId: 'inline_0', type: 'Diagram', params: {}, description: 'Architecture overview' },
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
})
