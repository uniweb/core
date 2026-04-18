import { describe, it, expect, jest } from '@jest/globals'
import Website from '../src/website.js'

function simpleContent(overrides = {}) {
  return {
    config: { name: 'Test', defaultLanguage: 'en', ...overrides.config },
    theme: {},
    pages: [
      { route: '/', isIndex: true, title: 'Home', sections: [] },
      { route: '/about', title: 'About', sections: [] },
    ],
    ...overrides,
  }
}

describe('Website constructor', () => {
  it('builds from { content } with no foundation', () => {
    const w = new Website({ content: simpleContent() })

    expect(w.pages).toHaveLength(2)
    expect(w.activePage?.route).toBe('/')
    expect(w.dataStore).toBeDefined()
    expect(w.fetcher).toBeDefined()
    expect(w.state).toBeDefined()
    expect(w.entityStore).toBeDefined()
  })

  it('exposes page.state as ObservableState', () => {
    const w = new Website({ content: simpleContent() })
    const page = w.pages[0]

    page.state.set('slug', 'X')
    expect(page.state.get('slug')).toBe('X')
  })

  it('exposes website.state as ObservableState', () => {
    const w = new Website({ content: simpleContent() })
    w.state.set('appearance', 'dark')
    expect(w.state.get('appearance')).toBe('dark')
  })

  it('assembles the FetcherDispatcher from the foundation transports', async () => {
    const resolve = jest.fn().mockResolvedValue({ data: ['x'] })
    const foundation = { default: { transports: { my: { resolve } } } }

    const w = new Website({
      content: simpleContent({ config: { fetcher: { transports: { default: 'my' } } } }),
      foundation,
    })
    const result = await w.fetcher.dispatch(
      { schema: 's' },
      { website: w },
    )
    expect(result.data).toEqual(['x'])
  })

  it('honors a runtime transport override', async () => {
    const foundationResolve = jest.fn()
    const bridgeResolve = jest.fn().mockResolvedValue({ data: ['bridge'] })
    const foundation = { default: { transports: { my: { resolve: foundationResolve } } } }

    const w = new Website({
      content: simpleContent({ config: { fetcher: { transports: { default: 'my' } } } }),
      foundation,
      transport: { resolve: bridgeResolve },
    })
    const result = await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(result.data).toEqual(['bridge'])
    expect(foundationResolve).not.toHaveBeenCalled()
  })

  it('preserves the transport override across rebuild({ foundation })', async () => {
    const bridgeResolve = jest.fn().mockResolvedValue({ data: ['bridge'] })
    const foundationA = { default: { transports: { my: { resolve: jest.fn() } } } }
    const foundationB = { default: { transports: { my: { resolve: jest.fn() } } } }

    const w = new Website({
      content: simpleContent({ config: { fetcher: { transports: { default: 'my' } } } }),
      foundation: foundationA,
      transport: { resolve: bridgeResolve },
    })

    w.rebuild({ foundation: foundationB })
    const result = await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(result.data).toEqual(['bridge'])
    expect(bridgeResolve).toHaveBeenCalled()
  })
})

describe('Website.rebuild', () => {
  it('content-only rebuild preserves dispatcher, dataStore, and state', () => {
    const foundation = { default: { transports: { my: { resolve: jest.fn() } } } }
    const w = new Website({ content: simpleContent(), foundation })
    const origFetcher = w.fetcher
    const origDataStore = w.dataStore
    const origState = w.state

    origDataStore.set('k', { data: [1] })
    origState.set('mode', 'A')

    w.rebuild({ content: simpleContent({ config: { name: 'Renamed' } }) })

    expect(w.fetcher).toBe(origFetcher) // preserved
    expect(w.dataStore).toBe(origDataStore) // preserved
    expect(w.state).toBe(origState) // preserved
    expect(w.dataStore.get('k')).toEqual({ data: [1] }) // cache survives
    expect(w.state.get('mode')).toBe('A') // state survives
    expect(w.config.name).toBe('Renamed') // content changed
  })

  it('foundation swap reassembles the dispatcher; cache and state survive', async () => {
    const a = jest.fn().mockResolvedValue({ data: ['a'] })
    const b = jest.fn().mockResolvedValue({ data: ['b'] })
    const foundationA = { default: { transports: { my: { resolve: a } } } }
    const foundationB = { default: { transports: { my: { resolve: b } } } }
    const content = simpleContent({ config: { fetcher: { transports: { default: 'my' } } } })

    const w = new Website({ content, foundation: foundationA })
    const origDataStore = w.dataStore
    const origState = w.state
    w.state.set('mode', 'A')

    await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(a).toHaveBeenCalledTimes(1)

    w.rebuild({ foundation: foundationB })

    expect(w.dataStore).toBe(origDataStore)
    expect(w.state).toBe(origState)
    expect(w.state.get('mode')).toBe('A')

    // Dispatcher reassembled — second fetch routes to foundationB. Key
    // derived from request is the same, so the cached entry wins regardless
    // of which fetcher would run. Clear cache first to force a real dispatch.
    w.dataStore.clear()
    await w.fetcher.dispatch({ schema: 's' }, { website: w })
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('rebuild is chainable', () => {
    const w = new Website({ content: simpleContent() })
    expect(w.rebuild({ content: simpleContent() })).toBe(w)
  })
})
