import { evaluateCondition } from '../src/schema-conditions.js'

describe('evaluateCondition', () => {
  it('returns true when no condition is declared', () => {
    expect(evaluateCondition(undefined, { for: 'x' })).toBe(true)
    expect(evaluateCondition(null, { for: 'x' })).toBe(true)
    expect(evaluateCondition({}, { for: 'x' })).toBe(true)
  })

  it('implicit equality (shorthand)', () => {
    expect(evaluateCondition({ for: 'scholar' }, { for: 'scholar' })).toBe(true)
    expect(evaluateCondition({ for: 'scholar' }, { for: 'news' })).toBe(false)
    expect(evaluateCondition({ for: 'scholar' }, {})).toBe(false)
  })

  it('$eq and $neq', () => {
    expect(evaluateCondition({ x: { $eq: 1 } }, { x: 1 })).toBe(true)
    expect(evaluateCondition({ x: { $eq: 1 } }, { x: 2 })).toBe(false)
    expect(evaluateCondition({ x: { $neq: 1 } }, { x: 2 })).toBe(true)
    expect(evaluateCondition({ x: { $neq: 1 } }, { x: 1 })).toBe(false)
  })

  it('$in and $nin', () => {
    expect(evaluateCondition({ v: { $in: ['a', 'b'] } }, { v: 'a' })).toBe(true)
    expect(evaluateCondition({ v: { $in: ['a', 'b'] } }, { v: 'c' })).toBe(false)
    expect(evaluateCondition({ v: { $nin: ['a', 'b'] } }, { v: 'c' })).toBe(true)
    expect(evaluateCondition({ v: { $nin: ['a', 'b'] } }, { v: 'a' })).toBe(false)
  })

  it('$truthy and $falsy', () => {
    expect(evaluateCondition({ ok: { $truthy: true } }, { ok: 'yes' })).toBe(true)
    expect(evaluateCondition({ ok: { $truthy: true } }, { ok: '' })).toBe(false)
    expect(evaluateCondition({ ok: { $truthy: true } }, { ok: 0 })).toBe(false)
    expect(evaluateCondition({ ok: { $falsy: true } }, { ok: false })).toBe(true)
    expect(evaluateCondition({ ok: { $falsy: true } }, { ok: 'yes' })).toBe(false)
  })

  it('AND semantics across multiple keys', () => {
    const c = { a: 'x', b: { $in: [1, 2] } }
    expect(evaluateCondition(c, { a: 'x', b: 2 })).toBe(true)
    expect(evaluateCondition(c, { a: 'x', b: 3 })).toBe(false)
    expect(evaluateCondition(c, { a: 'y', b: 2 })).toBe(false)
  })

  it('unknown operators are treated as unmatched', () => {
    expect(evaluateCondition({ x: { $weird: 1 } }, { x: 1 })).toBe(false)
  })

  it('returns false when row is missing but condition is declared', () => {
    expect(evaluateCondition({ for: 'scholar' }, null)).toBe(false)
    expect(evaluateCondition({ for: 'scholar' }, undefined)).toBe(false)
  })
})
