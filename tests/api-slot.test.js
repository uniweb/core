import { describe, it, expect, afterEach } from 'vitest'
import { createUniweb } from '../src/index.js'

// The slot `@uniweb/api` parks its one instance on. Core declares it and
// implements nothing — the test pins exactly that, plus the seal that makes a
// declared slot necessary in the first place.
describe('uniweb.api', () => {
  afterEach(() => {
    delete globalThis.uniweb
  })

  it('is declared null and assignable', () => {
    const uniweb = createUniweb({ config: {} })
    expect(uniweb.api).toBeNull()

    const client = { v: 1 }
    uniweb.api = client
    expect(uniweb.api).toBe(client)
  })

  it('is the only way on — the instance is sealed', () => {
    const uniweb = createUniweb({ config: {} })
    expect(Object.isSealed(uniweb)).toBe(true)
    expect(() => {
      uniweb.apiClient = {}
    }).toThrow(TypeError)
  })
})
