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

describe('public surface', () => {
  // These tests once imported '../src/schemas.js' DIRECTLY, so they passed while
  // the barrel exported only `isRichSchema` and `import { normalizeSchema } from
  // "@uniweb/core"` returned undefined. The frontend was blocked by it and found
  // it by RUNNING the import rather than reading the file: a test that never goes
  // through the path a consumer uses is testing a shape no consumer sees.
  //
  // So this suite asserts the ENTRY, not the module — and now asserts the
  // absence too, because "we removed it" is the claim a consumer feels.
  it('exports isRichSchema from the package entry', async () => {
    const entry = await import('../src/index.js')
    expect(typeof entry.isRichSchema).toBe('function')
  })

  it('⛔ no longer exports normalizeSchema — it moved to @uniweb/schemas', async () => {
    // Editor-only, and this package ships to every site in every lane. Its home
    // is `@uniweb/schemas/editor-form`; `framework/schemas/tests/editor-form.test.js`
    // carries the behaviour. Removed 2026-09-01, after frontend migrated its
    // import — a `workspace:*` consumer, so the removal was live for them at
    // commit time and could not wait on a release.
    const entry = await import('../src/index.js')
    expect(entry.normalizeSchema).toBeUndefined()
  })
})
