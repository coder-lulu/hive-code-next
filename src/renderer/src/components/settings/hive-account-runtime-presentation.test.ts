import { describe, expect, it } from 'vitest'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import { resolveHiveAccountRuntimePresentation } from './hive-account-runtime-presentation'

const runtime: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'runtime-1',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  claimedAt: 1,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  lastHeartbeatAt: Date.now(),
  observedAt: Date.now(),
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
}

const directory: HiveAccountRuntimeDirectoryState = {
  status: 'READY',
  accountId: 'account-1',
  sessionGeneration: 1,
  items: [runtime],
  lastSyncedAt: Date.now(),
  errorCode: null
}

const ownership: HiveLocalRuntimeOwnershipState = {
  stateRevision: 1,
  relation: 'CLAIMED_BY_CURRENT',
  accountId: 'account-1',
  sessionGeneration: 1,
  runtimeRecordId: runtime.runtimeRecordId,
  claimCapabilityAvailable: false,
  presence: 'ONLINE',
  checkedAt: Date.now(),
  errorCode: null
}

describe('resolveHiveAccountRuntimePresentation', () => {
  it('separates HiveCloud presence from cross-device relay availability', () => {
    const connected = resolveHiveAccountRuntimePresentation(directory, ownership)
    expect(connected.online).toBe(true)
    expect(connected.remoteAccess).toBe('Enabled')

    const directOnly = resolveHiveAccountRuntimePresentation(
      {
        ...directory,
        items: [{ ...runtime, connectionCapabilities: ['orca-direct'] }]
      },
      ownership
    )
    expect(directOnly.online).toBe(true)
    expect(directOnly.label).toBe('Online')
    expect(directOnly.connectionStatus).toBe('Running normally')
    expect(directOnly.remoteAccess).toBe('Unavailable')

    const mtls = resolveHiveAccountRuntimePresentation(
      { ...directory, items: [{ ...runtime, clientAuthMode: 'MTLS' }] },
      ownership
    )
    expect(mtls.online).toBe(true)
    expect(mtls.remoteAccess).toBe('Unavailable')
  })

  it.each([
    [
      'recovering readiness',
      { credentialState: 'EXPIRING' as const, readiness: 'RECOVERING' as const }
    ],
    ['degraded presence', { presence: 'DEGRADED' as const }],
    ['degraded readiness', { readiness: 'DEGRADED' as const }]
  ])('does not report a degraded Runtime as online for %s', (_case, partial) => {
    const result = resolveHiveAccountRuntimePresentation(
      { ...directory, items: [{ ...runtime, ...partial }] },
      ownership
    )
    expect(result.online).toBe(false)
    expect(result.remoteAccess).toBe('Unavailable')
  })

  it('distinguishes an unregistered Runtime from a pending claim', () => {
    const unregistered = resolveHiveAccountRuntimePresentation(directory, {
      ...ownership,
      relation: 'UNREGISTERED',
      runtimeRecordId: null,
      claimCapabilityAvailable: false,
      presence: 'WAITING_RUNTIME'
    })
    expect(unregistered.label).toBe('Not linked')
    expect(unregistered.canClaim).toBe(true)

    const pending = resolveHiveAccountRuntimePresentation(directory, {
      ...ownership,
      relation: 'PENDING_CLAIM',
      claimCapabilityAvailable: true,
      presence: 'CLAIM_PENDING'
    })
    expect(pending.label).toBe('Waiting to be claimed')
    expect(pending.canClaim).toBe(true)
    expect(pending.remoteAccess).toBe('Unavailable')
  })

  it('suppresses cloud access while the account authorization is invalid', () => {
    const result = resolveHiveAccountRuntimePresentation(directory, ownership, false)

    expect(result.online).toBe(false)
    expect(result.label).toBe('Sign-in required')
    expect(result.connectionStatus).toBe('Authorization required')
    expect(result.remoteAccess).toBe('Unavailable')
  })

  it('keeps rotating credentials and disabled cloud access out of the online state', () => {
    const rotating = resolveHiveAccountRuntimePresentation(
      { ...directory, items: [{ ...runtime, credentialState: 'ROTATING' }] },
      ownership
    )
    expect(rotating.label).toBe('Refreshing connection credential')
    expect(rotating.online).toBe(false)

    const disabled = resolveHiveAccountRuntimePresentation(
      { ...directory, status: 'DISABLED', items: [] },
      { ...ownership, presence: 'DISABLED' }
    )
    expect(disabled.label).toBe('Not enabled')
    expect(disabled.canRetry).toBe(false)
  })
})
