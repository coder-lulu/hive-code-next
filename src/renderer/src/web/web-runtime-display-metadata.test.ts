// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'

const mocks = vi.hoisted(() => ({ publish: vi.fn(), constructed: vi.fn(), close: vi.fn() }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ setRuntimeEnvironments: mocks.publish }) }
}))
vi.mock('./web-runtime-client', () => ({
  WebRuntimeClient: class {
    constructor() {
      mocks.constructed()
    }
    close = mocks.close
    configureStatusOwner = vi.fn()
  }
}))

import {
  configureWebRuntimeBootstrap,
  captureWebRuntimeDisplayOwner,
  mergeWebRuntimeDisplayMetadata,
  updateEnvironmentFromResponse,
  getClientForEnvironment,
  webRuntimeState
} from './preload-api/web-runtime-session'

const metadata = {
  runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
  resourceVersion: 9,
  ownershipEpoch: 8,
  cloudDisplayName: '原名',
  cloudDisplayNameVersion: 2,
  deviceName: '设备'
}
const bootstrap: CloudLaunchBootstrap = {
  protocolVersion: 'cloud-launch/v1',
  managedWebSessionId: '123e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '223e4567-e89b-42d3-a456-426614174000',
  websocketUrl: 'wss://runtime.example/_hive/runtime-rpc',
  serverPublicKeyB64: 'public-key',
  sessionToken: 'A'.repeat(43),
  expiresAt: '2026-10-03T12:00:00Z',
  runtimeDisplayMetadata: metadata
}
const status = {
  id: 'status',
  ok: true as const,
  result: {},
  _meta: { runtimeId: 'runtime-identity' }
}

afterEach(() => {
  configureWebRuntimeBootstrap()
  vi.clearAllMocks()
})

describe('one Web Runtime name projection', () => {
  it('retains the first identity publication when equivalent replies arrive before the store import completes', async () => {
    configureWebRuntimeBootstrap(bootstrap)
    const initial = webRuntimeState.activeEnvironment!
    updateEnvironmentFromResponse(initial, status)
    updateEnvironmentFromResponse(initial, { ...status, id: 'files.read' })
    await vi.waitFor(() =>
      expect(mocks.publish).toHaveBeenLastCalledWith([
        expect.objectContaining({ runtimeId: 'runtime-identity', name: '原名' })
      ])
    )
    expect(mocks.publish).toHaveBeenCalledTimes(1)
  })

  it('publishes a changed Runtime identity once and does not republish the catalog for ordinary RPC replies', async () => {
    configureWebRuntimeBootstrap(bootstrap)
    const initial = webRuntimeState.activeEnvironment!
    const owner = captureWebRuntimeDisplayOwner()!
    await mergeWebRuntimeDisplayMetadata(owner, metadata)
    mocks.publish.mockClear()
    updateEnvironmentFromResponse(initial, status)
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1))
    mocks.publish.mockClear()
    for (let index = 0; index < 100; index++) {
      updateEnvironmentFromResponse(webRuntimeState.activeEnvironment!, {
        ...status,
        id: `files.read-${index}`
      })
      await Promise.resolve()
    }
    await Promise.resolve()
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(webRuntimeState.activeEnvironment).toMatchObject({
      runtimeId: 'runtime-identity',
      name: '原名'
    })
    await mergeWebRuntimeDisplayMetadata(owner, {
      ...metadata,
      cloudDisplayName: '新名',
      cloudDisplayNameVersion: 3
    })
    expect(mocks.publish).toHaveBeenLastCalledWith([expect.objectContaining({ name: '新名' })])
  })

  it('renames and clears without replacing the client/endpoint/owner, then merges a late status into the current name', async () => {
    configureWebRuntimeBootstrap(bootstrap)
    const initial = webRuntimeState.activeEnvironment!
    const client = getClientForEnvironment(initial)
    const owner = captureWebRuntimeDisplayOwner()!
    expect(initial.name).toBe('原名')
    expect(
      await mergeWebRuntimeDisplayMetadata(owner, {
        ...metadata,
        cloudDisplayName: '<备用> 🐝',
        cloudDisplayNameVersion: 3
      })
    ).toBe(true)
    updateEnvironmentFromResponse(initial, status)
    expect(webRuntimeState.activeEnvironment).toMatchObject({
      name: '<备用> 🐝',
      id: initial.id,
      createdAt: initial.createdAt,
      preferredEndpointId: initial.preferredEndpointId,
      endpoints: initial.endpoints
    })
    expect(getClientForEnvironment(webRuntimeState.activeEnvironment!)).toBe(client)
    expect(mocks.constructed).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()
    expect(
      await mergeWebRuntimeDisplayMetadata(owner, {
        ...metadata,
        cloudDisplayName: null,
        cloudDisplayNameVersion: 4
      })
    ).toBe(true)
    expect(webRuntimeState.activeEnvironment?.name).toBe('设备')
    expect(mocks.publish).toHaveBeenLastCalledWith([expect.objectContaining({ name: '设备' })])
  })

  it('merges alias version independently from resourceVersion and rejects equal-version contradictions', async () => {
    configureWebRuntimeBootstrap(bootstrap)
    const owner = captureWebRuntimeDisplayOwner()!
    await mergeWebRuntimeDisplayMetadata(owner, {
      ...metadata,
      resourceVersion: 7,
      cloudDisplayName: '新名',
      cloudDisplayNameVersion: 3
    })
    await mergeWebRuntimeDisplayMetadata(owner, { ...metadata, resourceVersion: 10 })
    expect(webRuntimeState.activeEnvironment?.name).toBe('新名')
    await expect(
      mergeWebRuntimeDisplayMetadata(owner, {
        ...metadata,
        cloudDisplayName: '矛盾',
        cloudDisplayNameVersion: 3
      })
    ).rejects.toThrow()
  })

  it('does not project a different ownership epoch and ignores old responses after bootstrap replacement', async () => {
    configureWebRuntimeBootstrap(bootstrap)
    const initial = webRuntimeState.activeEnvironment!
    const owner = captureWebRuntimeDisplayOwner()!
    await expect(
      mergeWebRuntimeDisplayMetadata(owner, { ...metadata, ownershipEpoch: 9 })
    ).rejects.toMatchObject({ code: 'runtime_display_metadata_binding_invalid' })
    configureWebRuntimeBootstrap({
      ...bootstrap,
      runtimeDisplayMetadata: { ...metadata, ownershipEpoch: 9, cloudDisplayName: '重新认领' }
    })
    expect(
      await mergeWebRuntimeDisplayMetadata(owner, {
        ...metadata,
        cloudDisplayName: '旧回执',
        cloudDisplayNameVersion: 9
      })
    ).toBe(false)
    updateEnvironmentFromResponse(initial, status)
    expect(webRuntimeState.activeEnvironment?.name).toBe('重新认领')
    expect(webRuntimeState.activeEnvironment?.runtimeId).toBeNull()
  })
})
