/**
 * Container fences — ```@Component{params} around a markdown body.
 *
 * A container resolves the same way a leaf inset does: the node is lifted to an
 * `inset_placeholder`, `getInset(refId)` returns a Block, and that Block looks
 * its component up on the foundation. The lift happens here in `@uniweb/core`
 * rather than in the build because `inset_block` is the canonical STORED shape —
 * the document that syncs and round-trips has to keep carrying it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Block from '../src/block.js'

function mockPage() {
  return {
    website: { getDefaultBlockType: () => 'DefaultSection' },
    getBlockIndex: () => 0,
    getBlockInfo: () => null,
  }
}

/** A container node as content-reader emits it. */
const container = (component, attrs, body) => ({
  type: 'inset_block',
  attrs: { component, ...attrs },
  content: body,
})

const para = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })

const docWith = (...nodes) => ({ type: 'doc', content: nodes })

describe('lifting containers', () => {
  it('turns a container into an inset Block that carries its body', () => {
    const block = new Block(
      { type: 'S', content: docWith(para('Before'), container('Alert', { type: 'warning' }, [para('Careful.')])) },
      's0',
      mockPage()
    )

    expect(block.insets).toHaveLength(1)
    const c = block.insets[0]
    expect(c.type).toBe('Alert')
    expect(c.properties).toEqual({ type: 'warning' })
    // The body is parsed like any section's content, not flattened to a string.
    expect(c.parsedContent.paragraphs).toEqual(['Careful.'])
  })

  it('is reachable through getInset, the same lookup a leaf inset uses', () => {
    const block = new Block(
      { type: 'S', content: docWith(container('Alert', {}, [para('x')])) },
      's0',
      mockPage()
    )
    expect(block.getInset('container_0')).toBe(block.insets[0])
  })

  it('leaves an inset_placeholder in the parent content flow', () => {
    const block = new Block(
      { type: 'S', content: docWith(para('a'), container('Alert', {}, [para('x')]), para('b')) },
      's0',
      mockPage()
    )
    // The renderer sees a placeholder — never an inset_block — so kit and the
    // SSR twin need no container-specific case.
    expect(block.rawContent.content.map(n => n.type)).toEqual([
      'paragraph',
      'inset_placeholder',
      'paragraph',
    ])
    expect(block.parsedContent.sequence.map(e => e.type)).toEqual([
      'paragraph',
      'inset',
      'paragraph',
    ])
  })

  it('does NOT mutate the content it was given', () => {
    // blockData.content is shared with the sync/pull machinery, which must keep
    // seeing `inset_block`. Mutating here would silently rewrite what syncs.
    const content = docWith(container('Alert', {}, [para('x')]))
    const before = JSON.stringify(content)

    new Block({ type: 'S', content }, 's0', mockPage())

    expect(JSON.stringify(content)).toBe(before)
    expect(content.content[0].type).toBe('inset_block')
  })

  it('appends containers after leaf insets so insets[0] keeps its meaning', () => {
    // Foundations already do `<Visual inset={block.insets[0]}>`. A container
    // must not displace the leaf inset that used to be there.
    const block = new Block(
      {
        type: 'S',
        insets: [{ refId: 'inset_0', type: 'Chart', params: {}, title: 'A chart' }],
        content: docWith(container('Alert', {}, [para('x')])),
      },
      's0',
      mockPage()
    )

    expect(block.insets.map(i => i.type)).toEqual(['Chart', 'Alert'])
    expect(block.getInset('inset_0').type).toBe('Chart')
    expect(block.getInset('container_0').type).toBe('Alert')
  })

  it('costs nothing and returns the same object when there are no containers', () => {
    const content = docWith(para('just prose'))
    const block = new Block({ type: 'S', content }, 's0', mockPage())

    expect(block.rawContent).toBe(content)
    expect(block.insets).toHaveLength(0)
  })

  it('lifts a container nested inside another node', () => {
    const block = new Block(
      {
        type: 'S',
        content: docWith({
          type: 'blockquote',
          content: [container('Alert', {}, [para('inside a quote')])],
        }),
      },
      's0',
      mockPage()
    )

    expect(block.insets).toHaveLength(1)
    expect(block.rawContent.content[0].content[0].type).toBe('inset_placeholder')
  })
})

describe('nesting resolves one level at a time', () => {
  it('a container inside a container becomes an inset of the inner Block', () => {
    const block = new Block(
      {
        type: 'S',
        content: docWith(
          container('Outer', {}, [para('outer body'), container('Inner', {}, [para('inner body')])])
        ),
      },
      's0',
      mockPage()
    )

    // The outer lift does not recurse — the inner container rides along inside
    // the outer's body and is lifted by the outer Block's own constructor.
    expect(block.insets).toHaveLength(1)

    const outer = block.getInset('container_0')
    expect(outer.type).toBe('Outer')
    expect(outer.parsedContent.paragraphs).toEqual(['outer body'])

    const inner = outer.getInset('container_0')
    expect(inner.type).toBe('Inner')
    expect(inner.parsedContent.paragraphs).toEqual(['inner body'])
  })
})

describe('foundation resolution', () => {
  const Alert = () => null
  let previous

  beforeEach(() => {
    previous = globalThis.uniweb
    globalThis.uniweb = {
      getComponent: name => (name === 'Alert' ? Alert : undefined),
      getComponentMeta: () => ({}),
    }
  })

  afterEach(() => {
    globalThis.uniweb = previous
  })

  it('resolves the container name against the foundation', () => {
    const block = new Block(
      { type: 'S', content: docWith(container('Alert', {}, [para('x')])) },
      's0',
      mockPage()
    )
    expect(block.getInset('container_0').initComponent()).toBe(Alert)
  })

  it('resolves to nothing when the foundation does not define it', () => {
    // Not an error: kit renders the visible generic container instead, so the
    // body is still readable. A site must never inherit kit's opinion of what
    // an `@Callout` looks like.
    const block = new Block(
      { type: 'S', content: docWith(container('Callout', {}, [para('x')])) },
      's0',
      mockPage()
    )
    expect(block.getInset('container_0').initComponent()).toBeNull()
  })
})
