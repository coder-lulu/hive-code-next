import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { installHiveAccountRuntimeAccess } from '../hive-runtime-cloud/hive-account-runtime-access'
import {
  isPreDeliveryConnectionFailure,
  resolveRuntimeEnvironmentCatalogEntry
} from './runtime-environment-account-routing'

describe('Runtime environment Cloud fallback safety', () => {
  it('retries only failures proven to precede Runtime RPC delivery', () => {
    expect(
      isPreDeliveryConnectionFailure(
        new RemoteRuntimeClientError('runtime_timeout', 'connect timeout', {
          pairingStage: 'connect'
        })
      )
    ).toBe(true)
    expect(
      isPreDeliveryConnectionFailure(
        new RemoteRuntimeClientError('remote_runtime_unavailable', 'closed after send', {
          pairingStage: 'runtime'
        })
      )
    ).toBe(false)
    expect(
      isPreDeliveryConnectionFailure(
        new RemoteRuntimeClientError('remote_runtime_unavailable', 'delivery unknown')
      )
    ).toBe(false)
  })

  it('does not hide a corrupt local pairing store behind the account catalog', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'hive-runtime-routing-'))
    try {
      writeFileSync(join(userDataPath, 'orca-environments.json'), '{invalid')

      expect(() => resolveRuntimeEnvironmentCatalogEntry(userDataPath, 'account-runtime')).toThrow(
        'file is invalid'
      )
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('does not project unrelated account rows when resolving one local pairing', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'hive-runtime-routing-'))
    const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
    const matchingRuntime: HiveAccountRuntimeDirectoryEntry = {
      runtimeRecordId,
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
      freeDiskBytes: 1,
      clientAuthMode: 'IDENTITY_PROOF',
      credentialState: 'ACTIVE',
      connectionCapabilities: ['hive-relay']
    }
    const items = [matchingRuntime] as HiveAccountRuntimeDirectoryEntry[]
    Object.defineProperty(items, 1, {
      get: () => {
        throw new Error('unrelated account row was traversed')
      }
    })
    items.length = 2
    const uninstall = installHiveAccountRuntimeAccess({
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
    try {
      writeFileSync(
        join(userDataPath, 'orca-environments.json'),
        JSON.stringify({
          version: 1,
          environments: [
            {
              id: 'local-pairing',
              name: 'Local Runtime',
              createdAt: 1,
              updatedAt: 1,
              lastUsedAt: null,
              runtimeId: null,
              runtimeRecordId,
              endpoints: [
                {
                  id: 'ws-local',
                  kind: 'websocket',
                  label: 'LAN',
                  endpoint: 'ws://127.0.0.1:3999',
                  deviceToken: 'local-secret',
                  publicKeyB64: 'local-key'
                }
              ],
              preferredEndpointId: 'ws-local'
            }
          ]
        })
      )

      expect(resolveRuntimeEnvironmentCatalogEntry(userDataPath, 'local-pairing')).toMatchObject({
        id: 'local-pairing',
        accessSources: ['local-pairing', 'account-claimed'],
        accountClaim: { runtimeRecordId }
      })
    } finally {
      uninstall()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
