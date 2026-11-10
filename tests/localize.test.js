import { describe, it, expect } from 'vitest'
import Website from '../src/website.js'

function site(config = {}) {
  return new Website({
    content: {
      config: { name: 'T', defaultLanguage: 'en', ...config },
      theme: {},
      pages: [{ route: '/', isIndex: true, title: 'Home', sections: [] }],
    },
  })
}

describe('Website#localize', () => {
  it('takes the entry for the language asked', () => {
    expect(site().localize({ en: 'Canada', fr: 'Le Canada' }, '', 'fr')).toBe('Le Canada')
  })

  it('⭐ falls back from a regional language to its base language', () => {
    // A footer keyed `zh` on a site whose languages are zh-CN and zh-TW drew nothing (2026-11-10).
    const words = { en: 'Ottawa, Canada', zh: '渥太華，加拿大' }
    expect(site().localize(words, '', 'zh-CN')).toBe('渥太華，加拿大')
    expect(site().localize(words, '', 'zh-TW')).toBe('渥太華，加拿大')
  })

  it('tries each shorter tag in turn, the longest first', () => {
    const words = { zh: '简体', 'zh-Hant': '繁體' }
    expect(site().localize(words, '', 'zh-Hant-TW')).toBe('繁體')
    expect(site().localize(words, '', 'zh-Hans-CN')).toBe('简体')
  })

  it('prefers the exact tag over its base', () => {
    expect(site().localize({ zh: 'base', 'zh-TW': 'regional' }, '', 'zh-TW')).toBe('regional')
  })

  it('matches a tag whatever its case', () => {
    expect(site().localize({ 'zh-cn': '渥太华' }, '', 'zh-CN')).toBe('渥太华')
  })

  it('gives the default value when no entry answers', () => {
    expect(site().localize({ en: 'Hello' }, '', 'fr')).toBe('')
    expect(site().localize({ en: 'Hello' }, 'fallback', 'fr')).toBe('fallback')
  })

  it('falls back to the default language only when asked to', () => {
    expect(site().localize({ en: 'Hello' }, '', 'fr', true)).toBe('Hello')
  })

  it('reads a JSON string of entries the same way', () => {
    expect(site().localize('{"en":"Hello","zh":"你好"}', '', 'zh-TW')).toBe('你好')
  })

  it('returns a plain string as it is', () => {
    expect(site().localize('Hello', '', 'fr')).toBe('Hello')
  })

  it('uses the active language when none is given', () => {
    const w = site({ languages: ['en', 'zh-CN'], activeLocale: 'zh-CN' })
    expect(w.localize({ en: 'Hello', zh: '你好' })).toBe('你好')
  })
})
