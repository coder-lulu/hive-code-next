import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { HiveRuntimeCloudControl } from '../../../hive-runtime-cloud/hive-runtime-cloud-control'
import type {
  HiveLocalRuntimeClaimPollResult,
  HiveLocalRuntimeClaimStartResult,
  HiveLocalRuntimeCloudStatus,
  HiveLocalRuntimeIdentityResetResult
} from '../../../../shared/hive-runtime-cloud'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { HIVE_RUNTIME_CLOUD_METHODS } from './hive-runtime-cloud'

const runtime = {
  getRuntimeId: () => 'runtime-test'
} as OrcaRuntimeService

function request(method: string, params?: unknown): RpcRequest {
  return { id: `request-${method}`, authToken: 'local', method, params }
}

function fixture() {
  const control: HiveRuntimeCloudControl = {
    getLocalRuntimeStatus: vi.fn(
      (): HiveLocalRuntimeCloudStatus => ({
        ownership: 'CLAIMED',
        presence: 'ONLINE',
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        relay: 'registered'
      })
    ),
    beginHeadlessClaim: vi.fn(
      async (): Promise<HiveLocalRuntimeClaimStartResult> => ({
        status: 'PENDING',
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
        challengeId: '823e4567-e89b-42d3-a456-426614174000',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://code.hivekernel.com/runtime/claim',
        expiresAt: 2_000,
        pollIntervalSeconds: 5
      })
    ),
    pollHeadlessClaim: vi.fn(
      async (): Promise<HiveLocalRuntimeClaimPollResult> => ({
        status: 'PENDING',
        challengeId: '823e4567-e89b-42d3-a456-426614174000',
        nextPollAt: 1_500
      })
    ),
    resetCloudIdentity: vi.fn((): HiveLocalRuntimeIdentityResetResult => ({ reset: true }))
  }
  return {
    control,
    dispatcher: new RpcDispatcher({
      runtime,
      methods: HIVE_RUNTIME_CLOUD_METHODS,
      hiveRuntimeCloud: control
    })
  }
}

describe('Hive Runtime Cloud local RPC', () => {
  it('exposes stable status, challenge, poll, and reset DTOs to local callers', async () => {
    const { dispatcher, control } = fixture()

    await expect(dispatcher.dispatch(request('cloudRuntime.status'))).resolves.toMatchObject({
      ok: true,
      result: {
        ownership: 'CLAIMED',
        runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000'
      }
    })
    await expect(dispatcher.dispatch(request('cloudRuntime.claim'))).resolves.toMatchObject({
      ok: true,
      result: { status: 'PENDING', userCode: 'ABCD-EFGH' }
    })
    await expect(
      dispatcher.dispatch(
        request('cloudRuntime.claimPoll', {
          challengeId: '823e4567-e89b-42d3-a456-426614174000'
        })
      )
    ).resolves.toMatchObject({ ok: true, result: { status: 'PENDING' } })
    await expect(
      dispatcher.dispatch(request('cloudRuntime.resetIdentity', { confirm: true }))
    ).resolves.toMatchObject({ ok: true, result: { reset: true } })

    expect(control.beginHeadlessClaim).toHaveBeenCalledOnce()
    expect(control.pollHeadlessClaim).toHaveBeenCalledWith('823e4567-e89b-42d3-a456-426614174000')
    expect(control.resetCloudIdentity).toHaveBeenCalledOnce()
  })

  it('rejects paired WebSocket contexts even when directly dispatched', async () => {
    const { dispatcher, control } = fixture()

    await expect(
      dispatcher.dispatch(request('cloudRuntime.claim'), { clientKind: 'runtime' })
    ).resolves.toMatchObject({
      ok: false,
      error: { message: 'hive_runtime_cloud_local_only' }
    })
    expect(control.beginHeadlessClaim).not.toHaveBeenCalled()
  })

  it('requires an explicit reset confirmation', async () => {
    const { dispatcher, control } = fixture()

    await expect(
      dispatcher.dispatch(request('cloudRuntime.resetIdentity', { confirm: false }))
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(control.resetCloudIdentity).not.toHaveBeenCalled()
  })
})
