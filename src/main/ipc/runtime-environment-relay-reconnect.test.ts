import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type { Store } from '../persistence'
import {
  clearRuntimeEnvironmentManualDisconnect,
  isRuntimeEnvironmentManuallyDisconnected
} from './runtime-environment-manual-disconnect'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  resolve: vi.fn(),
  status: vi.fn(),
  disconnect: vi.fn(),
  directRetry: vi.fn(),
  invalidate: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../hive-runtime-cloud/hive-account-runtime-access', () => ({
  getHiveAccountRuntimeAccess: () => ({ transport: { disconnect: mocks.disconnect } })
}))
vi.mock('./runtime-environment-account-routing', () => ({
  resolveRuntimeEnvironmentCatalogEntry: mocks.resolve,
  getCatalogEnvironmentStatus: mocks.status
}))
vi.mock('./runtime-environment-request-connections', () => ({
  retryRemoteRuntimeSharedControlConnectionNow: mocks.directRetry,
  closeRemoteRuntimeRequestConnection: vi.fn(),
  getRuntimeEnvironmentStatusOwner: vi.fn()
}))
vi.mock('./runtime-environment-removal-cleanup', () => ({}))
vi.mock('./runtime-environment-preference', () => ({}))
vi.mock('./runtime-environment-pairing-verification', () => ({}))
vi.mock('./runtime-environment-transport-routing', () => ({}))
vi.mock('../wsl/wsl-orcad-account-env', () => ({}))
vi.mock('../ssh/ssh-credential-decline', () => ({}))
vi.mock('../wsl/wsl-orcad-host-environments', () => ({}))
vi.mock('../wsl/wsl-host-service-instance', () => ({}))
vi.mock('../wsl/wsl-host-gate', () => ({}))

import { registerRuntimeEnvironmentConnectivityHandlers } from './runtime-environment-connectivity-handlers'

const userDataPath = 'relay-reconnect-test-profile'
const claim: NonNullable<PublicKnownRuntimeEnvironment['accountClaim']> = {
  runtimeRecordId: 'record-a',
  resourceVersion: 1,
  ownershipEpoch: 1,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: null,
  lastHeartbeatAt: 1,
  freeDiskBytes: null,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay'],
  cloudConnectable: true,
  cloudDisplayName: null,
  cloudDisplayNameVersion: 1
}

function environment(account: boolean, paired: boolean): PublicKnownRuntimeEnvironment {
  return {
    id: 'environment-a',
    name: 'Home PC',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: 'runtime-a',
    runtimeRecordId: 'record-a',
    preferredEndpointId: 'vpn',
    endpoints: paired
      ? [{ id: 'vpn', kind: 'websocket', label: 'Saved VPN', endpoint: 'ws://100.66.28.84:6768' }]
      : [],
    accessSources: paired
      ? ['local-pairing', ...(account ? ['account-claimed' as const] : [])]
      : ['account-claimed'],
    ...(account ? { accountClaim: claim } : {})
  }
}

function invoke(channel: string, selector: string): Promise<void> {
  const registered = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!registered) {
    throw new Error(`Missing handler: ${channel}`)
  }
  return registered[1]({}, { selector })
}

describe('runtime account Relay control reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.status.mockResolvedValue({ ok: true })
    registerRuntimeEnvironmentConnectivityHandlers({
      store: vi.fn<() => Store>()(),
      getUserDataPath: () => userDataPath,
      invalidateTransport: mocks.invalidate
    })
  })

  afterEach(() => clearRuntimeEnvironmentManualDisconnect('environment-a'))

  it.each([
    ['merged paired ID', true, 'environment-a'],
    ['cloud-only selector', false, 'account-runtime:record-a']
  ])(
    'reconnects Relay for %s without retrying direct transport',
    async (_name, paired, selector) => {
      const target = environment(true, paired)
      mocks.resolve.mockReturnValue(target)

      await invoke('runtimeEnvironments:retryControlConnection', selector)

      expect(mocks.resolve).toHaveBeenCalledWith(userDataPath, selector)
      expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith('record-a')
      expect(mocks.status).toHaveBeenCalledExactlyOnceWith(userDataPath, target, undefined, {
        reconnect: true
      })
      expect(mocks.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.status.mock.invocationCallOrder[0]
      )
      expect(mocks.directRetry).not.toHaveBeenCalled()
    }
  )

  it('keeps direct retry for a purely paired environment', async () => {
    mocks.resolve.mockReturnValue(environment(false, true))

    await invoke('runtimeEnvironments:retryControlConnection', 'Home PC')

    expect(mocks.directRetry).toHaveBeenCalledExactlyOnceWith('environment-a')
    expect(mocks.disconnect).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it.each([true, false])('does not undo manual disconnect (account=%s)', async (account) => {
    mocks.resolve.mockReturnValue(environment(account, true))
    await invoke('runtimeEnvironments:disconnect', 'Home PC')
    mocks.disconnect.mockClear()

    await invoke('runtimeEnvironments:retryControlConnection', 'Home PC')

    expect(isRuntimeEnvironmentManuallyDisconnected('environment-a')).toBe(true)
    expect(mocks.directRetry).not.toHaveBeenCalled()
    expect(mocks.disconnect).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })
})
