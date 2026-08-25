import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../shared/hive-account'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

vi.mock('electron', () => ({
  app: { isPackaged: true },
  safeStorage: safeStorageMock,
  shell: { openExternal: vi.fn() }
}))

import { HiveAccountService } from './hive-account-service'
import { HiveAccountRequestError } from './hive-account-client'

const config = {
  apiBaseUrl: 'https://api.hivekernel.com',
  identityIssuer: 'https://identity.hivekernel.com/realms/hive',
  clientId: 'hivecode-desktop',
  scope: 'openid profile email hive.session.exchange'
}

const sessionResponse = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 600_000,
  sessionExpiresAt: Date.now() + 90 * 24 * 60 * 60 * 1_000,
  sessionProfile: 'TRUSTED' as const,
  account: { accountId: '123e4567-e89b-42d3-a456-426614174000', displayName: 'Ada' },
  authorityId: 'hive-primary'
}

let userDataPath: string
let client: {
  discoverAuthorizationEndpoint: ReturnType<typeof vi.fn>
  createDeviceAuthorization: ReturnType<typeof vi.fn>
  exchangeSession: ReturnType<typeof vi.fn>
  refreshSession: ReturnType<typeof vi.fn>
  listCloudSessions: ReturnType<typeof vi.fn>
  revokeSession: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'hive-account-service-'))
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  client = {
    discoverAuthorizationEndpoint: vi
      .fn()
      .mockResolvedValue(
        'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth'
      ),
    createDeviceAuthorization: vi.fn().mockResolvedValue(undefined),
    exchangeSession: vi.fn().mockResolvedValue(sessionResponse),
    refreshSession: vi.fn().mockResolvedValue({
      ...sessionResponse,
      accessToken: 'access-2',
      refreshToken: 'refresh-2'
    }),
    listCloudSessions: vi.fn().mockResolvedValue([
      {
        cloudSessionId: '223e4567-e89b-42d3-a456-426614174000',
        securityVersion: 3,
        currentSession: true
      }
    ]),
    revokeSession: vi.fn().mockResolvedValue(undefined)
  }
})

afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

function createService(
  onStateChanged: (state: HiveAccountState) => void = () => undefined
): HiveAccountService {
  return new HiveAccountService(
    userDataPath,
    {
      getConfig: () => ({ configured: true, config }),
      createClient: () => client,
      beginAuthorization: async (options: {
        prepareDeviceAuthorization: (nonce: string) => Promise<void>
      }) => {
        await options.prepareDeviceAuthorization('nonce')
        return {
          authorizationCode: 'code',
          codeVerifier: 'verifier',
          nonce: 'nonce',
          redirectUri: 'http://127.0.0.1:32123'
        }
      }
    } as never,
    onStateChanged
  )
}

describe('Hive account application service', () => {
  it('creates a device authorization before exchanging and persists the Native session', async () => {
    const service = createService()
    const result = await service.signIn({ sessionProfile: 'TRUSTED' })
    expect(result).toMatchObject({
      status: 'signed-in',
      state: {
        status: 'signed-in',
        persistence: 'encrypted',
        account: { displayName: 'Ada' }
      }
    })
    expect(client.createDeviceAuthorization).toHaveBeenCalledOnce()
    expect(client.exchangeSession).toHaveBeenCalledWith({
      authorizationCode: 'code',
      codeVerifier: 'verifier',
      nonce: 'nonce',
      redirectUri: 'http://127.0.0.1:32123'
    })
    await expect(createService().getState()).resolves.toMatchObject({ status: 'signed-in' })
  })

  it('keeps a temporary authorization in memory and does not restore it after restart', async () => {
    client.exchangeSession.mockResolvedValue({
      ...sessionResponse,
      sessionExpiresAt: Date.now() + 24 * 60 * 60 * 1_000,
      sessionProfile: 'TEMPORARY'
    })
    const service = createService()

    await expect(service.signIn({ sessionProfile: 'TEMPORARY' })).resolves.toMatchObject({
      status: 'signed-in',
      state: { persistence: 'none', sessionProfile: 'TEMPORARY' }
    })

    expect(client.createDeviceAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ sessionProfile: 'TEMPORARY' })
    )
    await expect(createService().getState()).resolves.toMatchObject({ status: 'signed-out' })
  })

  it('single-flights refresh and revokes the current Cloud session on sign-out', async () => {
    const service = createService()
    await service.signIn({ sessionProfile: 'TRUSTED' })
    const [first, second] = await Promise.all([service.refresh(), service.refresh()])
    expect(first.status).toBe('refreshed')
    expect(second.status).toBe('refreshed')
    expect(client.refreshSession).toHaveBeenCalledOnce()

    await expect(service.signOut()).resolves.toMatchObject({
      status: 'remote-and-local',
      state: { status: 'signed-out' }
    })
    expect(client.revokeSession).toHaveBeenCalledOnce()
    await expect(service.getState()).resolves.toMatchObject({ status: 'signed-out' })
  })

  it('fails closed when operating-system encryption is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    await expect(createService().getState()).resolves.toMatchObject({
      status: 'error',
      errorCode: 'secure_storage_unavailable'
    })
    await expect(createService().signIn({ sessionProfile: 'TRUSTED' })).resolves.toMatchObject({
      status: 'failed'
    })
    expect(client.discoverAuthorizationEndpoint).not.toHaveBeenCalled()
  })

  it('revokes a refreshed session that loses a race with sign-out', async () => {
    const service = createService()
    await service.signIn({ sessionProfile: 'TRUSTED' })
    let finishRefresh: ((value: typeof sessionResponse) => void) | undefined
    client.refreshSession.mockReturnValue(
      new Promise((resolve) => {
        finishRefresh = resolve
      })
    )

    const refresh = service.refresh()
    await vi.waitFor(() => expect(client.refreshSession).toHaveBeenCalledOnce())
    await service.signOut()
    finishRefresh?.({
      ...sessionResponse,
      accessToken: 'late-access',
      refreshToken: 'late-refresh'
    })

    await expect(refresh).resolves.toMatchObject({ status: 'signed-out' })
    expect(client.revokeSession).toHaveBeenCalledTimes(2)
  })

  it('publishes every completed account mutation to renderer subscribers', async () => {
    const onStateChanged = vi.fn()
    const service = createService(onStateChanged)

    await service.signIn({ sessionProfile: 'TRUSTED' })
    await service.refresh()
    await service.signOut()

    expect(onStateChanged.mock.calls.map(([state]) => state.status)).toEqual([
      'signed-in',
      'signed-in',
      'signed-out'
    ])
  })

  it('does not fail an account mutation when a renderer state listener throws', async () => {
    const service = createService(() => {
      throw new Error('renderer disappeared')
    })

    await expect(service.signIn({ sessionProfile: 'TRUSTED' })).resolves.toMatchObject({
      status: 'signed-in'
    })
  })

  it('publishes a signed-out state when refresh rejects the stored session', async () => {
    const onStateChanged = vi.fn()
    const service = createService(onStateChanged)
    await service.signIn({ sessionProfile: 'TRUSTED' })
    onStateChanged.mockClear()
    client.refreshSession.mockRejectedValue(new HiveAccountRequestError(401, null))

    await expect(service.refresh()).resolves.toMatchObject({ status: 'signed-out' })

    expect(onStateChanged).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'signed-out' })
    )
  })

  it('exposes a main-only bounded authorization snapshot without refresh material', async () => {
    const service = createService()
    await service.signIn({ sessionProfile: 'TRUSTED' })

    expect(service.getRuntimeCloudAuthorization()).toEqual({
      accessToken: 'access',
      accountId: sessionResponse.account.accountId,
      authorityId: 'hive-primary',
      sessionExpiresAt: sessionResponse.sessionExpiresAt,
      sessionGeneration: 1
    })
    expect(service.getRuntimeCloudAuthorization()).not.toHaveProperty('refreshToken')
    expect(service.getRuntimeCloudAuthorization()).not.toHaveProperty('privateKey')
  })

  it('fences Runtime Cloud authorization before remote sign-out can settle', async () => {
    const service = createService()
    await service.signIn({ sessionProfile: 'TRUSTED' })
    let finishList: ((value: never[]) => void) | undefined
    client.listCloudSessions.mockReturnValue(
      new Promise((resolve) => {
        finishList = resolve
      })
    )
    const authorizations: unknown[] = []
    service.subscribeRuntimeCloudAuthorization((authorization) =>
      authorizations.push(authorization)
    )

    const signOut = service.signOut()

    expect(authorizations).toEqual([null])
    expect(service.getRuntimeCloudAuthorization()).toBeNull()
    finishList?.([])
    await signOut
    expect(service.getRuntimeCloudAuthorization()).toBeNull()
  })

  it('fences before a rejected refresh clears the stored session', async () => {
    const service = createService()
    await service.signIn({ sessionProfile: 'TRUSTED' })
    client.refreshSession.mockRejectedValue(new HiveAccountRequestError(401, null))
    const authorizations: unknown[] = []
    service.subscribeRuntimeCloudAuthorization((authorization) =>
      authorizations.push(authorization)
    )

    await service.refresh()

    expect(authorizations).toEqual([null])
    expect(service.getRuntimeCloudAuthorization()).toBeNull()
  })
})
