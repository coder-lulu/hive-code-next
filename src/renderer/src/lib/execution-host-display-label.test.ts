import { describe, expect, it } from 'vitest'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  projectHiveRuntimeAccountClaim,
  type HiveAccountRuntimeDirectoryEntry,
  type HiveAccountRuntimeDirectoryState,
  type HiveRuntimePendingDisplayName
} from '../../../shared/hive-runtime-cloud'
import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import {
  selectLocalAccountRuntime,
  selectExecutionHostDisplayLabels,
  isAccountClaimedExecutionHost
} from './execution-host-display-label'
import { buildDesktopHomeModel } from '../components/landing/desktop-home-model'

const runtimeRecordId = '123e4567-e89b-42d3-a456-426614174000'
function runtime(
  overrides: Partial<HiveAccountRuntimeDirectoryEntry> = {}
): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    status: 'CLAIMED',
    runtimeVersion: '1.5',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 9,
    ownershipEpoch: 2,
    createdAt: 1,
    updatedAt: 1,
    claimedAt: 1,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 1,
    observedAt: 1,
    freeDiskBytes: null,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    cloudDisplayName: 'Shared desk',
    cloudDisplayNameVersion: 3,
    deviceName: 'Device name',
    ...overrides
  }
}
function state() {
  const accountRuntimeDirectory: HiveAccountRuntimeDirectoryState = {
    ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
    status: 'READY',
    accountId: 'account-1',
    sessionGeneration: 7,
    items: [runtime()],
    pendingDisplayNames: []
  }
  return {
    settings: {
      hostSettingOverrides: {
        local: { displayLabel: 'Personal local note' },
        [toRuntimeExecutionHostId('account-runtime:remote')]: { displayLabel: 'Old paired note' }
      }
    },
    runtimeEnvironments: [
      { id: 'account-runtime:remote', accountClaim: projectHiveRuntimeAccountClaim(runtime()) }
    ],
    accountRuntimeDirectory,
    localRuntimeOwnership: {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      relation: 'CLAIMED_BY_CURRENT' as const,
      accountId: 'account-1',
      sessionGeneration: 7,
      runtimeRecordId,
      ownershipEpoch: 2
    }
  }
}
describe('confirmed cloud host display labels', () => {
  it('uses the same alias for the current computer and a paired cloud host while preserving notes and routing IDs', () => {
    const fixture = state(),
      oldPreferences = JSON.stringify(fixture.settings)
    const labels = selectExecutionHostDisplayLabels(fixture)
    expect(labels.get('local')).toBe('Shared desk')
    expect(labels.get(toRuntimeExecutionHostId('account-runtime:remote'))).toBe('Shared desk')
    expect(JSON.stringify(fixture.settings)).toBe(oldPreferences)
    expect(fixture.runtimeEnvironments[0].id).toBe('account-runtime:remote')
    expect(isAccountClaimedExecutionHost(fixture, 'local')).toBe(true)
  })
  it('ignores a current computer cloud binding from another account or session', () => {
    const fixture = state()
    expect(
      selectLocalAccountRuntime({
        ...fixture,
        localRuntimeOwnership: {
          ...fixture.localRuntimeOwnership,
          accountId: 'account-2'
        }
      })
    ).toBeNull()
    expect(
      selectLocalAccountRuntime({
        ...fixture,
        localRuntimeOwnership: {
          ...fixture.localRuntimeOwnership,
          sessionGeneration: 8
        }
      })
    ).toBeNull()
    expect(
      selectExecutionHostDisplayLabels({
        ...fixture,
        localRuntimeOwnership: {
          ...fixture.localRuntimeOwnership,
          relation: 'ANALYZING'
        }
      }).get('local')
    ).toBe('Personal local note')
  })
  it('requires the ownership epoch proof and ignores a different Runtime record even with equal names', () => {
    const fixture = state()
    expect(
      selectLocalAccountRuntime({
        ...fixture,
        localRuntimeOwnership: {
          ...fixture.localRuntimeOwnership,
          ownershipEpoch: 1
        }
      })
    ).toBeNull()
    expect(
      selectLocalAccountRuntime({
        ...fixture,
        localRuntimeOwnership: {
          ...fixture.localRuntimeOwnership,
          runtimeRecordId: '223e4567-e89b-42d3-a456-426614174000'
        }
      })
    ).toBeNull()
  })
  it('shows a confirmed receipt until the directory catches up but never shows an unconfirmed or cross-epoch draft', () => {
    const fixture = state()
    const pending: HiveRuntimePendingDisplayName = {
      runtimeRecordId,
      desiredName: 'Confirmed rename',
      revision: 1,
      status: 'CONFIRMED',
      errorCode: null,
      expectedOwnershipEpoch: 2,
      expectedCloudDisplayNameVersion: 3,
      confirmedCloudDisplayNameVersion: 4,
      latestCloudDisplayName: null,
      latestCloudDisplayNameVersion: null,
      retryNotBefore: null
    }
    fixture.accountRuntimeDirectory = {
      ...fixture.accountRuntimeDirectory,
      pendingDisplayNames: [pending]
    }
    expect(selectExecutionHostDisplayLabels(fixture).get('local')).toBe('Confirmed rename')
    fixture.accountRuntimeDirectory = {
      ...fixture.accountRuntimeDirectory,
      pendingDisplayNames: [{ ...pending, status: 'UNCONFIRMED' }]
    }
    expect(selectExecutionHostDisplayLabels(fixture).get('local')).toBe('Shared desk')
    fixture.accountRuntimeDirectory = {
      ...fixture.accountRuntimeDirectory,
      pendingDisplayNames: [{ ...pending, expectedOwnershipEpoch: 1 }]
    }
    expect(selectExecutionHostDisplayLabels(fixture).get('local')).toBe('Shared desk')
  })
  it('falls back to reported device and short ID rather than a personal note for claimed hosts', () => {
    const fixture = state()
    fixture.accountRuntimeDirectory = {
      ...fixture.accountRuntimeDirectory,
      items: [runtime({ cloudDisplayName: null })]
    }
    expect(selectExecutionHostDisplayLabels(fixture).get('local')).toBe('Device name')
    fixture.accountRuntimeDirectory = {
      ...fixture.accountRuntimeDirectory,
      items: [runtime({ cloudDisplayName: null, deviceName: null })]
    }
    expect(selectExecutionHostDisplayLabels(fixture).get('local')).toBe('Runtime 123e4567')
  })
  it('changes homepage host labels without changing workspace names, identity, or execution location', () => {
    const input = {
      repos: [{ id: 'repo', displayName: 'Project', path: '/code' }],
      worktreesByRepo: {
        repo: [{ id: 'worktree', repoId: 'repo', displayName: 'Workspace', path: '/code' }]
      },
      tabsByWorktree: {},
      openFiles: [],
      hostLabelById: selectExecutionHostDisplayLabels(state())
    }
    const before = buildDesktopHomeModel(input)
    const changed = state()
    changed.accountRuntimeDirectory = {
      ...changed.accountRuntimeDirectory,
      items: [runtime({ cloudDisplayName: 'Renamed desk', cloudDisplayNameVersion: 4 })]
    }
    const after = buildDesktopHomeModel({
      ...input,
      hostLabelById: selectExecutionHostDisplayLabels(changed)
    })
    expect(before.workspaces[0].hostDisplayName).toBe('Shared desk')
    expect(after.workspaces[0]).toMatchObject({
      name: 'Workspace',
      path: '/code',
      executionHostId: 'local',
      hostLabel: 'local',
      hostDisplayName: 'Renamed desk',
      identityKey: before.workspaces[0].identityKey
    })
    expect(after.projects[0]).toMatchObject({
      name: 'Project',
      hostDisplayName: 'Renamed desk',
      executionHostId: 'local'
    })
  })
})
