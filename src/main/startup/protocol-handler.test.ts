import type { App } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  extractProtocolUrlFromArgv,
  registerProtocolHandlers,
  isPairingProtocolUrl,
  ALL_SCHEMES,
  PRIMARY_SCHEME
} from './protocol-handler'

function makeFakeApp(): {
  app: App
  on: ReturnType<typeof vi.fn>
  setAsDefaultProtocolClient: ReturnType<typeof vi.fn>
  isDefaultProtocolClient: ReturnType<typeof vi.fn>
  listeners: Map<string, ((...args: unknown[]) => void)[]>
} {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (!listeners.has(event)) {
      listeners.set(event, [])
    }
    listeners.get(event)!.push(cb)
  })
  const setAsDefaultProtocolClient = vi.fn(() => true)
  const isDefaultProtocolClient = vi.fn(() => false)
  const app = {
    on,
    setAsDefaultProtocolClient,
    isDefaultProtocolClient
  } as unknown as App
  return { app, on, setAsDefaultProtocolClient, isDefaultProtocolClient, listeners }
}

describe('registerProtocolHandlers', () => {
  it('registers primary and alias schemes as default protocol clients', () => {
    const onUrl = vi.fn()
    const fake = makeFakeApp()

    registerProtocolHandlers({ app: fake.app, onUrl })

    // primary + aliases
    expect(fake.setAsDefaultProtocolClient).toHaveBeenCalledTimes(ALL_SCHEMES.length)
    expect(fake.setAsDefaultProtocolClient).toHaveBeenCalledWith(PRIMARY_SCHEME)
    for (const alias of ALL_SCHEMES.filter((s) => s !== PRIMARY_SCHEME)) {
      expect(fake.setAsDefaultProtocolClient).toHaveBeenCalledWith(alias)
    }
  })

  it('registers open-url listener on macOS', () => {
    const onUrl = vi.fn()
    const fake = makeFakeApp()

    registerProtocolHandlers({ app: fake.app, onUrl, platform: 'darwin' })

    expect(fake.on).toHaveBeenCalledWith('open-url', expect.any(Function))
  })

  it('does NOT register open-url listener on non-macOS platforms', () => {
    const onUrl = vi.fn()
    const fake = makeFakeApp()

    registerProtocolHandlers({ app: fake.app, onUrl, platform: 'linux' })
    expect(fake.listeners.get('open-url')).toBeUndefined()

    registerProtocolHandlers({ app: fake.app, onUrl, platform: 'win32' })
    registerProtocolHandlers({ app: fake.app, onUrl, platform: 'darwin', listenForOpenUrl: false })
    expect(fake.listeners.get('open-url')).toBeUndefined()
  })

  it('forwards open-url events to the consumer', () => {
    const onUrl = vi.fn()
    const fake = makeFakeApp()

    registerProtocolHandlers({ app: fake.app, onUrl, platform: 'darwin' })

    const handlers = fake.listeners.get('open-url')
    expect(handlers).toBeDefined()
    expect(handlers!.length).toBe(1)

    handlers![0]!({}, 'hivecode://pair?code=abc123')
    expect(onUrl).toHaveBeenCalledWith('hivecode://pair?code=abc123')
  })
})

describe('extractProtocolUrlFromArgv', () => {
  it('extracts a hivecode URL from argv', () => {
    expect(
      extractProtocolUrlFromArgv([
        '/Applications/HiveCode.app/Contents/MacOS/HiveCode',
        'hivecode://pair?code=abc123'
      ])
    ).toBe('hivecode://pair?code=abc123')
  })

  it('extracts an orca compatibility URL from argv', () => {
    expect(
      extractProtocolUrlFromArgv([
        '/opt/hivecode/hivecode-linux.AppImage',
        'orca://pair?code=xyz789'
      ])
    ).toBe('orca://pair?code=xyz789')
  })

  it('returns null when no protocol URL is present', () => {
    expect(
      extractProtocolUrlFromArgv(['/Applications/HiveCode.app/Contents/MacOS/HiveCode', '--serve'])
    ).toBeNull()
  })

  it('returns null for empty argv', () => {
    expect(extractProtocolUrlFromArgv([])).toBeNull()
  })

  it('handles macOS -- separator before URL', () => {
    expect(
      extractProtocolUrlFromArgv([
        '/Applications/HiveCode.app/Contents/MacOS/HiveCode',
        '--',
        'hivecode://pair?code=abc123'
      ])
    ).toBe('hivecode://pair?code=abc123')
  })

  it('only matches supported schemes', () => {
    expect(
      extractProtocolUrlFromArgv(
        ['/path/to/app', 'https://example.com', 'ftp://files.example.com'],
        ALL_SCHEMES
      )
    ).toBeNull()
  })

  it('uses custom scheme list when provided', () => {
    expect(extractProtocolUrlFromArgv(['/path/to/app', 'custom://hello'], ['custom'])).toBe(
      'custom://hello'
    )
  })
})

describe('Protocol URL scheme constants', () => {
  it('accepts only pairing authorities on the product and compatibility schemes', () => {
    expect(['hivecode://pair?code=abc', 'orca://pair?code=xyz'].every(isPairingProtocolUrl)).toBe(
      true
    )
    expect(
      [
        'https://pair',
        'hivecode://pairing',
        'hivecode://user@pair',
        'hivecode://pair:123',
        'invalid'
      ].some(isPairingProtocolUrl)
    ).toBe(false)
  })
  it('primary scheme is hivecode', () => {
    expect(PRIMARY_SCHEME).toBe('hivecode')
  })

  it('accepted schemes include orca for compatibility', () => {
    expect(ALL_SCHEMES).toContain('hivecode')
    expect(ALL_SCHEMES).toContain('orca')
  })
})
