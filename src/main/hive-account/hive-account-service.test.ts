import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

function createService(): HiveAccountService {
  return new HiveAccountService(userDataPath, {
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
  } as never)
}

describe('Hive account application service', () => {
  it('creates a device authorization before exchanging and persists the Native session', async () => {
    const service = createService()
    const result = await service.signIn()
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

  it('single-flights refresh and revokes the current Cloud session on sign-out', async () => {
    const service = createService()
    await service.signIn()
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
    await expect(createService().signIn()).resolves.toMatchObject({ status: 'failed' })
    expect(client.discoverAuthorizationEndpoint).not.toHaveBeenCalled()
  })

  it('revokes a refreshed session that loses a race with sign-out', async () => {
    const service = createService()
    await service.signIn()
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
})
