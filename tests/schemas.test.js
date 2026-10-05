/**
 * `@uniweb/core` carries no data-schema helpers — it ships to every site in every lane, and what a
 * data schema means lives in `@uniweb/schemas`.
 *
 * These tests once imported '../src/schemas.js' DIRECTLY, so they passed while the barrel exported
 * only `isRichSchema` and `import { normalizeSchema } from "@uniweb/core"` returned undefined. The
 * frontend was blocked by it and found it by RUNNING the import rather than reading the file: a test
 * that never goes through the path a consumer uses is testing a shape no consumer sees. So this
 * suite asserts the ENTRY, not the module — and asserts the absence, because "we removed it" is the
 * claim a consumer feels.
 */

describe('public surface', () => {
  it('⛔ no longer exports isRichSchema — format 3 says kind: "form"', async () => {
    // Removed 2026-10-05: its readers (the runtime's field defaults, the build's runtime schema)
    // went when the runtime stopped filling field defaults, and the editor — its last reader,
    // outside framework — reads a format-3 value's `kind` instead. What makes a value a form is
    // tested where it is decided: `framework/schemas/tests/foundation.test.js`.
    const entry = await import('../src/index.js')
    expect(entry.isRichSchema).toBeUndefined()
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
