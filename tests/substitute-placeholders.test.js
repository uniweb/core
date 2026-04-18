import { describe, it, expect } from '@jest/globals'
import { substitutePlaceholders } from '../src/substitute-placeholders.js'

describe('substitutePlaceholders', () => {
  describe('strings', () => {
    it('substitutes a placeholder with URL encoding by default', () => {
      expect(substitutePlaceholders('/articles/{slug}', { slug: 'my post' })).toBe(
        '/articles/my%20post',
      )
    })

    it('substitutes without encoding when encode:false', () => {
      expect(
        substitutePlaceholders('/articles/{slug}', { slug: 'my post' }, { encode: false }),
      ).toBe('/articles/my post')
    })

    it('substitutes multiple placeholders in one string', () => {
      expect(
        substitutePlaceholders(
          '/tenants/{tenantId}/articles/{slug}',
          { tenantId: 'acme', slug: 'hello' },
          { encode: false },
        ),
      ).toBe('/tenants/acme/articles/hello')
    })

    it('leaves unknown keys as literal {name}', () => {
      expect(substitutePlaceholders('/articles/{unknown}', { slug: 'x' })).toBe(
        '/articles/{unknown}',
      )
    })

    it('leaves a string without placeholders unchanged', () => {
      expect(substitutePlaceholders('plain string', { slug: 'x' })).toBe('plain string')
    })

    it('preserves literal `{ }` when braces contain whitespace', () => {
      // Critical for GraphQL selection sets that contain `{ field }`.
      expect(
        substitutePlaceholders('query { articles { id } }', { slug: 'x' }),
      ).toBe('query { articles { id } }')
    })

    it('does not match numeric names like {1}', () => {
      expect(substitutePlaceholders('{1}', { 1: 'x' })).toBe('{1}')
    })

    it('does not match names with spaces or operators', () => {
      expect(substitutePlaceholders('{ a | b }', { a: 'x' })).toBe('{ a | b }')
    })

    it('treats null/undefined context values as missing', () => {
      expect(substitutePlaceholders('/articles/{slug}', { slug: null })).toBe(
        '/articles/{slug}',
      )
      expect(substitutePlaceholders('/articles/{slug}', { slug: undefined })).toBe(
        '/articles/{slug}',
      )
    })

    it('stringifies non-string context values', () => {
      expect(
        substitutePlaceholders('/articles/{id}', { id: 42 }, { encode: false }),
      ).toBe('/articles/42')
    })

    it('handles missing context object', () => {
      expect(substitutePlaceholders('/articles/{slug}', null)).toBe('/articles/{slug}')
      expect(substitutePlaceholders('/articles/{slug}', undefined)).toBe('/articles/{slug}')
    })
  })

  describe('objects and arrays', () => {
    it('recurses into objects (useful for POST body)', () => {
      const body = {
        query: 'query Article($slug: String!) { article(slug: $slug) { id } }',
        variables: { slug: '{slug}' },
      }
      const result = substitutePlaceholders(body, { slug: 'hello' }, { encode: false })
      expect(result.variables.slug).toBe('hello')
      // The GraphQL query body should be preserved unchanged.
      expect(result.query).toBe(body.query)
    })

    it('recurses into arrays', () => {
      const result = substitutePlaceholders(
        ['{a}', '{b}', 'plain'],
        { a: 'X', b: 'Y' },
        { encode: false },
      )
      expect(result).toEqual(['X', 'Y', 'plain'])
    })

    it('preserves non-string primitives in object values', () => {
      const result = substitutePlaceholders(
        { enabled: true, count: 3, name: '{slug}' },
        { slug: 'hello' },
        { encode: false },
      )
      expect(result).toEqual({ enabled: true, count: 3, name: 'hello' })
    })

    it('does not mutate the input tree', () => {
      const input = { a: { b: '{slug}' } }
      substitutePlaceholders(input, { slug: 'x' })
      expect(input.a.b).toBe('{slug}')
    })

    it('returns a new object tree', () => {
      const input = { a: { b: '{slug}' } }
      const result = substitutePlaceholders(input, { slug: 'x' })
      expect(result).not.toBe(input)
      expect(result.a).not.toBe(input.a)
    })
  })

  describe('edge cases', () => {
    it('handles null and undefined input', () => {
      expect(substitutePlaceholders(null, { slug: 'x' })).toBe(null)
      expect(substitutePlaceholders(undefined, { slug: 'x' })).toBe(undefined)
    })

    it('handles empty string', () => {
      expect(substitutePlaceholders('', { slug: 'x' })).toBe('')
    })

    it('handles empty context', () => {
      expect(substitutePlaceholders('/articles/{slug}', {})).toBe('/articles/{slug}')
    })
  })
})
