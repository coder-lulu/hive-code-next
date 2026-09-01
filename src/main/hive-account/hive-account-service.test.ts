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
  getLoginCapabilities: ReturnType<typeof vi.fn>
  discoverAuthorizationEndpoint: ReturnType<typeof vi.fn>
  createDeviceAuthorization: ReturnType<typeof vi.fn>
  createSmsChallenge: ReturnType<typeof vi.fn>
  verifySmsChallenge: ReturnType<typeof vi.fn>
  authorizeSms: ReturnType<typeof vi.fn>
  exchangeSession: ReturnType<typeof vi.fn>
  refreshSession: ReturnType<typeof vi.fn>
  listCloudSessions: ReturnType<typeof vi.fn>
  revokeSession: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'hive-account-service-'))
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  client = {
    getLoginCapabilities: vi.fn().mockResolvedValue({
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: []
    }),
    discoverAuthorizationEndpoint: vi
      .fn()
      .mockResolvedValue(
        'https://identity.hivekernel.com/realms/hive/protocol/openid-connect/auth'
      ),
    createDeviceAuthorization: vi.fn().mockResolvedValue(undefined),
    createSmsChallenge: vi.fn().mockResolvedValue({
      challengeId: '0123456789abcdef0123456789abcdef',
      expiresInSeconds: 300,
      resendAfterSeconds: 60
    }),
    verifySmsChallenge: vi.fn().mockResolvedValue(undefined),
    authorizeSms: vi.fn().mockResolvedValue({
      authorizationCode: 'sms-code',
      state: 'sms-state'
    }),
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
  onStateChanged: (state: HiveAccountState) => void = () => undefined,
  observeAuthorizationEndpoint: (endpoint: string) => void = () => undefined,
  observeAuthorizationOptions: (options: Record<string, unknown>) => void = () => undefined
): HiveAccountService {
  return new HiveAccountService(
    userDataPath,
    {
      getConfig: () => ({ configured: true, config }),
      createClient: () => client,
      beginAuthorization: async (options: {
        authorizationEndpoint: string
        prepareDeviceAuthorization: (nonce: string) => Promise<void>
      }) => {
        observeAuthorizationEndpoint(options.authorizationEndpoint)
        observeAuthorizationOptions(options)
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

  it('uses only an advertised provider authorization path for the existing PKCE flow', async () => {
    client.getLoginCapabilities.mockResolvedValue({
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: [
        {
          id: 'github',
          authorizationPath: '/hive/v1/auth/provider-authorizations/github'
        }
      ]
    })
    let authorizationEndpoint = ''
    const service = createService(
      () => undefined,
      (endpoint) => {
        authorizationEndpoint = endpoint
      }
    )

    await expect(
      service.signIn({ sessionProfile: 'TRUSTED', providerId: 'github' })
    ).resolves.toMatchObject({ status: 'signed-in' })

    expect(authorizationEndpoint).toBe(
      'https://api.hivekernel.com/hive/v1/auth/provider-authorizations/github'
    )
    expect(client.getLoginCapabilities).toHaveBeenCalledOnce()
    expect(client.discoverAuthorizationEndpoint).not.toHaveBeenCalled()
  })

  it('requests a fresh LoA 2 browser authentication for a step-up sign-in', async () => {
    const observeAuthorizationOptions = vi.fn()
    const service = createService(
      () => undefined,
      () => undefined,
      observeAuthorizationOptions
    )

    await expect(
      service.signIn({ sessionProfile: 'TRUSTED', intent: 'STEP_UP' })
    ).resolves.toMatchObject({ status: 'signed-in' })

    expect(observeAuthorizationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        acrValues: 'urn:hive:acr:step-up',
        maxAgeSeconds: 0,
        prompt: 'login'
      })
    )
  })

  it('falls back to no providers when login capability discovery fails', async () => {
    client.getLoginCapabilities.mockRejectedValue(new Error('offline'))

    await expect(createService().getLoginCapabilities()).resolves.toEqual({
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: []
    })
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

  it.each([
    ['session rejection', new HiveAccountRequestError(401, null)],
    ['network failure', new TypeError('offline')]
  ])('ignores a stale refresh %s after a newer sign-in', async (_label, refreshError) => {
    vi.useFakeTimers()
    try {
      const onStateChanged = vi.fn()
      const service = createService(onStateChanged)
      await service.signIn({ sessionProfile: 'TRUSTED' })

      let rejectRefresh: ((error: unknown) => void) | undefined
      client.refreshSession.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRefresh = reject
        })
      )
      const refresh = service.refresh()
      expect(client.refreshSession).toHaveBeenCalledOnce()

      await service.signOut()
      const newerSession = {
        ...sessionResponse,
        accessToken: 'newer-access',
        refreshToken: 'newer-refresh',
        expiresAt: Date.now() + 600_000,
        account: {
          accountId: '223e4567-e89b-42d3-a456-426614174000',
          displayName: 'Grace'
        }
      }
      client.exchangeSession.mockResolvedValueOnce(newerSession)
      await service.signIn({ sessionProfile: 'TRUSTED' })
      onStateChanged.mockClear()

      rejectRefresh?.(refreshError)

      await expect(refresh).resolves.toMatchObject({
        status: 'refreshed',
        state: {
          status: 'signed-in',
          account: { accountId: newerSession.account.accountId, displayName: 'Grace' }
        }
      })
      await expect(service.getState()).resolves.toMatchObject({
        status: 'signed-in',
        account: { accountId: newerSession.account.accountId, displayName: 'Grace' }
      })
      expect(onStateChanged).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          status: 'signed-in',
          account: expect.objectContaining({ accountId: newerSession.account.accountId })
        })
      )

      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.refreshSession).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
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

  it('allows a cancelled SMS challenge to be started again', async () => {
    const service = createService()
    await service.startSmsSignIn({
      phoneNumber: '+8613800138000',
      sessionProfile: 'TEMPORARY',
      termsAccepted: true
    })
    service.cancelSmsSignIn()

    await expect(
      service.startSmsSignIn({
        phoneNumber: '+8613800138000',
        sessionProfile: 'TEMPORARY',
        termsAccepted: true
      })
    ).resolves.toMatchObject({ challengeId: '0123456789abcdef0123456789abcdef' })
    expect(client.createSmsChallenge).toHaveBeenCalledTimes(2)
  })

  it('does not resurrect a cancelled SMS start that finishes late', async () => {
    const service = createService()
    let resolveChallenge:
      | ((value: {
          challengeId: string
          expiresInSeconds: number
          resendAfterSeconds: number
        }) => void)
      | undefined
    client.createSmsChallenge.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveChallenge = resolve
      })
    )

    const start = service.startSmsSignIn({
      phoneNumber: '+8613800138000',
      sessionProfile: 'TEMPORARY',
      termsAccepted: true
    })
    await vi.waitFor(() => expect(client.createSmsChallenge).toHaveBeenCalledOnce())
    service.cancelSmsSignIn()
    const retry = service.startSmsSignIn({
      phoneNumber: '+8613800138000',
      sessionProfile: 'TEMPORARY',
      termsAccepted: true
    })
    resolveChallenge?.({
      challengeId: '0123456789abcdef0123456789abcdef',
      expiresInSeconds: 300,
      resendAfterSeconds: 60
    })

    await expect(start).rejects.toThrow('hive_account_sms_sign_in_cancelled')
    await expect(retry).resolves.toMatchObject({ challengeId: '0123456789abcdef0123456789abcdef' })
    expect(client.createSmsChallenge).toHaveBeenCalledTimes(2)
  })

  it('retries authorization without re-verifying an already verified SMS challenge', async () => {
    const service = createService()
    client.authorizeSms
      .mockRejectedValueOnce(new HiveAccountRequestError(503, 'unavailable'))
      .mockResolvedValueOnce({ authorizationCode: 'sms-code-2', state: 'sms-state' })

    await service.startSmsSignIn({
      phoneNumber: '+8613800138000',
      sessionProfile: 'TEMPORARY',
      termsAccepted: true
    })
    const first = await service.completeSmsSignIn({
      challengeId: '0123456789abcdef0123456789abcdef',
      smsCode: '123456'
    })
    expect(first.status).toBe('failed')

    const second = await service.completeSmsSignIn({
      challengeId: '0123456789abcdef0123456789abcdef',
      smsCode: '123456'
    })
    expect(second.status).toBe('signed-in')
    expect(client.verifySmsChallenge).toHaveBeenCalledOnce()
    expect(client.authorizeSms).toHaveBeenCalledTimes(2)
  })

  it('retries a failed SMS exchange with a fresh authorization code', async () => {
    const service = createService()
    client.exchangeSession
      .mockRejectedValueOnce(new HiveAccountRequestError(503, 'unavailable'))
      .mockResolvedValueOnce(sessionResponse)

    await service.startSmsSignIn({
      phoneNumber: '+8613800138000',
      sessionProfile: 'TEMPORARY',
      termsAccepted: true
    })
    await expect(
      service.completeSmsSignIn({
        challengeId: '0123456789abcdef0123456789abcdef',
        smsCode: '123456'
      })
    ).resolves.toMatchObject({ status: 'failed' })
    await expect(
      service.completeSmsSignIn({
        challengeId: '0123456789abcdef0123456789abcdef',
        smsCode: '123456'
      })
    ).resolves.toMatchObject({ status: 'signed-in' })

    expect(client.verifySmsChallenge).toHaveBeenCalledOnce()
    expect(client.authorizeSms).toHaveBeenCalledTimes(2)
    expect(client.exchangeSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        authorizationCode: 'sms-code'
      })
    )
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
