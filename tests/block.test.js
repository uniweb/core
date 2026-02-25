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
