import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import type {
  HiveAccountRuntimeDirectoryEntry,
  HiveAccountRuntimeDirectoryState
} from '../../shared/hive-runtime-cloud'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import { HiveAccountRuntimeDirectoryService } from './hive-account-runtime-directory-service'

const authorization = (
  accountId: string,
  accessToken: string,
  sessionGeneration = 1,
  sessionExpiresAt = 100_000,
  authorityId = 'hive-primary'
): HiveRuntimeCloudAuthorization => ({
  accessToken,
  accountId,
  authorityId,
  sessionExpiresAt,
  sessionGeneration
})

const entry = (runtimeRecordId: string): HiveAccountRuntimeDirectoryEntry => ({
  runtimeRecordId,
  status: 'CLAIMED',
  runtimeVersion: '1.5.0',
  runtimeProtocolVersion: 3,
  capabilities: ['pairing-v3'],
  resourceVersion: 1,
  createdAt: 1,
  updatedAt: 2,
  claimedAt: 1,
  presence: 'ONLINE',
  readiness: 'READY',
  readinessReasonCode: 'healthy',
  lastHeartbeatAt: 2,
  observedAt: 2,
  freeDiskBytes: 100,
  clientAuthMode: 'IDENTITY_PROOF',
  credentialState: 'ACTIVE',
  connectionCapabilities: ['hive-relay']
})

describe('HiveAccountRuntimeDirectoryService', () => {
  it('publishes the pending display-name projection from the committed state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-runtime-directory-'))
    const runtimeRecordId = '623e4567-e89b-42d3-a456-426614174000'
    const directoryEntry = {
      ...entry(runtimeRecordId),
      cloudDisplayName: 'Old name',
      cloudDisplayNameVersion: 2
    }
    const updateOwnedRuntimeDisplayName = vi.fn().mockReturnValue(new Promise(() => undefined))
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      {
        createClient: () => ({
          listOwnedRuntimes: vi
            .fn()
            .mockResolvedValue({ items: [directoryEntry], nextCursor: null }),
          getOwnedRuntime: vi.fn(),
          updateOwnedRuntimeDisplayName
        }),
        now: () => 1_000
      },
      root
    )
    const publications: HiveAccountRuntimeDirectoryState[] = []
    try {
      service.subscribe((state) => publications.push(state))
      service.setAuthorization(authorization('123e4567-e89b-42d3-a456-426614174000', 'token-a'))
      await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

      const result = await service.updateDisplayName({
        runtimeRecordId,
        cloudDisplayName: 'New name',
        expectedCloudDisplayNameVersion: 2
      })

      expect(result.pendingDisplayNames).toEqual([
        expect.objectContaining({ runtimeRecordId, desiredName: 'New name' })
      ])
      expect(publications.at(-1)).toBe(service.getState())
      expect(publications.at(-1)?.pendingDisplayNames).toEqual(result.pendingDisplayNames)
    } finally {
      service.stop()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refreshes account presence metadata in the background while signed in', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const listOwnedRuntimes = vi.fn().mockResolvedValue({
        items: [entry('623e4567-e89b-42d3-a456-426614174000')],
        nextCursor: null
      })
      const service = new HiveAccountRuntimeDirectoryService(
        { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
        { createClient: () => ({ listOwnedRuntimes }), now: () => Date.now() }
      )

      service.setAuthorization(authorization('123e4567-e89b-42d3-a456-426614174000', 'token-a'))
      await vi.advanceTimersByTimeAsync(0)
      expect(listOwnedRuntimes).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(30_000)
      expect(listOwnedRuntimes).toHaveBeenCalledTimes(2)

      service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retires the directory at session expiry without polling with an expired token', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const listOwnedRuntimes = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
      const service = new HiveAccountRuntimeDirectoryService(
        { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
        { createClient: () => ({ listOwnedRuntimes }), now: () => Date.now() }
      )
      service.setAuthorization(
        authorization('123e4567-e89b-42d3-a456-426614174000', 'token-a', 1, 2_000)
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(listOwnedRuntimes).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(31_000)

      expect(service.getState().status).toBe('SIGNED_OUT')
      expect(listOwnedRuntimes).toHaveBeenCalledOnce()
      service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads every owner-scoped page into an account-fenced memory snapshot', async () => {
    const first = entry('123e4567-e89b-42d3-a456-426614174000')
    const second = entry('223e4567-e89b-42d3-a456-426614174000')
    const listOwnedRuntimes = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [second], nextCursor: null })
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      { createClient: () => ({ listOwnedRuntimes }), now: () => 1_000 }
    )

    service.setAuthorization(authorization('323e4567-e89b-42d3-a456-426614174000', 'token-a'))
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    expect(service.getState()).toMatchObject({
      accountId: '323e4567-e89b-42d3-a456-426614174000',
      sessionGeneration: 1,
      items: [first, second],
      lastSyncedAt: 1_000
    })
    expect(listOwnedRuntimes).toHaveBeenNthCalledWith(
      2,
      'token-a',
      'next',
      100,
      expect.any(AbortSignal)
    )
    service.stop()
  })

  it('rejects a directory that continues beyond 100 pages without items', async () => {
    let page = 0
    const listOwnedRuntimes = vi.fn().mockImplementation(async () => ({
      items: [],
      nextCursor: `page-${++page}`
    }))
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      { createClient: () => ({ listOwnedRuntimes }), now: () => 1_000 }
    )

    service.setAuthorization(authorization('323e4567-e89b-42d3-a456-426614174000', 'token-a'))
    await vi.waitFor(() => expect(service.getState().status).toBe('ERROR'))

    expect(service.getState().errorCode).toBe('INVALID_RESPONSE')
    expect(listOwnedRuntimes).toHaveBeenCalledTimes(100)
    service.stop()
  })

  it('aborts and drops a previous account response after account switch', async () => {
    let firstSignal: AbortSignal | undefined
    const listOwnedRuntimes = vi.fn(
      (
        token: string,
        _cursor: string | null,
        _limit: number,
        signal?: AbortSignal
      ): Promise<{
        items: readonly HiveAccountRuntimeDirectoryEntry[]
        nextCursor: string | null
      }> => {
        if (!signal) {
          throw new Error('missing test abort signal')
        }
        if (token === 'token-a') {
          firstSignal = signal
          return new Promise<{
            items: readonly HiveAccountRuntimeDirectoryEntry[]
            nextCursor: string | null
          }>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
        return Promise.resolve({
          items: [entry('423e4567-e89b-42d3-a456-426614174000')],
          nextCursor: null
        })
      }
    )
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      { createClient: () => ({ listOwnedRuntimes }), now: () => 1_000 }
    )
    service.setAuthorization(authorization('123e4567-e89b-42d3-a456-426614174000', 'token-a'))
    await vi.waitFor(() => expect(listOwnedRuntimes).toHaveBeenCalledOnce())

    service.setAuthorization(authorization('223e4567-e89b-42d3-a456-426614174000', 'token-b'))
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    expect(firstSignal?.aborted).toBe(true)
    expect(service.getState().accountId).toBe('223e4567-e89b-42d3-a456-426614174000')
    expect(service.getState().items[0]?.runtimeRecordId).toBe(
      '423e4567-e89b-42d3-a456-426614174000'
    )
    service.stop()
  })

  it('drops cached entries when the authority changes for the same account id', async () => {
    const oldRuntime = entry('523e4567-e89b-42d3-a456-426614174000')
    const replacementRuntime = entry('623e4567-e89b-42d3-a456-426614174000')
    let resolveReplacement!: (value: {
      items: readonly HiveAccountRuntimeDirectoryEntry[]
      nextCursor: null
    }) => void
    const listOwnedRuntimes = vi
      .fn()
      .mockResolvedValueOnce({ items: [oldRuntime], nextCursor: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReplacement = resolve
          })
      )
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      { createClient: () => ({ listOwnedRuntimes }), now: () => 1_000 }
    )
    const accountId = '123e4567-e89b-42d3-a456-426614174000'
    service.setAuthorization(authorization(accountId, 'token-a'))
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    service.setAuthorization(authorization(accountId, 'token-b', 1, 100_000, 'hive-secondary'))

    expect(service.getState()).toMatchObject({ status: 'LOADING', items: [] })
    resolveReplacement({ items: [replacementRuntime], nextCursor: null })
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))
    expect(service.getState().items).toEqual([replacementRuntime])
    service.stop()
  })

  it('retires rejected authorization and never polls the rejected token again', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const runtime = entry('523e4567-e89b-42d3-a456-426614174000')
      const listOwnedRuntimes = vi
        .fn()
        .mockResolvedValueOnce({ items: [runtime], nextCursor: null })
        .mockRejectedValueOnce(new HiveRuntimeCloudRequestError(401, null))
      const service = new HiveAccountRuntimeDirectoryService(
        { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
        { createClient: () => ({ listOwnedRuntimes }), now: () => Date.now() }
      )
      service.setAuthorization(
        authorization('123e4567-e89b-42d3-a456-426614174000', 'rejected-token')
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(service.getState()).toMatchObject({ status: 'READY', items: [runtime] })

      await vi.advanceTimersByTimeAsync(30_000)

      expect(service.getState()).toMatchObject({
        status: 'ERROR',
        items: [],
        lastSyncedAt: null,
        errorCode: 'SESSION_REJECTED'
      })
      await service.refresh()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(listOwnedRuntimes).toHaveBeenCalledTimes(2)
      await expect(service.createConnection(runtime.runtimeRecordId, 1)).rejects.toThrow(
        'hive_account_runtime_connection_signed_out'
      )
      service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears only the account directory on sign-out', async () => {
    const listOwnedRuntimes = vi.fn().mockResolvedValue({
      items: [entry('523e4567-e89b-42d3-a456-426614174000')],
      nextCursor: null
    })
    const service = new HiveAccountRuntimeDirectoryService(
      { enabled: true, apiBaseUrl: 'https://api.hivekernel.com' },
      { createClient: () => ({ listOwnedRuntimes }), now: () => 1_000 }
    )
    service.setAuthorization(authorization('123e4567-e89b-42d3-a456-426614174000', 'token-a'))
    await vi.waitFor(() => expect(service.getState().status).toBe('READY'))

    service.setAuthorization(null)

    expect(service.getState()).toMatchObject({ status: 'SIGNED_OUT', accountId: null, items: [] })
    service.stop()
  })
})
