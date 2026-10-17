import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRuntimeEnvironmentStatusOwners } from './runtime-environment-request-connections'
import { encodePairingOffer } from '../../shared/pairing'
import { addEnvironmentFromPairingCode } from '../../shared/runtime-environment-store'
import { addWslHostEnvironment } from '../../shared/runtime-environment-wsl-host-store'
import { WSL_HOSTS_INTERNAL_GATE_ENV } from '../../shared/wsl-host-internal-gate'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getPath: vi.fn(),
  spawnProcess: vi.fn(),
  runProcess: vi.fn(),
  createConnector: vi.fn(),
  createFakeConnector: vi.fn(),
  sharedControlRequest: vi.fn(),
  ensureSharedControl: vi.fn(),
  connectionRequest: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: mocks.getPath },
  ipcMain: {
    handle: mocks.handle,
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn()
  }
}))

vi.mock('@orca/process-host', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  spawnProcess: mocks.spawnProcess,
  runProcess: mocks.runProcess
}))

vi.mock('../wsl/wsl-host-connector', () => ({ createWslHostConnector: mocks.createConnector }))

vi.mock('../wsl/wsl-host-e2e-fake-connector', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createFakeWslHostConnector: mocks.createFakeConnector
}))

vi.mock('../../shared/remote-runtime-client', () => ({
  sendRemoteRuntimeRequest: vi.fn(async () => ({ id: 'status', ok: false, error: {} })),
  subscribeRemoteRuntimeRequest: vi.fn()
}))

vi.mock('./runtime-environment-request-connections', async () => {
  const { withRuntimeStatusOwners } = await import('./runtime-environments-ipc-test-harness')
  return withRuntimeStatusOwners({
    sendRemoteRuntimeConnectionRequest: mocks.connectionRequest,
    sendRemoteRuntimeSharedControlRequest: mocks.sharedControlRequest,
    subscribeRemoteRuntimeSharedControlRequest: vi.fn(),
    getRemoteRuntimeSharedControlDiagnostics: vi.fn(() => null),
    reconnectRemoteRuntimeSharedControlConnection: vi.fn(),
    retryRemoteRuntimeSharedControlConnectionsNow: vi.fn(),
    retryRemoteRuntimeSharedControlConnectionNow: vi.fn(),
    ensureRemoteRuntimeSharedControlConnection: mocks.ensureSharedControl,
    pauseRemoteRuntimeSharedControlRetry: vi.fn(),
    closeRemoteRuntimeRequestConnection: vi.fn()
  })
})

import { registerRuntimeEnvironmentHandlers } from './runtime-environments'
import { pairingCode } from './runtime-environments-ipc-test-harness'
import { registerWslHostHandlers, WSL_HOST_HANDLER_CHANNELS } from './wsl-host-handlers'
import { getWslHostService, setWslHostService } from '../wsl/wsl-host-service-instance'

const WSL_ID = 'wsl:ubuntu'

function persistWslHost(userDataPath: string): void {
  addWslHostEnvironment(userDataPath, {
    id: WSL_ID,
    name: 'Ubuntu (WSL)',
    pairingCode: encodePairingOffer({
      v: 2,
      endpoint: 'ws://127.0.0.1:42000',
      deviceToken: 'token-1',
      publicKeyB64: Buffer.alloc(32, 7).toString('base64')
    }),
    record: {
      kind: 'wsl',
      distro: 'Ubuntu',
      distroId: '0e3a7f2c-1b4d-4c5e-9f60-7a8b9c0d1e2f',
      localPort: 42000,
      remotePort: 6768
    }
  })
}

function registeredWslHostChannels(): unknown[] {
  return mocks.handle.mock.calls
    .map((call) => call[0])
    .filter((channel) => String(channel).startsWith('wslHosts:'))
}

describe('WSL hosts are available by default', () => {
  let userDataPath: string
  const store = {
    getSettings: () => ({ activeRuntimeEnvironmentId: null, experimentalWslHosts: true }),
    onSettingsChanged: vi.fn(),
    getWorkspaceSessionHostIds: () => [],
    updateSettings: vi.fn(),
    removeWorkspaceSessionHost: vi.fn(),
    setRemoteLayoutSnapshot: vi.fn()
  }

  beforeEach(() => {
    vi.stubEnv(WSL_HOSTS_INTERNAL_GATE_ENV, '')
    vi.stubEnv('ORCA_E2E_FAKE_WSL_HOSTS', '')
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-wsl-gate-'))
    mocks.getPath.mockReturnValue(userDataPath)
    mocks.handle.mockReset()
    setWslHostService(null)
    persistWslHost(userDataPath)
    addEnvironmentFromPairingCode(userDataPath, { name: 'desk', pairingCode: pairingCode() })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetRuntimeEnvironmentStatusOwners()
    setWslHostService(null)
    rmSync(userDataPath, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  function startApp(): void {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these handlers read only the settings and session-host methods stubbed above.
    registerRuntimeEnvironmentHandlers(store as never)
    registerWslHostHandlers({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
      store: store as never,
      getUserDataPath: () => userDataPath,
      invalidateTransport: vi.fn()
    })
  }

  it.each([undefined, '', '0', '1'])(
    'creates and reuses the WSL host service with legacy gate value %s',
    (gateValue) => {
      vi.stubEnv(WSL_HOSTS_INTERNAL_GATE_ENV, gateValue)
      vi.stubEnv(
        'ORCA_E2E_FAKE_WSL_HOSTS',
        JSON.stringify({ distros: [], pairingCode: pairingCode() })
      )
      mocks.createFakeConnector.mockReturnValue({
        adoptHolders: vi.fn(async () => {}),
        dispose: vi.fn(async () => {})
      })
      startApp()

      expect(getWslHostService()).not.toBeNull()
      expect(mocks.createFakeConnector).toHaveBeenCalledTimes(1)
      expect(registeredWslHostChannels().sort()).toEqual([...WSL_HOST_HANDLER_CHANNELS].sort())
      expect(store.onSettingsChanged).toHaveBeenCalledTimes(1)

      // Registering again (another window) reuses the service and its one settings listener.
      mocks.handle.mockClear()
      startApp()
      expect(mocks.createFakeConnector).toHaveBeenCalledTimes(1)
      expect(store.onSettingsChanged).toHaveBeenCalledTimes(1)
      expect(registeredWslHostChannels().sort()).toEqual([...WSL_HOST_HANDLER_CHANNELS].sort())
    }
  )

  it('registers nothing on a non-Windows host without the fake', () => {
    vi.stubEnv(WSL_HOSTS_INTERNAL_GATE_ENV, '1')
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      startApp()
    } finally {
      if (platform) {
        Object.defineProperty(process, 'platform', platform)
      }
    }

    expect(getWslHostService()).toBeNull()
    expect(registeredWslHostChannels()).toEqual([])
    expect(store.onSettingsChanged).not.toHaveBeenCalled()
  })
})
