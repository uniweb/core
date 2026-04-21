import { isRichSchema } from '../src/schemas.js'

describe('isRichSchema', () => {
  it('returns false for non-objects and plain values', () => {
    expect(isRichSchema(null)).toBe(false)
    expect(isRichSchema(undefined)).toBe(false)
    expect(isRichSchema('string')).toBe(false)
    expect(isRichSchema(42)).toBe(false)
    expect(isRichSchema([])).toBe(false)
  })

  it('returns false for simple keyed-object schemas (tagged-block form)', () => {
    expect(isRichSchema({ label: 'string', href: 'string' })).toBe(false)
    expect(
      isRichSchema({
        type: { type: 'select', options: ['a', 'b'], default: 'a' },
      })
    ).toBe(false)
  })

  it('returns false for the full @uniweb/schemas format (fields as keyed object)', () => {
    const full = {
      name: 'person',
      version: '1.0.0',
      fields: { name: 'string', role: 'string' },
    }
    expect(isRichSchema(full)).toBe(false)
  })

  it('recognizes a fields array as rich', () => {
    expect(
      isRichSchema({ fields: [{ id: 'a', type: 'text' }] })
    ).toBe(true)
  })

  it('recognizes isComposite:true as rich', () => {
    expect(isRichSchema({ isComposite: true })).toBe(true)
  })

  it('recognizes a childSchema presence as rich', () => {
    expect(
      isRichSchema({
        childSchema: { fields: [{ id: 'n', type: 'text' }] },
      })
    ).toBe(true)
  })
})
