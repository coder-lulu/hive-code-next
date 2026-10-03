import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-notifications', () => ({
  getDevicePushTokenAsync: vi.fn(),
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() }))
}))
vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length),
  randomUUID: () => '11111111-1111-4111-8111-111111111111'
}))
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'android' }
}))
import type { MobileSession } from '../auth/mobile-sms-session'
import {
  HiveMobilePushRegistrationCoordinator,
  type HiveMobilePushRegistrationDependencies
} from './hive-mobile-push-registration'

const session: MobileSession = {
  accessToken: 'mobile-access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 60_000,
  sessionExpiresAt: Date.now() + 120_000,
  sessionProfile: 'TRUSTED',
  account: { accountId: 'account-id', displayName: 'User' },
  authorityId: 'authority-id'
}

function fixture(overrides: Partial<HiveMobilePushRegistrationDependencies> = {}) {
  let preferenceListener: () => void = () => undefined
  let tokenListener: (_token: { data: unknown }) => void = () => undefined
  let appStateListener: (_state: string) => void = () => undefined
  let intervalListener: () => void = () => undefined
  const publishAvailability = vi.fn()
  const register = vi.fn(async () => ({ deliveryAvailable: true }))
  const unregister = vi.fn(async () => undefined)
  const setPresentationSession = vi.fn()
  const flushPresentations = vi.fn(async () => undefined)
  const dependencies: HiveMobilePushRegistrationDependencies = {
    loadPreference: vi.fn(async () => true),
    hasPermission: vi.fn(async () => true),
    readToken: vi.fn(async () => ({ data: 'initial-token' })),
    register,
    unregister,
    subscribePreference: (listener) => {
      preferenceListener = listener
      return vi.fn()
    },
    subscribeToken: (listener) => {
      tokenListener = listener
      return { remove: vi.fn() }
    },
    subscribeAppState: (listener) => {
      appStateListener = listener
      return { remove: vi.fn() }
    },
    setInterval: (listener) => {
      intervalListener = listener
      const timer = setInterval(() => undefined, 2_147_483_647)
      return timer
    },
    clearInterval: (timer) => clearInterval(timer),
    platform: 'android',
    development: false,
    publishAvailability,
    setPresentationSession,
    flushPresentations,
    ...overrides
  }
  const coordinator = new HiveMobilePushRegistrationCoordinator(dependencies)
  return {
    coordinator,
    dependencies,
    register,
    unregister,
    setPresentationSession,
    flushPresentations,
    publishAvailability,
    preference: () => preferenceListener(),
    token: (value: string) => tokenListener({ data: value }),
    foreground: () => appStateListener('active'),
    interval: () => intervalListener()
  }
}

describe('HiveMobilePushRegistrationCoordinator', () => {
  it('registers after login and renews on foreground, timer, and token rotation', async () => {
    const state = fixture()
    state.coordinator.start()
    state.coordinator.setSession(session)
    await vi.waitFor(() => expect(state.register).toHaveBeenCalledTimes(1))
    expect(state.register).toHaveBeenLastCalledWith(
      session,
      { platform: 'ANDROID', token: 'initial-token' },
      expect.any(AbortSignal)
    )
    expect(state.publishAvailability).toHaveBeenLastCalledWith({ status: 'available' })

    state.foreground()
    await vi.waitFor(() => expect(state.register).toHaveBeenCalledTimes(2))
    state.interval()
    await vi.waitFor(() => expect(state.register).toHaveBeenCalledTimes(3))
    state.token('rotated-token')
    await vi.waitFor(() => expect(state.register).toHaveBeenCalledTimes(4))
    expect(state.register).toHaveBeenLastCalledWith(
      session,
      { platform: 'ANDROID', token: 'rotated-token' },
      expect.any(AbortSignal)
    )
    state.coordinator.stop()
  })

  it('replays pending presentation acknowledgements on session and foreground sync', async () => {
    const state = fixture()
    state.coordinator.start()
    state.coordinator.setSession(session)
    await vi.waitFor(() => expect(state.register).toHaveBeenCalledOnce())

    expect(state.setPresentationSession).toHaveBeenCalledWith(session)
    expect(state.flushPresentations).toHaveBeenCalled()

    const flushes = state.flushPresentations.mock.calls.length
    state.foreground()
    await vi.waitFor(() =>
      expect(state.flushPresentations.mock.calls.length).toBeGreaterThan(flushes)
    )

    state.coordinator.setSession(null)
    expect(state.setPresentationSession).toHaveBeenLastCalledWith(null)
    state.coordinator.stop()
  })

  it('unregisters when consent is disabled and when the account signs out', async () => {
    let enabled = true
    const state = fixture({ loadPreference: vi.fn(async () => enabled) })
    state.coordinator.start()
    state.coordinator.setSession(session)
    await vi.waitFor(() => expect(state.register).toHaveBeenCalledOnce())

    enabled = false
    state.preference()
    await vi.waitFor(() => expect(state.unregister).toHaveBeenCalledOnce())
    state.coordinator.setSession(null)
    await vi.waitFor(() => expect(state.unregister).toHaveBeenCalledTimes(2))
    state.coordinator.stop()
  })

  it('aborts stale registration work before applying a rotated token', async () => {
    let firstSignal: AbortSignal | undefined
    const register = vi
      .fn()
      .mockImplementationOnce(
        async (_session: MobileSession, _token: unknown, signal: AbortSignal) => {
          firstSignal = signal
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
          return { deliveryAvailable: true }
        }
      )
      .mockResolvedValue({ deliveryAvailable: true })
    const state = fixture({ register })
    state.coordinator.start()
    state.coordinator.setSession(session)
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce())

    state.token('rotated-token')
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2))
    expect(firstSignal?.aborted).toBe(true)
    expect(register).toHaveBeenLastCalledWith(
      session,
      { platform: 'ANDROID', token: 'rotated-token' },
      expect.any(AbortSignal)
    )
    state.coordinator.stop()
  })

  it('reports token, Cloud, and provider availability without exposing failures', async () => {
    const missingToken = fixture({
      readToken: vi.fn(async () => {
        throw new Error('secret')
      })
    })
    missingToken.coordinator.start()
    missingToken.coordinator.setSession(session)
    await vi.waitFor(() =>
      expect(missingToken.publishAvailability).toHaveBeenLastCalledWith({
        status: 'unavailable',
        reason: 'token_unavailable'
      })
    )

    const cloudFailure = fixture({
      register: vi.fn(async () => {
        throw new Error('internal provider detail')
      })
    })
    cloudFailure.coordinator.start()
    cloudFailure.coordinator.setSession(session)
    await vi.waitFor(() =>
      expect(cloudFailure.publishAvailability).toHaveBeenLastCalledWith({
        status: 'unavailable',
        reason: 'cloud_unavailable'
      })
    )

    const providerUnavailable = fixture({
      register: vi.fn(async () => ({ deliveryAvailable: false }))
    })
    providerUnavailable.coordinator.start()
    providerUnavailable.coordinator.setSession(session)
    await vi.waitFor(() =>
      expect(providerUnavailable.publishAvailability).toHaveBeenLastCalledWith({
        status: 'unavailable',
        reason: 'cloud_unavailable'
      })
    )

    missingToken.coordinator.stop()
    cloudFailure.coordinator.stop()
    providerUnavailable.coordinator.stop()
  })
})
