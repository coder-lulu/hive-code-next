import { describe, expect, it } from 'vitest'
import type { HostCatalogEntry, HostProfile } from '../transport/types'
import {
  projectRuntimeSelectorEntries,
  type RuntimeSelectorConnectionStates
} from './runtime-selector-presentation'

function runtime(id: string, overrides: Partial<HostCatalogEntry> = {}): HostCatalogEntry {
  return {
    id,
    name: id,
    endpoint: `ws://${id}`,
    publicKeyB64: `key-${id}`,
    lastConnected: 0,
    credentialStatus: 'ready',
    profile: null,
    ...overrides
  }
}

function profile(id: string): HostProfile {
  return {
    id,
    name: id,
    endpoint: `ws://${id}`,
    deviceToken: `token-${id}`,
    publicKeyB64: `key-${id}`,
    lastConnected: 0
  }
}

describe('runtime selector presentation', () => {
  it('groups account runtimes before local-only pairings', () => {
    const entries = projectRuntimeSelectorEntries(
      [
        runtime('local', { accessSources: ['manual-pairing'] }),
        runtime('both', { accessSources: ['manual-pairing', 'account-claimed'] }),
        runtime('account', { accessSources: ['account-claimed'] })
      ],
      {},
      'both',
      100
    )

    expect(entries.map((entry) => [entry.id, entry.group, entry.selected])).toEqual([
      ['both', 'account', true],
      ['account', 'account', false],
      ['local', 'local', false]
    ])
  })

  it('uses green only for evidence-backed online state', () => {
    const states: RuntimeSelectorConnectionStates = {
      connected: 'connected',
      retrying: 'reconnecting'
    }
    const entries = projectRuntimeSelectorEntries(
      [
        runtime('connected'),
        runtime('presence', {
          accessSources: ['account-claimed'],
          accountPresence: 'ONLINE'
        }),
        runtime('retrying'),
        runtime('offline', { credentialStatus: 'cloud-offline' })
      ],
      states,
      null,
      100
    )

    expect(entries.map((entry) => [entry.id, entry.statusLabel, entry.tone])).toEqual([
      ['presence', '在线', 'success'],
      ['connected', '在线', 'success'],
      ['retrying', '正在重连', 'warning'],
      ['offline', '离线', 'neutral']
    ])
  })

  it('does not translate an unavailable connection into a failed process claim', () => {
    const [entry] = projectRuntimeSelectorEntries(
      [runtime('runtime', { credentialStatus: 'temporarily-unavailable' })],
      {},
      null,
      100
    )

    expect(entry.statusLabel).toBe('不可验证')
    expect(entry.detail).toContain('配对凭据暂时不可用')
    expect(entry.detail).not.toMatch(/失败|退出/)
  })

  it('does not let account presence override failed mobile access', () => {
    const entries = projectRuntimeSelectorEntries(
      [
        runtime('auth-failed', {
          accessSources: ['account-claimed'],
          accountPresence: 'ONLINE',
          credentialStatus: 'ready',
          profile: profile('auth-failed')
        }),
        runtime('relay-unavailable', {
          accessSources: ['account-claimed'],
          accountPresence: 'ONLINE',
          credentialStatus: 'cloud-unavailable'
        })
      ],
      { 'auth-failed': 'auth-failed' },
      null,
      100
    )

    expect(entries.map((entry) => [entry.id, entry.statusLabel, entry.tone])).toEqual([
      ['auth-failed', '需重新配对', 'warning'],
      ['relay-unavailable', '不可连接', 'neutral']
    ])
  })

  it('only enables runtimes with a usable connection profile', () => {
    const entries = projectRuntimeSelectorEntries(
      [
        runtime('ready', { profile: profile('ready') }),
        runtime('missing-profile', {
          accountPresence: 'ONLINE',
          credentialStatus: 'cloud-unavailable'
        })
      ],
      {},
      null,
      100
    )

    expect(entries.map((entry) => [entry.id, entry.selectable])).toEqual([
      ['ready', true],
      ['missing-profile', false]
    ])
  })
})
