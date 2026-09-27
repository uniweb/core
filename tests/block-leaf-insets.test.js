/**
 * Leaf insets — `![alt](@Component){params}`, `[text](@Component)`, `[@key]`, `[#id]`.
 *
 * They reach the Block as the author wrote them, `inset_ref` nodes in the content, and
 * the Block lifts them the way it lifts a ```@Component fence: a placeholder in place,
 * an inset Block in `block.insets`. Until 2026-09-27 the site build extracted them into
 * a section's `insets[]` instead, so a document no build extracted — a record body, a
 * free-form translation — rendered none of them. A stored `insets[]` is still read.
 */

import { describe, it, expect } from 'vitest'
import Block from '../src/block.js'

function mockPage() {
  return {
    website: { getDefaultBlockType: () => 'DefaultSection' },
    getBlockIndex: () => 0,
    getBlockInfo: () => null,
  }
}

/** A leaf inset as content-reader emits it. */
const ref = (component, attrs = {}) => ({
  type: 'inset_ref',
  attrs: { component, embedKind: 'visual', alt: null, ...attrs },
})
const text = (value) => ({ type: 'text', text: value })
const para = (...inline) => ({ type: 'paragraph', content: inline.map((n) => (typeof n === 'string' ? text(n) : n)) })
const container = (component, body) => ({ type: 'inset_block', attrs: { component }, content: body })
const docWith = (...nodes) => ({ type: 'doc', content: nodes })

const build = (data) => new Block({ type: 'S', ...data }, 's0', mockPage())

describe('lifting leaf insets', () => {
  it('turns an inset_ref into an inset Block with its params and its text as the title', () => {
    const block = build({ content: docWith(para('Before'), ref('Diagram', { alt: 'Platform overview', variant: 'compact' })) })

    expect(block.insets).toHaveLength(1)
    const inset = block.insets[0]
    expect(inset.type).toBe('Diagram')
    expect(inset.refId).toBe('inset_0')
    expect(inset.properties).toEqual({ variant: 'compact' })
    expect(inset.parsedContent.title).toBe('Platform overview')
    expect(block.getInset('inset_0')).toBe(inset)
  })

  it('leaves a placeholder where the reference was, inline in its paragraph', () => {
    const block = build({
      content: docWith(para('As shown ', ref('Cite', { embedKind: 'text', key: 'darwin1859' }), ' here.')),
    })

    const [paragraph] = block.rawContent.content
    expect(paragraph.content[1]).toEqual({ type: 'inset_placeholder', attrs: { refId: 'inset_0', embedKind: 'text' } })
    expect(block.insets[0].type).toBe('Cite')
    expect(block.insets[0].properties).toEqual({ key: 'darwin1859' })
  })

  it('numbers leaves in document order, and places them before containers', () => {
    const block = build({
      content: docWith(
        container('Alert', [para('careful')]),
        ref('Chart'),
        para('between'),
        ref('Diagram'),
      ),
    })

    expect(block.insets.map((b) => b.refId)).toEqual(['inset_0', 'inset_1', 'container_0'])
    expect(block.insets.map((b) => b.type)).toEqual(['Chart', 'Diagram', 'Alert'])
  })

  it('reaches the semantic parser as a placeholder, so content.insets lists it', () => {
    const block = build({ content: docWith(para('text'), ref('Chart')) })
    expect(block.parsedContent.insets).toEqual([{ refId: 'inset_0' }])
  })

  it('does not mutate the stored content — it keeps what the author wrote', () => {
    const content = docWith(para('a'), ref('Chart', { alt: 'x' }))
    const before = JSON.stringify(content)
    build({ content })
    expect(JSON.stringify(content)).toBe(before)
    expect(content.content[1].type).toBe('inset_ref')
  })

  it('a document with no insets is passed through untouched', () => {
    const content = docWith(para('only text'))
    expect(build({ content }).rawContent).toBe(content)
  })

  it('leaves a leaf inside a container to the container, which lifts its own', () => {
    const block = build({ content: docWith(container('Callout', [para('see'), ref('Chart')])) })

    expect(block.insets.map((b) => b.refId)).toEqual(['container_0'])
    const callout = block.insets[0]
    expect(callout.insets.map((b) => b.type)).toEqual(['Chart'])
    expect(callout.getInset('inset_0')).toBe(callout.insets[0])
  })
})

describe('a stored insets[] — content from before the lift moved into core', () => {
  it('is still read, placeholders and all', () => {
    const block = build({
      content: docWith(para('a'), { type: 'inset_placeholder', attrs: { refId: 'inset_0', embedKind: 'visual' } }),
      insets: [{ refId: 'inset_0', type: 'Diagram', params: {}, title: 'Overview', embedKind: 'visual' }],
    })
    expect(block.insets).toHaveLength(1)
    expect(block.getInset('inset_0').type).toBe('Diagram')
  })

  it('numbers lifted leaves after it, so no two insets share a refId', () => {
    const block = build({
      content: docWith(
        { type: 'inset_placeholder', attrs: { refId: 'inset_0', embedKind: 'visual' } },
        ref('Chart'),
      ),
      insets: [{ refId: 'inset_0', type: 'Diagram', params: {}, title: null, embedKind: 'visual' }],
    })
    expect(block.insets.map((b) => [b.refId, b.type])).toEqual([['inset_0', 'Diagram'], ['inset_1', 'Chart']])
  })
})
