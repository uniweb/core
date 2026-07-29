import { isRichSchema, normalizeSchema } from '../src/schemas.js'

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
        type: { type: 'select', options: ['a', 'b'], default: 'a' }
      })
    ).toBe(false)
  })

  it('returns false for the full @uniweb/schemas format (fields as keyed object)', () => {
    const full = {
      name: 'person',
      version: '1.0.0',
      fields: { name: 'string', role: 'string' }
    }
    expect(isRichSchema(full)).toBe(false)
  })

  it('recognizes a fields array as rich', () => {
    expect(isRichSchema({ fields: [{ id: 'a', type: 'text' }] })).toBe(true)
  })

  it('recognizes isComposite:true as rich', () => {
    expect(isRichSchema({ isComposite: true })).toBe(true)
  })

  it('recognizes a childSchema presence as rich', () => {
    expect(
      isRichSchema({
        childSchema: { fields: [{ id: 'n', type: 'text' }] }
      })
    ).toBe(true)
  })
})

describe('normalizeSchema', () => {
  // `isRichSchema` answers "is this already rich?", which is right for dispatch
  // and wrong for "can this be edited". Three authored shapes exist and it
  // accepts one — including rejecting a RESOLVED NAMED REF, which is the first
  // authoring form the docs show.
  it('converts a resolved named ref, whose fields are a MAP not an array', () => {
    const resolved = {
      name: 'P',
      fields: { title: { type: 'string' }, count: { type: 'int' } }
    }
    expect(isRichSchema(resolved)).toBe(false) // the gap this closes
    const norm = normalizeSchema(resolved)
    expect(norm.fields.map((f) => f.id)).toEqual(['title', 'count'])
    expect(norm.name).toBe('P') // siblings survive
  })

  it('preserves authored order, because a form shows fields in order', () => {
    const norm = normalizeSchema({
      fields: {
        z: { type: 'string' },
        a: { type: 'string' },
        m: { type: 'string' }
      }
    })
    expect(norm.fields.map((f) => f.id)).toEqual(['z', 'a', 'm'])
  })

  it('converts an inline field map', () => {
    expect(
      normalizeSchema({
        cpu: { type: 'string' },
        ram: { type: 'int' }
      }).fields.map((f) => f.id)
    ).toEqual(['cpu', 'ram'])
  })

  it('hands an already-rich schema back untouched', () => {
    const rich = { fields: [{ id: 'a', type: 'string' }] }
    expect(normalizeSchema(rich)).toBe(rich)
  })

  it('returns null for a sectioned Model — it is not one form', () => {
    // Flattening would invent a layout the author never expressed.
    expect(
      normalizeSchema({
        sections: { brief: { fields: { a: { type: 'string' } } } }
      })
    ).toBeNull()
  })

  it('does NOT invent a form out of an ordinary object', () => {
    // An earlier cut accepted the bare-type string shorthand in the no-`fields`
    // case, which made `{name, description}` a two-field form: without a `fields`
    // key there is nothing to distinguish `{cpu:'string'}` from `{name:'Acme'}`.
    expect(normalizeSchema({ name: 'X', description: 'Y' })).toBeNull()
    expect(normalizeSchema({ cpu: 'string' })).toBeNull()
    expect(normalizeSchema({})).toBeNull()
    expect(normalizeSchema(null)).toBeNull()
    expect(normalizeSchema([])).toBeNull()
  })

  it('still accepts the shorthand when `fields` says they ARE fields', () => {
    expect(normalizeSchema({ fields: { cpu: 'string' } }).fields).toEqual([
      { id: 'cpu', type: 'string' }
    ])
  })
})
