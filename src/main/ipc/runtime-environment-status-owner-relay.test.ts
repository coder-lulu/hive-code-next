import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import { REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY } from '../../shared/protocol-version'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'

const mocks = vi.hoisted(() => ({
  direct: vi.fn(),
  relay: vi.fn(),
  state: vi.fn(),
  verdict: vi.fn(),
  usage: vi.fn(),
  incarnation: vi.fn(),
  disconnected: vi.fn(),
  managed: vi.fn()
}))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../shared/remote-runtime-client', () => ({ sendRemoteRuntimeRequest: mocks.direct }))
vi.mock('../hive-runtime-cloud/hive-account-runtime-access', () => ({
  getHiveAccountRuntimeAccess: () => ({
    directory: { getState: mocks.state },
    transport: { call: mocks.relay }
  })
}))
vi.mock('./runtime-environment-capability-evidence', () => ({
  captureRuntimeEnvironmentCapabilityEvidence: vi.fn(() => ({})),
  applyRuntimeEnvironmentCapabilityVerdict: mocks.verdict,
  getAcceptedRuntimeEnvironmentCapabilityOutcome: vi.fn(() => null),
  getRuntimeEnvironmentCapabilityIncarnation: mocks.incarnation
}))
vi.mock('./runtime-environment-usage-record', () => ({
  recordRuntimeEnvironmentUsage: mocks.usage
}))
vi.mock('./runtime-environment-manual-disconnect', () => ({
  isRuntimeEnvironmentManuallyDisconnected: mocks.disconnected
}))
vi.mock('./runtime-environment-managed-tunnel', () => ({
  resolveManagedRuntimeEnvironment: mocks.managed
}))
import { createRuntimeEnvironmentStatusOwner } from './runtime-environment-status-owner'

const runtime: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'CLAIMED',
  runtimeVersion: '1',
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
  lastHeartbeatAt: 1,
  observedAt: 1,
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
}
const success = {
  id: 'status.get',
  ok: true as const,
  result: {
    capabilities: [REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY],
    runtimeRecordId: runtime.runtimeRecordId
  },
  _meta: { runtimeId: 'runtime' }
}
const env: KnownRuntimeEnvironment = {
  id: 'paired',
  name: 'Home PC',
  runtimeId: 'runtime',
  runtimeRecordId: runtime.runtimeRecordId,
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  preferredEndpointId: 'vpn',
  endpoints: [
    {
      id: 'vpn',
      kind: 'websocket',
      label: 'VPN',
      endpoint: 'ws://100.66.28.84:6768',
      publicKeyB64: 'key',
      deviceToken: 'token'
    }
  ]
}
const transport = {
  isReady: vi.fn(() => false),
  request: vi.fn(),
  establish: vi.fn(),
  pause: vi.fn()
}
const owners: ReturnType<typeof createRuntimeEnvironmentStatusOwner>[] = []
function owner(environment = env) {
  const result = createRuntimeEnvironmentStatusOwner('userdata', environment, transport)
  owners.push(result)
  return result
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.state.mockReturnValue({ items: [runtime] })
  mocks.relay.mockResolvedValue(success)
  mocks.direct.mockResolvedValue(success)
  mocks.verdict.mockReturnValue(true)
  mocks.incarnation.mockReturnValue(1)
  mocks.disconnected.mockReturnValue(false)
})
afterEach(() => {
  for (const item of owners.splice(0)) {
    item.dispose()
  }
})

describe('background status owner account Relay routing', () => {
  it('verifies the matching cloud host without direct probes or direct capability evidence', async () => {
    expect(await owner().refresh()).toBe(success)
    expect(mocks.relay).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeRecordId: runtime.runtimeRecordId }),
      'status.get',
      {},
      15_000,
      undefined,
      expect.any(AbortSignal)
    )
    expect(mocks.direct).not.toHaveBeenCalled()
    expect(transport.request).not.toHaveBeenCalled()
    expect(transport.establish).not.toHaveBeenCalled()
    expect(mocks.verdict).not.toHaveBeenCalled()
    expect(transport.pause).toHaveBeenCalled()
  })

  it.each(['ssh', 'wsl'] as const)('retains the explicit %s bridge', async (kind) => {
    const environment: KnownRuntimeEnvironment =
      kind === 'ssh'
        ? { ...env, connectionDependency: 'ssh-tunnel' }
        : {
            ...env,
            orcadDeployment: { kind: 'wsl', distro: 'Ubuntu', localPort: 6768, remotePort: 6768 }
          }
    expect(await owner(environment).refresh()).toBe(success)
    expect(mocks.direct).toHaveBeenCalledOnce()
    expect(mocks.relay).not.toHaveBeenCalled()
    expect(transport.establish).toHaveBeenCalledOnce()
    if (kind === 'ssh') {
      expect(mocks.managed).toHaveBeenCalledOnce()
    }
  })

  it('re-evaluates the account directory on every probe', async () => {
    mocks.state.mockReturnValue({ items: [] })
    const item = owner()
    await item.refresh()
    expect(mocks.direct).toHaveBeenCalledOnce()
    item.connectionChanged('disconnected')
    mocks.state.mockReturnValue({ items: [runtime] })
    await item.refresh()
    expect(mocks.relay).toHaveBeenCalledOnce()
    expect(mocks.direct).toHaveBeenCalledOnce()
    expect(transport.establish).toHaveBeenCalledOnce()
    expect(item.read()).toMatchObject({
      verification: 'verified',
      transport: 'unknown',
      remoteControl: null
    })
  })

  it.each(['runtime_timeout', 'unauthorized'])('does not fallback after Relay %s', async (code) => {
    mocks.relay.mockRejectedValue(new RemoteRuntimeClientError(code, 'Relay failed'))
    expect(await owner().refresh()).toMatchObject({ ok: false })
    expect(mocks.direct).not.toHaveBeenCalled()
    expect(transport.establish).not.toHaveBeenCalled()
  })

  it('does not use an unrelated account record', async () => {
    mocks.state.mockReturnValue({ items: [{ ...runtime, runtimeRecordId: 'other' }] })
    await owner().refresh()
    expect(mocks.direct).toHaveBeenCalledOnce()
    expect(mocks.relay).not.toHaveBeenCalled()
  })

  it('rejects a Relay answer after the pairing incarnation changes', async () => {
    mocks.relay.mockImplementation(async () => {
      mocks.incarnation.mockReturnValue(2)
      return success
    })
    expect(await owner().refresh()).toMatchObject({ ok: false })
    expect(mocks.verdict).not.toHaveBeenCalled()
    expect(transport.establish).not.toHaveBeenCalled()
  })
})
