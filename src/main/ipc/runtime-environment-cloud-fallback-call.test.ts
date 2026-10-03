import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { callEnvironmentWithCloudFallback } from './runtime-environment-account-routing'

const mocks = vi.hoisted(() => ({ localCall: vi.fn(), cloudCall: vi.fn(), resolve: vi.fn() }))
vi.mock('../../shared/runtime-environment-store', () => ({ listEnvironments: () => [] }))
vi.mock('../hive-runtime-cloud/hive-runtime-catalog', () => ({
  resolveHiveRuntimeCatalogEntry: mocks.resolve
}))
vi.mock('../hive-runtime-cloud/hive-account-runtime-access', () => ({
  getHiveAccountRuntimeAccess: () => ({
    getLocalRuntimeRecordId: () => null,
    directory: { getState: () => ({ items: [] }) },
    transport: { call: mocks.cloudCall }
  })
}))
vi.mock('./runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: mocks.localCall
}))

function environment(local = true): PublicKnownRuntimeEnvironment {
  return {
    id: 'paired-runtime',
    name: 'Host',
    createdAt: 1,
    updatedAt: 2,
    lastUsedAt: null,
    pairingRevision: 3,
    runtimeId: 'runtime-1',
    runtimeRecordId: 'record-1',
    endpoints: [],
    preferredEndpointId: 'endpoint-1',
    accessSources: local ? ['local-pairing', 'account-claimed'] : ['account-claimed'],
    accountClaim: {
      runtimeRecordId: 'record-1',
      resourceVersion: 7,
      presence: 'ONLINE',
      readiness: 'READY',
      readinessReasonCode: null,
      lastHeartbeatAt: 1,
      freeDiskBytes: 1,
      clientAuthMode: 'IDENTITY_PROOF',
      credentialState: 'ACTIVE',
      connectionCapabilities: ['hive-relay'],
      cloudConnectable: true
    }
  }
}

function connectionFailure() {
  return new RemoteRuntimeClientError('remote_runtime_unavailable', 'Could not connect', {
    pairingStage: 'connect'
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.localCall.mockRejectedValue(connectionFailure())
  mocks.cloudCall.mockResolvedValue({
    id: 'files.upload',
    ok: true,
    result: 'uploaded',
    _meta: { runtimeId: 'runtime-1' }
  })
  mocks.resolve.mockReturnValue(environment())
})

describe('cloud fallback call authority', () => {
  it.each([true, false])('does not send an already aborted call (local=%s)', async (local) => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      callEnvironmentWithCloudFallback(
        'unused',
        environment(local),
        'files.upload',
        {},
        undefined,
        undefined,
        undefined,
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.localCall).not.toHaveBeenCalled()
    expect(mocks.cloudCall).not.toHaveBeenCalled()
  })

  it.each(['pairing', 'runtime'] as const)(
    'rejects %s changes while local connection is pending',
    async (changed) => {
      const frozen = environment()
      const current = { ...frozen }
      mocks.resolve.mockImplementation(() => current)
      mocks.localCall.mockImplementation(async () => {
        if (changed === 'pairing') {
          current.pairingRevision = 4
        } else {
          current.runtimeId = 'replacement-runtime'
        }
        throw connectionFailure()
      })
      await expect(
        callEnvironmentWithCloudFallback('unused', frozen, 'files.upload', {}, 1234, 3, undefined, {
          expectedEnvironmentRuntimeId: 'runtime-1'
        })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'runtime_environment_changed' }
      })
      expect(mocks.resolve).toHaveBeenCalledOnce()
      expect(mocks.cloudCall).not.toHaveBeenCalled()
    }
  )

  it('revalidates a cloud-only pairing against the current catalog', async () => {
    const frozen = environment(false)
    mocks.resolve.mockReturnValue({ ...frozen, pairingRevision: 4 })
    await expect(
      callEnvironmentWithCloudFallback('unused', frozen, 'files.upload', {}, undefined, 3)
    ).resolves.toMatchObject({ ok: false, error: { code: 'runtime_environment_changed' } })
    expect(mocks.localCall).not.toHaveBeenCalled()
    expect(mocks.cloudCall).not.toHaveBeenCalled()
  })

  it('does not fall back when cancellation occurs during local connection', async () => {
    const controller = new AbortController()
    mocks.localCall.mockImplementation(async () => {
      controller.abort()
      throw connectionFailure()
    })
    await expect(
      callEnvironmentWithCloudFallback(
        'unused',
        environment(),
        'files.upload',
        {},
        undefined,
        undefined,
        undefined,
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.cloudCall).not.toHaveBeenCalled()
  })

  it('preserves calls without expected identity parameters and forwards cancellation', async () => {
    const frozen = environment()
    const controller = new AbortController()
    const params = { path: '/work/file' }
    mocks.resolve.mockImplementation(() => {
      throw new Error('Catalog not available')
    })
    await expect(
      callEnvironmentWithCloudFallback(
        'unused',
        frozen,
        'files.upload',
        params,
        1234,
        undefined,
        undefined,
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({ ok: true })
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.localCall).toHaveBeenCalledWith(
      'unused',
      frozen.id,
      'files.upload',
      params,
      1234,
      undefined,
      undefined,
      { signal: controller.signal }
    )
    expect(mocks.cloudCall).toHaveBeenCalledWith(
      frozen.accountClaim,
      'files.upload',
      params,
      1234,
      undefined,
      controller.signal
    )
  })

  it('delivers a still-current frozen call after a pre-delivery failure', async () => {
    const frozen = environment()
    await expect(
      callEnvironmentWithCloudFallback(
        'unused',
        frozen,
        'files.upload',
        {},
        undefined,
        3,
        undefined,
        { expectedEnvironmentRuntimeId: 'runtime-1' }
      )
    ).resolves.toMatchObject({ ok: true })
    expect(mocks.cloudCall).toHaveBeenCalledOnce()
  })

  it.each(['runtime', undefined] as const)(
    'does not retry delivery stage %s',
    async (pairingStage) => {
      const error = new RemoteRuntimeClientError(
        'remote_runtime_unavailable',
        'Delivery uncertain',
        { pairingStage }
      )
      mocks.localCall.mockRejectedValue(error)
      await expect(
        callEnvironmentWithCloudFallback('unused', environment(), 'files.upload', {})
      ).rejects.toBe(error)
      expect(mocks.cloudCall).not.toHaveBeenCalled()
    }
  )

  it('preserves a received local RPC failure without retrying it', async () => {
    const response = {
      id: 'files.upload',
      ok: false,
      error: { code: 'runtime_unavailable', message: 'received' }
    }
    mocks.localCall.mockResolvedValue(response)
    await expect(
      callEnvironmentWithCloudFallback('unused', environment(), 'files.upload', {})
    ).resolves.toBe(response)
    expect(mocks.cloudCall).not.toHaveBeenCalled()
  })
})
