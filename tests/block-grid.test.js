/**
 * `block.grid` — the layout the author chose for a section's child sections, from the
 * reserved `grid:` section key [Diego, 2026-09-27]. Carried as written; kit lays the
 * children out from it. Never a param.
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
  it('carries the section’s grid choice as written', () => {
    expect(build({ grid: '40/60' }).grid).toBe('40/60')
    expect(build({ grid: 3 }).grid).toBe(3)
  })

  it('is null when the section chose none', () => {
    expect(build({}).grid).toBeNull()
  })

  it('is not a param', () => {
    const block = build({ grid: 2, params: { gap: 'lg' } })
    expect(block.properties).toEqual({ gap: 'lg' })
  })
})
