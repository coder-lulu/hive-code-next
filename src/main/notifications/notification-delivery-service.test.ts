import { RuntimeMobileNotificationController } from '../runtime/runtime-mobile-notification-controller'
import { HiveMobilePushClient } from '../hive-runtime-cloud/hive-mobile-push-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createNotificationDeliveryService } from './notification-delivery-service'
import type { NotificationDeliveryDependencies } from './notification-delivery-service'
import type {
  NotificationDispatchRequest,
  NotificationSettings
} from '../../shared/notification-settings-types'

function makeSettings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    enabled: true,
    agentTaskComplete: true,
    terminalBell: true,
    suppressWhenFocused: false,
    customSoundId: 'system',
    customSoundPath: null,
    customSoundVolume: 1,
    mutedNotificationSourceIds: [],
    ...overrides
  }
}

function makeRequest(
  overrides: Partial<NotificationDispatchRequest> = {}
): NotificationDispatchRequest {
  return {
    source: 'agent-task-complete',
    worktreeId: 'wt-1',
    worktreeLabel: 'wt-1',
    ...overrides
  }
}

type Harness = {
  deps: NotificationDeliveryDependencies
  order: string[]
  setTrayAttention: ReturnType<typeof vi.fn>
  dispatchMobileNotification: ReturnType<typeof vi.fn>
  deliverNative: ReturnType<typeof vi.fn>
}

let now = 1_000

/** The delivery policy only asks a window whether it is focused. */
function makeFocusedWindowStub(): BrowserWindow {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the service reads only isFocused(); a full BrowserWindow cannot be constructed outside Electron.
  return { isFocused: () => true } as unknown as BrowserWindow
}

function makeHarness(settings: NotificationSettings, windowVisible = false): Harness {
  const order: string[] = []
  const setTrayAttention = vi.fn(() => order.push('tray'))
  const dispatchMobileNotification = vi.fn(() => order.push('mobile'))
  const deliverNative = vi.fn(() => {
    order.push('native')
    return { delivered: true } as const
  })
  return {
    order,
    setTrayAttention,
    dispatchMobileNotification,
    deliverNative,
    deps: {
      readNotificationSettings: () => settings,
      findActiveWindow: () => null,
      isWindowVisible: () => windowVisible,
      setTrayAttention,
      isNotificationSupported: () => true,
      dispatchMobileNotification,
      readAuthorizationStatus: () => Promise.resolve('authorized'),
      recordDeliveryOutcome: vi.fn(),
      deliverNative,
      platform: 'linux',
      now: () => now
    }
  }
}

beforeEach(() => {
  now += 60_000
})

describe('createNotificationDeliveryService', () => {
  it('lights the tray dot before the enabled/cooldown gates can reject the event', () => {
    const harness = makeHarness(makeSettings({ enabled: false }))
    const result = createNotificationDeliveryService(harness.deps).dispatch(makeRequest())

    expect(harness.setTrayAttention).toHaveBeenCalledWith(true)
    expect(result).toEqual({ delivered: false, reason: 'disabled' })
    expect(harness.deliverNative).not.toHaveBeenCalled()
    expect(harness.order[0]).toBe('tray')
  })

  it('leaves the tray dot alone while the window is visible', () => {
    const harness = makeHarness(makeSettings(), true)
    createNotificationDeliveryService(harness.deps).dispatch(makeRequest())
    expect(harness.setTrayAttention).not.toHaveBeenCalled()
  })

  it('fans out to mobile before the desktop-disabled early return', () => {
    const harness = makeHarness(makeSettings({ agentTaskComplete: false }))
    const result = createNotificationDeliveryService(harness.deps).dispatch(makeRequest())

    expect(result).toEqual({ delivered: false, reason: 'source-disabled' })
    expect(harness.dispatchMobileNotification).toHaveBeenCalledWith(
      expect.objectContaining({ desktopAllowed: false, source: 'agent-task-complete' })
    )
    expect(harness.order).toEqual(['tray', 'mobile'])
  })

  it('keeps the desktop source gates distinct per source', () => {
    const harness = makeHarness(makeSettings({ terminalBell: false }))
    const service = createNotificationDeliveryService(harness.deps)
    expect(service.dispatch(makeRequest({ source: 'terminal-bell' }))).toEqual({
      delivered: false,
      reason: 'source-disabled'
    })
    expect(service.dispatch(makeRequest({ worktreeId: 'wt-2', worktreeLabel: 'wt-2' }))).toEqual({
      delivered: true
    })
  })

  it('skips the desktop banner for a muted machine but still reaches the phone', () => {
    const harness = makeHarness(makeSettings({ mutedNotificationSourceIds: ['runtime:m4air'] }))
    const service = createNotificationDeliveryService(harness.deps)

    expect(service.dispatch(makeRequest({ notificationSourceId: 'runtime:m4air' }))).toEqual({
      delivered: false,
      reason: 'host-muted'
    })
    expect(harness.dispatchMobileNotification).toHaveBeenCalledWith(
      expect.not.objectContaining({ desktopAllowed: false })
    )
    expect(harness.deliverNative).not.toHaveBeenCalled()

    // Other machines, and requests whose machine is unknown, still notify.
    expect(
      service.dispatch(
        makeRequest({ notificationSourceId: 'local', worktreeId: 'wt-2', worktreeLabel: 'wt-2' })
      )
    ).toEqual({ delivered: true })
    expect(service.dispatch(makeRequest({ worktreeId: 'wt-3', worktreeLabel: 'wt-3' }))).toEqual({
      delivered: true
    })
  })

  it('reports the master switch over a muted machine', () => {
    const harness = makeHarness(
      makeSettings({ enabled: false, mutedNotificationSourceIds: ['runtime:m4air'] })
    )
    expect(
      createNotificationDeliveryService(harness.deps).dispatch(
        makeRequest({ notificationSourceId: 'runtime:m4air' })
      )
    ).toEqual({ delivered: false, reason: 'disabled' })
  })

  it('suppresses a focused active workspace without touching mobile delivery', () => {
    const harness = makeHarness(makeSettings({ suppressWhenFocused: true }))
    const focusedWindow = makeFocusedWindowStub()
    harness.deps.findActiveWindow = () => focusedWindow
    const result = createNotificationDeliveryService(harness.deps).dispatch(
      makeRequest({ isActiveWorktree: true })
    )

    expect(result).toEqual({ delivered: false, reason: 'suppressed-focus' })
    expect(harness.dispatchMobileNotification).toHaveBeenCalledTimes(1)
  })

  it('dedupes desktop bursts per workspace but still reports the first delivery', () => {
    const harness = makeHarness(makeSettings())
    const service = createNotificationDeliveryService(harness.deps)
    expect(service.dispatch(makeRequest())).toEqual({ delivered: true })
    expect(service.dispatch(makeRequest({ source: 'terminal-bell' }))).toEqual({
      delivered: false,
      reason: 'cooldown'
    })
  })

  it('skips mobile fan-out entirely when no runtime is paired', () => {
    const harness = makeHarness(makeSettings())
    harness.deps.dispatchMobileNotification = null
    expect(createNotificationDeliveryService(harness.deps).dispatch(makeRequest())).toEqual({
      delivered: true
    })
    expect(harness.dispatchMobileNotification).not.toHaveBeenCalled()
  })

  it('reports blocked-by-system on macOS when permission is undecided', async () => {
    const harness = makeHarness(makeSettings())
    harness.deps.platform = 'darwin'
    harness.deps.readAuthorizationStatus = () => Promise.resolve('not-determined')
    await expect(
      createNotificationDeliveryService(harness.deps).dispatch(makeRequest())
    ).resolves.toEqual({ delivered: false, reason: 'blocked-by-system' })
    expect(harness.deliverNative).not.toHaveBeenCalled()
  })
})

it.each<Partial<NotificationSettings>>([{}, { enabled: false }, { agentTaskComplete: false }])(
  'preserves mobile content and Hive account push authority when a machine is muted (%j)',
  async (overrides) => {
    const events: Parameters<
      NonNullable<NotificationDeliveryDependencies['dispatchMobileNotification']>
    >[0][] = []
    for (const muted of [false, true]) {
      const fetchImpl = vi.fn(
        async () =>
          new Response(JSON.stringify({ accepted: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
      )
      const controller = new RuntimeMobileNotificationController()
      const push = new HiveMobilePushClient({
        apiBaseUrl: 'https://owned-hive.test',
        getRuntimeId: () => '11111111-1111-4111-8111-111111111111',
        getAuthorization: () => ({
          accessToken: 'test-account-access',
          accountId: 'fixture-account',
          authorityId: 'fixture-authority',
          sessionExpiresAt: now + 60000,
          sessionGeneration: 1
        }),
        fetchImpl
      })
      controller.setRemotePushSink(push)
      const harness = makeHarness(
        makeSettings({ ...overrides, mutedNotificationSourceIds: muted ? ['runtime:qa'] : [] })
      )
      harness.deps.dispatchMobileNotification = (event) => {
        events.push(event)
        controller.dispatch(event)
      }
      createNotificationDeliveryService(harness.deps).dispatch(
        makeRequest({ notificationSourceId: 'runtime:qa', agentState: 'done' })
      )
      // Desktop preferences do not authorize or suppress the account-owned phone push.
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
      controller.setRemotePushSink(
        new HiveMobilePushClient({
          apiBaseUrl: 'https://owned-hive.test',
          getAuthorization: () => null,
          getRuntimeId: () => '11111111-1111-4111-8111-111111111111',
          fetchImpl
        })
      )
      await expect(controller.testRemotePush()).resolves.toEqual({
        accepted: false,
        reason: 'unavailable'
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
    expect(events[1]).toEqual(events[0])
  }
)

it('changing a machine mute preserves mobile cooldown and does not reserve desktop cooldown', () => {
  const settings = makeSettings({ mutedNotificationSourceIds: ['runtime:qa'] })
  const harness = makeHarness(settings)
  const service = createNotificationDeliveryService(harness.deps)
  const request = makeRequest({ notificationSourceId: 'runtime:qa' })
  expect(service.dispatch(request)).toEqual({ delivered: false, reason: 'host-muted' })
  settings.mutedNotificationSourceIds = []
  expect(service.dispatch(request)).toEqual({ delivered: true })
  expect(harness.dispatchMobileNotification).toHaveBeenCalledTimes(1)
})

it('reports a muted host before a disabled source', () => {
  const harness = makeHarness(
    makeSettings({ agentTaskComplete: false, mutedNotificationSourceIds: ['runtime:qa'] })
  )
  expect(
    createNotificationDeliveryService(harness.deps).dispatch(
      makeRequest({ notificationSourceId: 'runtime:qa' })
    )
  ).toEqual({ delivered: false, reason: 'host-muted' })
})
