import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import { installHiveAccountRuntimeAccess } from '../hive-runtime-cloud/hive-account-runtime-access'
import {
  listRuntimeEnvironmentCatalog,
  resolveRuntimeEnvironmentCatalogEntry
} from './runtime-environment-account-routing'

const localStore = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('../../shared/runtime-environment-store', () => ({
  listEnvironments: () => localStore.rows
}))
const selfId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let uninstall: (() => void) | undefined

afterEach(() => {
  uninstall?.()
  localStore.rows = []
})

function account(runtimeRecordId: string): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    deviceName: 'Same workstation',
    status: 'CLAIMED',
    runtimeVersion: '1.0.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 1,
    createdAt: 1,
    updatedAt: 2,
    claimedAt: 1,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 2,
    observedAt: 2,
    freeDiskBytes: 1024,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay']
  }
}

function paired(id: string, runtimeRecordId: string) {
  return {
    id,
    runtimeRecordId,
    name: 'Same workstation',
    runtimeId: null,
    createdAt: 1,
    updatedAt: 2,
    lastUsedAt: null,
    endpoints: [
      {
        id: 'ws',
        kind: 'websocket',
        label: 'LAN',
        endpoint: 'ws://same-label',
        deviceToken: 'test-token',
        publicKeyB64: 'test-key'
      }
    ],
    preferredEndpointId: 'ws'
  }
}

function install(getLocalRuntimeRecordId: () => string | null) {
  const items = [account(selfId), account(otherId)]
  uninstall = installHiveAccountRuntimeAccess({
    getLocalRuntimeRecordId,
    directory: {
      getState: () => ({
        status: 'READY',
        accountId: 'account-1',
        sessionGeneration: 1,
        items,
        lastSyncedAt: 2,
        errorCode: null
      })
    },
    transport: {} as never
  })
  return items
}

describe('current computer is not its own remote Runtime', () => {
  it('uses main-process identity on the first list and preserves another identically named computer', () => {
    const items = install(() => selfId)
    localStore.rows = [paired('self-pairing', selfId), paired('other-pairing', otherId)]
    const before = JSON.stringify(localStore.rows)
    expect(listRuntimeEnvironmentCatalog('unused')).toEqual([
      expect.objectContaining({ id: 'other-pairing', runtimeRecordId: otherId })
    ])
    expect(items).toHaveLength(2)
    expect(JSON.stringify(localStore.rows)).toBe(before)
    expect(() => resolveRuntimeEnvironmentCatalogEntry('unused', 'self-pairing')).toThrow(
      'current computer'
    )
    expect(() =>
      resolveRuntimeEnvironmentCatalogEntry('unused', `account-runtime:${selfId}`)
    ).toThrow('current computer')
    expect(
      resolveRuntimeEnvironmentCatalogEntry('unused', `account-runtime:${otherId}`).runtimeRecordId
    ).toBe(otherId)
  })

  it('rechecks authoritative identity after registration without persisting or deleting catalog entries', () => {
    let currentId: string | null = null
    const items = install(() => currentId)
    expect(listRuntimeEnvironmentCatalog('unused')).toHaveLength(2)
    currentId = selfId
    expect(listRuntimeEnvironmentCatalog('unused').map((row) => row.runtimeRecordId)).toEqual([
      otherId
    ])
    expect(() => resolveRuntimeEnvironmentCatalogEntry('unused', selfId)).toThrow(
      'current computer'
    )
    expect(items).toHaveLength(2)
    currentId = null
    expect(listRuntimeEnvironmentCatalog('unused')).toHaveLength(2)
  })
})
