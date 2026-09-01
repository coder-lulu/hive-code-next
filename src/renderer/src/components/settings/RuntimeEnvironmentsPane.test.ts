import { describe, expect, it } from 'vitest'
import { applyProductBranding } from '@/product-brand'
import {
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  PROJECT_HOST_SETUP_RUNTIME_CAPABILITY,
  RUNTIME_PROTOCOL_VERSION,
  TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY,
  WORKSPACE_RUN_CONTEXT_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import {
  evaluateHostDetails,
  getActiveServerModeDescription,
  canConnectRuntimeEnvironment,
  getHostDetailsDescription,
  getHostDetailsSummary,
  getHostModelCapabilitySummary,
  getRuntimeCapabilitiesSummary,
  getRuntimeEnvironmentEndpointDisplay,
  getRuntimeEnvironmentInitialDetails,
  getRuntimeEnvironmentRemovalPresentation,
  getRuntimeServerConnectionState,
  isRuntimeEnvironmentRemovalBlocked,
  resolveRuntimeCloudRenameEnvironment,
  supportsLocalRuntimeEnvironmentRemoval,
  type RuntimeHostDetails
} from './RuntimeEnvironmentsPane'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'

function details(overrides: Partial<RuntimeHostDetails>): RuntimeHostDetails {
  return {
    status: 'ready',
    runtimeStatus: null,
    compatibility: null,
    error: null,
    ...overrides
  }
}

function environmentWithAccessSources(
  accessSources: PublicKnownRuntimeEnvironment['accessSources']
): PublicKnownRuntimeEnvironment {
  return {
    id: 'runtime-1',
    name: 'Build host',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: null,
    endpoints: [
      {
        id: 'endpoint-1',
        kind: 'websocket',
        label: 'Runtime',
        endpoint: 'wss://runtime.example.test'
      }
    ],
    preferredEndpointId: 'endpoint-1',
    accessSources
  }
}

describe('RuntimeEnvironmentsPane host details', () => {
  it('resolves a cloud rename target from the latest environment projection', () => {
    const initial = {
      ...environmentWithAccessSources(['account-claimed']),
      accountClaim: accountClaim(3)
    }
    const refreshed = {
      ...initial,
      name: 'Latest catalog name',
      accountClaim: accountClaim(4)
    }

    expect(
      resolveRuntimeCloudRenameEnvironment(
        [refreshed],
        initial.id,
        'account-a\u00001',
        'account-a\u00001'
      )
    ).toBe(refreshed)
  })

  it('closes a cloud rename target when it disappears or the account scope changes', () => {
    const environment = {
      ...environmentWithAccessSources(['account-claimed']),
      accountClaim: accountClaim(3)
    }

    expect(
      resolveRuntimeCloudRenameEnvironment(
        [],
        environment.id,
        'account-a\u00001',
        'account-a\u00001'
      )
    ).toBeNull()
    expect(
      resolveRuntimeCloudRenameEnvironment(
        [environment],
        environment.id,
        'account-a\u00001',
        'account-b\u00002'
      )
    ).toBeNull()
  })

  it('summarizes loading, error, compatible, and blocked hosts', () => {
    expect(getHostDetailsSummary(undefined)).toBe('Checking…')
    expect(getHostDetailsSummary(details({ status: 'error', error: 'offline' }))).toBe(
      'Status unavailable'
    )
    expect(
      getHostDetailsSummary(
        details({
          compatibility: {
            kind: 'ok',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: RUNTIME_PROTOCOL_VERSION
          }
        })
      )
    ).toBe('Compatible')
    expect(
      getHostDetailsSummary(
        details({
          compatibility: {
            kind: 'blocked',
            reason: 'server-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
            requiredServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
          }
        })
      )
    ).toBe('Update server')
    expect(
      getHostDetailsSummary(
        details({
          compatibility: {
            kind: 'blocked',
            reason: 'client-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            requiredClientProtocolVersion: RUNTIME_PROTOCOL_VERSION + 1
          }
        })
      )
    ).toBe('Update client')
  })

  it('evaluates runtime protocol compatibility from status aliases', () => {
    expect(
      evaluateHostDetails({
        runtimeId: 'runtime-old',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        protocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
        minCompatibleMobileVersion: 0
      })
    ).toMatchObject({ kind: 'blocked', reason: 'server-too-old' })
  })

  it('explains blocked runtime compatibility with required protocol versions', () => {
    expect(
      getHostDetailsDescription(
        details({
          compatibility: {
            kind: 'blocked',
            reason: 'server-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
            requiredServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
          }
        })
      )
    ).toContain('client requires server protocol')
  })

  it('summarizes runtime capabilities by name with overflow count', () => {
    expect(
      getRuntimeCapabilitiesSummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        capabilities: ['runtime.environments.v1', 'terminal.multiplex.v1']
      })
    ).toBe('runtime.environments.v1, terminal.multiplex.v1')

    expect(
      getRuntimeCapabilitiesSummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        capabilities: [
          'runtime.environments.v1',
          'browser.screencast.v1',
          'terminal.multiplex.v1',
          'project-host-setup.v1'
        ]
      })
    ).toBe('runtime.environments.v1, browser.screencast.v1, terminal.multiplex.v1 +1')
  })

  it('summarizes Host model capability support for version-skewed servers', () => {
    expect(
      getHostModelCapabilitySummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0
      })
    ).toBe('Host model support: checking server capabilities')

    expect(
      getHostModelCapabilitySummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        capabilities: [
          PROJECT_HOST_SETUP_RUNTIME_CAPABILITY,
          TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY,
          WORKSPACE_RUN_CONTEXT_RUNTIME_CAPABILITY
        ]
      })
    ).toBe('Host model support: ready')

    expect(
      getHostModelCapabilitySummary({
        runtimeId: 'runtime',
        rendererGraphEpoch: 1,
        graphStatus: 'ready',
        authoritativeWindowId: 1,
        liveTabCount: 0,
        liveLeafCount: 0,
        capabilities: [PROJECT_HOST_SETUP_RUNTIME_CAPABILITY]
      })
    ).toBe('Host model support: update server for task source context, workspace run context')
  })

  it('reports an attached, ready, compatible host as Connected regardless of active-ness', () => {
    // Why: the row tracks attachment (reachable + ready), which exposes Disconnect.
    // Whether the host is the default *active* server is a separate concept, so it
    // must NOT change this label — otherwise the dot/label/button disagree (a host
    // showed "Available" with a grey dot yet offered Disconnect).
    expect(getRuntimeServerConnectionState(details({ status: 'ready' }))).toBe('connected')
    expect(getRuntimeServerConnectionState(undefined)).toBe('checking')
    expect(getRuntimeServerConnectionState(details({ status: 'loading' }))).toBe('checking')
    expect(getRuntimeServerConnectionState(details({ status: 'error', error: 'offline' }))).toBe(
      'disconnected'
    )
    expect(
      getRuntimeServerConnectionState(
        details({
          status: 'ready',
          compatibility: {
            kind: 'blocked',
            reason: 'server-too-old',
            clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            serverProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION - 1,
            requiredServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
          }
        })
      )
    ).toBe('disconnected')
  })

  it('explains that selecting a saved server is the explicit default Host mode', () => {
    expect(getActiveServerModeDescription(true)).toContain('Use this computer by default')
    expect(getActiveServerModeDescription(true)).toContain('browser/mobile handoff')
    expect(getActiveServerModeDescription(false)).toContain('default Host')
    expect(getActiveServerModeDescription(false)).toContain(
      applyProductBranding('paired Orca runtime')
    )
  })

  it('blocks removing the active server independently of local-runtime availability', () => {
    expect(isRuntimeEnvironmentRemovalBlocked('windows-2', 'windows-2')).toBe(true)
    expect(isRuntimeEnvironmentRemovalBlocked(undefined, 'windows-2')).toBe(false)
    expect(isRuntimeEnvironmentRemovalBlocked('local', 'windows-2')).toBe(false)
  })

  it('offers local removal only when a local pairing exists', () => {
    const accountOnly = environmentWithAccessSources(['account-claimed'])

    expect(supportsLocalRuntimeEnvironmentRemoval(accountOnly)).toBe(false)
    expect(getRuntimeEnvironmentRemovalPresentation(accountOnly, false)).toBeNull()
    expect(supportsLocalRuntimeEnvironmentRemoval(environmentWithAccessSources([]))).toBe(false)
    expect(
      supportsLocalRuntimeEnvironmentRemoval(
        environmentWithAccessSources(['local-pairing', 'account-claimed'])
      )
    ).toBe(true)
    expect(
      supportsLocalRuntimeEnvironmentRemoval(environmentWithAccessSources(['local-pairing']))
    ).toBe(true)
    expect(supportsLocalRuntimeEnvironmentRemoval(environmentWithAccessSources(undefined))).toBe(
      true
    )
  })

  it('states that removing a composite Runtime keeps its account access', () => {
    const environment = environmentWithAccessSources(['local-pairing', 'account-claimed'])

    expect(getRuntimeEnvironmentRemovalPresentation(environment, false)).toEqual({
      title: 'Remove Local Pairing',
      description: applyProductBranding(
        'This removes only the local pairing from Orca. The server remains available through your account.'
      ),
      actionLabel: 'Remove Local Pairing',
      actionAriaLabel: 'Remove local pairing for Build host',
      successMessage: 'Removed local pairing for Build host. Account access remains available.'
    })
    expect(getRuntimeEnvironmentRemovalPresentation(environment, true)?.description).toBe(
      'Choose another Active Server in Advanced before removing this local pairing. The server remains available through your account.'
    )
  })

  it('preserves the existing local-only removal contract', () => {
    const environment = environmentWithAccessSources(['local-pairing'])

    expect(getRuntimeEnvironmentRemovalPresentation(environment, false)).toEqual({
      title: 'Remove Server',
      description: applyProductBranding(
        'This removes the saved server from Orca. It does not change the active server.'
      ),
      actionLabel: 'Remove',
      actionAriaLabel: 'Remove Build host',
      successMessage: 'Removed Build host.'
    })
    expect(getRuntimeEnvironmentRemovalPresentation(environment, true)?.description).toBe(
      'Choose another Active Server in Advanced before removing this server. Existing host sessions are left alone.'
    )
  })

  it('keeps account directory reachability separate from an established connection', () => {
    const accountOnly = {
      ...environmentWithAccessSources(['account-claimed']),
      accountClaim: {
        runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        resourceVersion: 1,
        presence: 'ONLINE' as const,
        readiness: 'READY' as const,
        readinessReasonCode: null,
        lastHeartbeatAt: 1,
        freeDiskBytes: 1,
        clientAuthMode: 'IDENTITY_PROOF' as const,
        credentialState: 'ACTIVE' as const,
        connectionCapabilities: ['hive-relay'],
        cloudConnectable: true
      }
    }

    expect(getRuntimeEnvironmentInitialDetails(accountOnly)).toEqual({
      status: 'error',
      runtimeStatus: null,
      compatibility: null,
      error: null
    })
    expect(canConnectRuntimeEnvironment(accountOnly)).toBe(true)
    expect(getRuntimeEnvironmentEndpointDisplay(accountOnly)).toBe('Managed by HiveCloud')
    expect(getRuntimeServerConnectionState(undefined, accountOnly)).toBe('available')
    expect(
      getRuntimeServerConnectionState(undefined, {
        ...accountOnly,
        accountClaim: {
          ...accountOnly.accountClaim,
          connectionCapabilities: ['orca-direct'],
          cloudConnectable: false
        }
      })
    ).toBe('online-unavailable')
    expect(
      getRuntimeEnvironmentInitialDetails({
        ...accountOnly,
        accountClaim: { ...accountOnly.accountClaim, presence: 'OFFLINE', cloudConnectable: false }
      })
    ).toEqual({
      status: 'error',
      runtimeStatus: null,
      compatibility: null,
      error: null
    })
    expect(
      canConnectRuntimeEnvironment({
        ...accountOnly,
        accountClaim: { ...accountOnly.accountClaim, presence: 'OFFLINE', cloudConnectable: false }
      })
    ).toBe(false)
    expect(
      getRuntimeServerConnectionState(undefined, {
        ...accountOnly,
        accountClaim: { ...accountOnly.accountClaim, presence: 'OFFLINE', cloudConnectable: false }
      })
    ).toBe('offline')
    expect(
      getRuntimeEnvironmentInitialDetails(environmentWithAccessSources(['local-pairing']))
    ).toMatchObject({ status: 'loading' })
    expect(canConnectRuntimeEnvironment(environmentWithAccessSources(['local-pairing']))).toBe(true)
    expect(
      getRuntimeEnvironmentEndpointDisplay(environmentWithAccessSources(['local-pairing']))
    ).toBe('wss://runtime.example.test')
  })
})

function accountClaim(cloudDisplayNameVersion: number) {
  return {
    runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
    resourceVersion: 1,
    presence: 'ONLINE' as const,
    readiness: 'READY' as const,
    readinessReasonCode: null,
    lastHeartbeatAt: 1,
    freeDiskBytes: null,
    clientAuthMode: 'IDENTITY_PROOF' as const,
    credentialState: 'ACTIVE' as const,
    connectionCapabilities: ['hive-relay'],
    cloudConnectable: true,
    cloudDisplayName: 'Cloud desk',
    cloudDisplayNameVersion
  }
}
