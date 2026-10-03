import { describe, expect, it } from 'vitest'
import type { RuntimeEnvironmentStatus } from '@/store/slices/runtime-status-types'
import type { RuntimeStatus } from '../../../shared/runtime-types'
import { getOfflineRuntimeEnvironmentIds, isOfflineRuntimeOwner } from './runtime-offline-directory'

function runtimeStatus(runtimeId: string): RuntimeStatus {
  return {
    runtimeId,
    rendererGraphEpoch: 0,
    graphStatus: 'ready',
    authoritativeWindowId: null,
    liveTabCount: 0,
    liveLeafCount: 0
  }
}

describe('offline runtime directory membership', () => {
  it('uses disconnected transport even when the last runtime status is cached', () => {
    const entry = {
      status: { ready: true },
      snapshot: { transport: 'disconnected', verification: 'verified' }
    } as unknown as RuntimeEnvironmentStatus
    const offline = getOfflineRuntimeEnvironmentIds(new Map([['remote', entry]]))
    expect(isOfflineRuntimeOwner('runtime:remote', offline)).toBe(true)
    expect(isOfflineRuntimeOwner('local', offline)).toBe(false)
    expect(isOfflineRuntimeOwner('runtime:another', offline)).toBe(false)
  })

  it('keeps checking hosts offline until transport reachability is proven', () => {
    const entries = new Map<string, RuntimeEnvironmentStatus>([
      [
        'checking',
        {
          status: null,
          checkedAt: 1,
          snapshot: {
            environmentId: 'checking',
            pairingRevision: 1,
            sequence: 1,
            checkedAt: 1,
            status: null,
            verification: 'checking',
            transport: 'connecting'
          }
        }
      ],
      [
        'connected',
        {
          status: null,
          checkedAt: 1,
          snapshot: {
            environmentId: 'connected',
            pairingRevision: 1,
            sequence: 1,
            checkedAt: 1,
            status: null,
            verification: 'unavailable',
            transport: 'ready'
          }
        }
      ]
    ])
    expect(getOfflineRuntimeEnvironmentIds(entries)).toEqual(new Set(['checking']))
    expect(getOfflineRuntimeEnvironmentIds(new Map()).size).toBe(0)
  })

  it('keeps a catalogued runtime without a status result out of the online directory', () => {
    expect(getOfflineRuntimeEnvironmentIds(new Map(), ['remote'])).toEqual(new Set(['remote']))
  })

  it('keeps an answered account route online beside a failed local-pairing snapshot', () => {
    const entry: RuntimeEnvironmentStatus = {
      status: runtimeStatus('cloud-runtime'),
      checkedAt: 2,
      snapshot: {
        environmentId: 'remote',
        pairingRevision: 1,
        sequence: 2,
        checkedAt: 2,
        status: null,
        verification: 'unavailable',
        transport: 'disconnected'
      }
    }

    expect(getOfflineRuntimeEnvironmentIds(new Map([['remote', entry]]))).toEqual(new Set())
  })

  it('moves a runtime back online and keeps nested SSH ownership separate from local SSH', () => {
    const entries = new Map<string, RuntimeEnvironmentStatus>([
      ['remote id', { status: null, checkedAt: 1 }]
    ])
    const offline = getOfflineRuntimeEnvironmentIds(entries)
    expect(isOfflineRuntimeOwner('runtime:remote%20id', offline)).toBe(true)
    expect(isOfflineRuntimeOwner('ssh:server', offline, 'remote id')).toBe(true)
    expect(isOfflineRuntimeOwner('ssh:server', offline)).toBe(false)
    entries.set('remote id', { status: {} as RuntimeEnvironmentStatus['status'], checkedAt: 2 })
    expect(getOfflineRuntimeEnvironmentIds(entries).size).toBe(0)
  })

  it('uses new control diagnostics rather than a cached ready verdict', () => {
    const entry = {
      status: { remoteControl: { state: 'ready' } },
      remoteControl: { state: 'closed' },
      checkedAt: 1
    } as unknown as RuntimeEnvironmentStatus
    expect(getOfflineRuntimeEnvironmentIds(new Map([['remote', entry]])).has('remote')).toBe(true)
    entry.remoteControl = { state: 'reconnecting' } as RuntimeEnvironmentStatus['remoteControl']
    expect(getOfflineRuntimeEnvironmentIds(new Map([['remote', entry]])).has('remote')).toBe(true)
  })
})
