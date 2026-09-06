import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler)
  }),
  getAllWindows: vi.fn(() => [])
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  ipcMain: { handle: electronMocks.handle },
  shell: { openExternal: electronMocks.openExternal }
}))

import {
  registerHiveRuntimeCloudHandlers,
  requireHiveLocalRuntimeClaimRequest,
  requireHiveRuntimeDisplayNameUpdateRequest,
  requireHiveRuntimeSessionRevokeRequest
} from './hive-runtime-cloud'

const ACCOUNT_ID = '223e4567-e89b-42d3-a456-426614174000'

beforeEach(() => {
  electronMocks.handlers.clear()
  electronMocks.handle.mockClear()
  electronMocks.getAllWindows.mockReturnValue([])
})

describe('Hive Runtime Cloud IPC', () => {
  it('validates and routes an exact Runtime display-name update', async () => {
    const updateDisplayName = vi.fn().mockResolvedValue({ status: 'READY' })
    registerHiveRuntimeCloudHandlers({
      directory: {
        getState: vi.fn(),
        refresh: vi.fn(),
        updateDisplayName,
        subscribe: vi.fn()
      },
      ownership: {
        getState: vi.fn(),
        refresh: vi.fn(),
        claimLocalRuntime: vi.fn(),
        subscribe: vi.fn()
      },
      sessions: { list: vi.fn(), revoke: vi.fn() }
    } as never)

    await expect(
      electronMocks.handlers.get('hiveRuntimeCloud:updateDisplayName')?.(undefined, {
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        cloudDisplayName: ' Cafe\u0301 ',
        expectedCloudDisplayNameVersion: 4
      })
    ).resolves.toEqual({ status: 'READY' })
    expect(updateDisplayName).toHaveBeenCalledWith({
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      cloudDisplayName: 'Café',
      expectedCloudDisplayNameVersion: 4
    })
  })

  it.each([
    null,
    {},
    {
      runtimeRecordId: 'not-a-uuid',
      cloudDisplayName: 'Desk',
      expectedCloudDisplayNameVersion: 1
    },
    {
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      cloudDisplayName: 'Desk\ud800',
      expectedCloudDisplayNameVersion: 1
    },
    {
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      cloudDisplayName: 'Desk',
      expectedCloudDisplayNameVersion: 0
    },
    {
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      cloudDisplayName: null,
      expectedCloudDisplayNameVersion: 1,
      accountId: 'forged'
    }
  ])('rejects malformed Runtime display-name input %#', (value) => {
    expect(() => requireHiveRuntimeDisplayNameUpdateRequest(value)).toThrow(
      'Invalid Runtime display-name request'
    )
  })

  it('validates and binds a local Runtime claim to the renderer account', async () => {
    const claimLocalRuntime = vi.fn(
      async (_account: string, open: (code: string) => Promise<void>) => {
        await open('ABCD-EFGH')
        await expect(open('invalid#code')).rejects.toThrow('Invalid Runtime claim code')
        return { relation: 'CLAIMED_BY_CURRENT' }
      }
    )
    registerHiveRuntimeCloudHandlers({
      directory: { getState: vi.fn(), refresh: vi.fn(), subscribe: vi.fn() },
      ownership: {
        getState: vi.fn(),
        refresh: vi.fn(),
        claimLocalRuntime,
        subscribe: vi.fn()
      },
      sessions: { list: vi.fn(), revoke: vi.fn() }
    } as never)

    await expect(
      electronMocks.handlers.get('hiveRuntimeCloud:claimLocalRuntime')?.(undefined, {
        expectedAccountId: ACCOUNT_ID
      })
    ).resolves.toEqual({ relation: 'CLAIMED_BY_CURRENT' })
    expect(claimLocalRuntime).toHaveBeenCalledWith(ACCOUNT_ID, expect.any(Function))
    expect(electronMocks.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://console.hivekernel.com/runtime-claim#userCode=ABCD-EFGH'
    )
  })

  it.each([
    null,
    {},
    { expectedAccountId: 'not-a-uuid' },
    { expectedAccountId: ACCOUNT_ID.toUpperCase() },
    { expectedAccountId: ACCOUNT_ID, accountId: 'forged' }
  ])('rejects malformed local Runtime claim input %#', (value) => {
    expect(() => requireHiveLocalRuntimeClaimRequest(value)).toThrow(
      'Invalid Runtime claim request'
    )
  })

  it('lists and validates forced session revocation', async () => {
    const list = vi.fn().mockResolvedValue([{ status: 'ACTIVE' }])
    const revoke = vi.fn().mockResolvedValue({ status: 'REVOKE_PENDING' })
    registerHiveRuntimeCloudHandlers({
      directory: { getState: vi.fn(), refresh: vi.fn(), subscribe: vi.fn() },
      ownership: {
        getState: vi.fn(),
        refresh: vi.fn(),
        claimLocalRuntime: vi.fn(),
        subscribe: vi.fn()
      },
      sessions: { list, revoke }
    } as never)

    await expect(electronMocks.handlers.get('hiveRuntimeCloud:listSessions')?.()).resolves.toEqual([
      { status: 'ACTIVE' }
    ])
    await expect(
      electronMocks.handlers.get('hiveRuntimeCloud:revokeSession')?.(undefined, {
        managedSessionId: '11111111-1111-4111-8111-111111111111',
        expectedResourceVersion: 3
      })
    ).resolves.toEqual({ status: 'REVOKE_PENDING' })
    expect(revoke).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 3)
  })

  it.each([
    null,
    {},
    { managedSessionId: 'not-a-uuid', expectedResourceVersion: 1 },
    {
      managedSessionId: '11111111-1111-4111-8111-111111111111',
      expectedResourceVersion: 0
    },
    {
      managedSessionId: '11111111-1111-4111-8111-111111111111',
      expectedResourceVersion: 1,
      accountId: 'forged'
    }
  ])('rejects malformed renderer input %#', (value) => {
    expect(() => requireHiveRuntimeSessionRevokeRequest(value)).toThrow(
      'Invalid Runtime session revoke request'
    )
  })

  it('isolates a destroyed window from cloud state publication', () => {
    let publishDirectory: ((state: unknown) => void) | undefined
    const healthySend = vi.fn()
    electronMocks.getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: () => {
            throw new Error('destroyed')
          }
        }
      },
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: healthySend }
      }
    ] as never)
    registerHiveRuntimeCloudHandlers({
      directory: {
        getState: vi.fn(),
        refresh: vi.fn(),
        subscribe: vi.fn((listener: (state: unknown) => void) => {
          publishDirectory = listener
          return () => undefined
        })
      },
      ownership: {
        getState: vi.fn(),
        refresh: vi.fn(),
        claimLocalRuntime: vi.fn(),
        subscribe: vi.fn()
      },
      sessions: { list: vi.fn(), revoke: vi.fn() }
    } as never)

    expect(() => publishDirectory?.({ status: 'READY' })).not.toThrow()
    expect(healthySend).toHaveBeenCalledOnce()
  })
})
