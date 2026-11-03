// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../shared/constants'
import { useRuntimeCloudAliasSettings } from './use-runtime-cloud-alias-settings'
const runtime: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'runtime-1',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  ownershipEpoch: 1,
  cloudDisplayName: null,
  cloudDisplayNameVersion: 1,
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
  ownershipEpoch: 1,
  claimCapabilityAvailable: false,
  presence: 'ONLINE',
  checkedAt: Date.now(),
  errorCode: null
}

const initialState = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ accountRuntimeDirectory: directory, localRuntimeOwnership: ownership })
})
afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})
it('renames the current computer only while ownership matches the account session', () => {
  const view = renderHook(() => useRuntimeCloudAliasSettings(getDefaultSettings('/tmp'), []))
  const local = view.result.current.localEnvironment
  expect(local?.runtimeRecordId).toBe(runtime.runtimeRecordId)
  if (!local) {
    throw new Error('Expected current-account local runtime')
  }
  act(() => view.result.current.open(local))
  expect(view.result.current.environment?.id).toBe('local')
  act(() => useAppStore.setState({ localRuntimeOwnership: { ...ownership, ownershipEpoch: 2 } }))
  expect(view.result.current.localEnvironment).toBeNull()
  expect(view.result.current.environment).toBeNull()
})
it.each([{ accountId: 'account-2' }, { sessionGeneration: 2 }])(
  'fences an open rename dialog when the account scope changes: %j',
  (change) => {
    const view = renderHook(() => useRuntimeCloudAliasSettings(getDefaultSettings('/tmp'), []))
    const local = view.result.current.localEnvironment
    if (!local) {
      throw new Error('Expected current-account local runtime')
    }
    act(() => view.result.current.open(local))
    act(() => useAppStore.setState({ accountRuntimeDirectory: { ...directory, ...change } }))
    expect(view.result.current.environment).toBeNull()
  }
)
