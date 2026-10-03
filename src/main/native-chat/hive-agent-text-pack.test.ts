import { describe, expect, it, vi } from 'vitest'
import { resolveHiveAgentTextPack, type HiveAgentTextPackSource } from './hive-agent-text-pack'
import { textPackManifestFixture } from './hive-agent-text-pack.test-fixture'

const source =
  (manifest: unknown): HiveAgentTextPackSource =>
  () => ({
    manifest,
    assertCurrent: () => undefined
  })

describe('P2 text Pack capability admission', () => {
  it('preserves snapshot method receivers and the original guard across replacements and revocation', () => {
    const first = {
      manifest: textPackManifestFixture(),
      current: true,
      assertCurrent() {
        if (!this.current) {
          throw new Error('private-snapshot-diagnostics')
        }
      }
    }
    let snapshot = first
    const pack = resolveHiveAgentTextPack(() => snapshot, 'personal', 'CHAT_COMPLETIONS')
    expect(pack.binding.profileId).toBe('personal')
    snapshot = {
      ...first,
      manifest: structuredClone(first.manifest),
      assertCurrent() {
        if (!this.current) {
          throw new Error('private-replacement-diagnostics')
        }
      }
    }
    expect(pack.assertCurrent).not.toThrow()
    snapshot.current = false
    expect(pack.assertCurrent).toThrow(/^hive_agent_pack_unavailable$/)
    snapshot.current = true
    first.assertCurrent = vi.fn()
    first.current = false
    expect(pack.assertCurrent).toThrow(/^hive_agent_pack_unavailable$/)
  })
  it.each([
    undefined,
    () => null,
    () => {
      throw new Error('private-loader-diagnostics')
    },
    () => ({ manifest: textPackManifestFixture(), assertCurrent: undefined })
  ])('sanitizes missing, failing or unguarded sources', (readPack) => {
    expect(() =>
      resolveHiveAgentTextPack(readPack as HiveAgentTextPackSource, 'personal', 'CHAT_COMPLETIONS')
    ).toThrow(/^hive_agent_pack_unavailable$/)
  })

  it.each([
    { nodeVersion: '0.0.0' },
    { piCoreVersion: '0.0.0' },
    { piAiVersion: '0.0.0' },
    { sourceCommit: '0'.repeat(40) },
    { platform: process.platform === 'win32' ? 'linux' : 'win32' },
    { architecture: process.arch === 'x64' ? 'arm64' : 'x64' },
    { capabilities: [] },
    { protocols: ['RESPONSES'] },
    { profiles: [] },
    { schemaVersion: 2 },
    { apiKey: 'private-credential' }
  ])('refuses incompatible or unsupported declarations %#', (patch) => {
    expect(() =>
      resolveHiveAgentTextPack(
        source({ ...textPackManifestFixture(), ...patch }),
        'personal',
        'CHAT_COMPLETIONS'
      )
    ).toThrow(/^hive_agent_pack_unavailable$/)
  })

  it('requires the exact profile and protocol intersection without fallback', () => {
    const manifest = textPackManifestFixture()
    manifest.profiles[0]!.protocols = ['RESPONSES']
    expect(() =>
      resolveHiveAgentTextPack(source(manifest), 'personal', 'CHAT_COMPLETIONS')
    ).toThrow('hive_agent_pack_unavailable')
    expect(() => resolveHiveAgentTextPack(source(manifest), 'other', 'RESPONSES')).toThrow(
      'hive_agent_pack_unavailable'
    )
    expect(
      resolveHiveAgentTextPack(source(manifest), 'personal', 'RESPONSES').binding.protocol
    ).toBe('RESPONSES')
  })

  it.each([
    [32_000, 4_000, 16_000, 2_000],
    [600, 200, 600, 200],
    [1, 1, 1, 1]
  ])(
    'narrows local token ceilings and freezes the exact binding',
    (input, output, expectedIn, expectedOut) => {
      const manifest = textPackManifestFixture()
      manifest.profiles[0]!.maxInputTokens = input
      manifest.profiles[0]!.maxOutputTokens = output
      const { binding } = resolveHiveAgentTextPack(source(manifest), 'personal', 'CHAT_COMPLETIONS')
      expect(binding).toEqual({
        schemaVersion: 1,
        packRevision: manifest.packRevision,
        profileId: 'personal',
        protocol: 'CHAT_COMPLETIONS',
        toolPolicy: 'empty',
        maxInputTokens: expectedIn,
        maxOutputTokens: expectedOut
      })
      expect(Object.isFrozen(binding)).toBe(true)
      expect(Reflect.set(binding, 'maxOutputTokens', 9000)).toBe(false)
    }
  )

  it('retains the original guard when a replacement snapshot has the same declaration', () => {
    const manifest = textPackManifestFixture()
    let current = true
    const first = {
      manifest,
      assertCurrent: vi.fn(() => {
        if (!current) {
          throw new Error('private-scope-diagnostics')
        }
      })
    }
    let snapshot = first
    const pack = resolveHiveAgentTextPack(() => snapshot, 'personal', 'CHAT_COMPLETIONS')
    snapshot = { manifest: structuredClone(manifest), assertCurrent: vi.fn() }
    pack.assertCurrent()
    current = false
    first.assertCurrent = vi.fn()
    expect(pack.assertCurrent).toThrow(/^hive_agent_pack_unavailable$/)
  })

  it.each(['revision', 'same-revision-content', 'missing', 'revoked', 'malformed'])(
    'refuses a stale %s snapshot',
    (change) => {
      let manifest: unknown = textPackManifestFixture()
      let available = true
      let current = true
      const pack = resolveHiveAgentTextPack(
        () =>
          available
            ? {
                manifest,
                assertCurrent: () => {
                  if (!current) {
                    throw new Error('private-loader-diagnostics')
                  }
                }
              }
            : null,
        'personal',
        'CHAT_COMPLETIONS'
      )
      switch (change) {
        case 'revision':
          manifest = { ...textPackManifestFixture(), packRevision: 'c'.repeat(64) }
          break
        case 'same-revision-content': {
          const changed = textPackManifestFixture()
          changed.profiles[0]!.maxOutputTokens = 10
          manifest = changed
          break
        }
        case 'missing':
          available = false
          break
        case 'revoked':
          current = false
          break
        case 'malformed':
          manifest = { apiKey: 'private-credential' }
          break
      }
      expect(pack.assertCurrent).toThrow(/^hive_agent_pack_unavailable$/)
      expect(pack.binding.packRevision).toBe('b'.repeat(64))
    }
  )
})
