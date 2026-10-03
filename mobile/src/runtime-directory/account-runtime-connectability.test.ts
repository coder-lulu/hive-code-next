import { describe, expect, it } from 'vitest'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import { accountRuntimeCanRequestConnection } from './account-runtime-connectability'

const connectable = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  createdAt: '2026-08-31T00:00:00Z',
  claimedAt: '2026-08-31T00:00:00Z',
  updatedAt: '2026-08-31T00:00:00Z',
  lastHeartbeatAt: '2026-08-31T00:00:00Z',
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  freeDiskBytes: null,
  connectionCapabilities: ['hive-relay']
} satisfies AccountRuntimeDirectoryEntry

describe('account Runtime connection gate', () => {
  it('allows a current identity-proof Runtime with a Hive Relay route', () => {
    expect(accountRuntimeCanRequestConnection(connectable)).toBe(true)
  })

  it.each([
    { presence: 'DEGRADED' as const },
    { readiness: 'RECOVERING' as const },
    { clientAuthMode: 'MTLS' as const },
    { credentialState: 'EXPIRED' as const },
    { connectionCapabilities: ['hive-direct'] },
    { connectionCapabilities: ['orca-relay'] }
  ])('rejects a Runtime that Cloud would refuse: %o', (override) => {
    expect(accountRuntimeCanRequestConnection({ ...connectable, ...override })).toBe(false)
  })
})
