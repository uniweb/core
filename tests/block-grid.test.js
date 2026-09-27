/**
 * `block.grid` — the layout the author chose for a section's child sections, from the
 * reserved `grid:` section key [Diego, 2026-09-27]. It rides in the section's params —
 * stored and synced like every key the author writes, with no field of its own — and the
 * Block lifts it out: `block.grid` has it, the component's params do not.
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

const build = (data) => new Block({ type: 'Grid', content: { type: 'doc', content: [] }, ...data }, 's0', mockPage())

describe('block.grid', () => {
  it('reads the section’s grid choice from its params, as written', () => {
    expect(build({ params: { grid: '40/60' } }).grid).toBe('40/60')
    expect(build({ params: { grid: 3 } }).grid).toBe(3)
  })

  it('takes it out of the params the component receives', () => {
    const block = build({ params: { grid: 2, gap: 'lg' } })
    expect(block.properties).toEqual({ gap: 'lg' })
  })

  it('does not change the stored params', () => {
    const params = { grid: 2, gap: 'lg' }
    build({ params })
    expect(params).toEqual({ grid: 2, gap: 'lg' })
  })

  it('is null when the section chose none', () => {
    expect(build({}).grid).toBeNull()
    expect(build({ params: { gap: 'lg' } }).grid).toBeNull()
  })

  it('still reads @uniweb/build@0.67.0’s spelling, beside the params', () => {
    expect(build({ grid: '60/40' }).grid).toBe('60/40')
  })
})
