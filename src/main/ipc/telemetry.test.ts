// Telemetry IPC boundary tests: the renderer is in the threat model, so handlers drop malformed calls, cap consent mutations, and derive `via` main-side.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Store } from '../persistence'

const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
const {
  handleMock,
  trackMock,
  setOptInMock,
  persistBannerAcknowledgeMock,
  consumeConsentMutationTokenMock,
  getCohortAtEmitMock,
  fromWebContentsMock,
  hasTrackedDashboardMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  trackMock: vi.fn(),
  setOptInMock: vi.fn(),
  persistBannerAcknowledgeMock: vi.fn(),
  consumeConsentMutationTokenMock: vi.fn(),
  getCohortAtEmitMock: vi.fn(),
  fromWebContentsMock: vi.fn(),
  hasTrackedDashboardMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { fromWebContents: fromWebContentsMock }
}))
vi.mock('../telemetry/client', () => ({
  track: trackMock,
  setOptIn: setOptInMock,
  persistBannerAcknowledgeWithoutEmitting: persistBannerAcknowledgeMock,
  hasTrackedAgentDashboardActiveToday: hasTrackedDashboardMock
}))
vi.mock('../telemetry/burst-cap', () => ({
  consumeConsentMutationToken: consumeConsentMutationTokenMock
}))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

import { _resetStoreForTests, registerTelemetryHandlers } from './telemetry'

function captureHandlers(): void {
  handlers.clear()
  for (const call of handleMock.mock.calls) {
    const [channel, handler] = call as [
      string,
      typeof handlers extends Map<string, infer V> ? V : never
    ]
    handlers.set(channel, handler)
  }
}

// Fake Store whose `telemetry` block tests reassign between invocations to seed derivation states.
type FakeStoreState = { settings: GlobalSettings }
function makeFakeStore(telemetry: GlobalSettings['telemetry']): {
  store: Store
  state: FakeStoreState
} {
  const state: FakeStoreState = { settings: { telemetry } as unknown as GlobalSettings }
  const store = {
    getSettings: vi.fn(() => state.settings),
    updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
      state.settings = { ...state.settings, ...updates } as GlobalSettings
      return state.settings
    })
  } as unknown as Store
  return { store, state }
}

function registerWith(telemetry: GlobalSettings['telemetry']): FakeStoreState {
  const { store, state } = makeFakeStore(telemetry)
  registerTelemetryHandlers(store)
  captureHandlers()
  return state
}

describe('telemetry IPC handlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    trackMock.mockReset()
    trackMock.mockReturnValue(true)
    hasTrackedDashboardMock.mockReset().mockReturnValue(false)
    fromWebContentsMock.mockReset().mockReturnValue({
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false
    })
    setOptInMock.mockReset()
    persistBannerAcknowledgeMock.mockReset()
    consumeConsentMutationTokenMock.mockReset()
    consumeConsentMutationTokenMock.mockReturnValue(true)
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 0 })
    _resetStoreForTests()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers all four channels', () => {
    registerWith({
      installId: 'x',
      optedIn: true
    })
    expect(handlers.has('telemetry:track')).toBe(true)
    expect(handlers.has('telemetry:setOptIn')).toBe(true)
    expect(handlers.has('telemetry:acknowledgeBanner')).toBe(true)
    expect(handlers.has('telemetry:getConsentState')).toBe(true)
  })

  // ── telemetry:track ──────────────────────────────────────────────────

  it.each(['missing', 'destroyed', 'hidden', 'minimized'])(
    'rejects Dashboard activity from a %s window',
    (state) => {
      registerWith({ installId: 'x', optedIn: true })
      fromWebContentsMock.mockReturnValue(
        state === 'missing'
          ? null
          : {
              isDestroyed: () => state === 'destroyed',
              isVisible: () => state !== 'hidden',
              isMinimized: () => state === 'minimized'
            }
      )
      expect(
        handlers.get('telemetry:track')!({ sender: {} }, 'agent_dashboard_active', {
          surface: 'in_window'
        })
      ).toBe(false)
      expect(trackMock).not.toHaveBeenCalled()
    }
  )

  it('acknowledges accepted or already-counted Dashboard activity only', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:track')!
    const props = { surface: 'in_window' }
    expect(handler({ sender: {} }, 'agent_dashboard_active', props)).toBe(true)
    trackMock.mockReturnValue(false)
    expect(handler({ sender: {} }, 'agent_dashboard_active', props)).toBe(false)
    hasTrackedDashboardMock.mockReturnValue(true)
    expect(handler({ sender: {} }, 'agent_dashboard_active', props)).toBe(true)
    expect(hasTrackedDashboardMock).toHaveBeenCalledWith(props)
  })

  it('forwards a well-typed track call to track() and injects cohort for COHORT_EXTENDED events', () => {
    registerWith({ installId: 'x', optedIn: true })
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', {})
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith('app_opened', { nth_repo_added: 2 })
  })

  // Schemas are `.strict()`, so injecting `nth_repo_added` on a non-cohort event would drop the whole event at the validator.
  it('does NOT inject cohort on events outside COHORT_EXTENDED', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'settings_changed', { setting_key: 'editorAutoSave', value_kind: 'bool' })
    expect(trackMock).toHaveBeenCalledTimes(1)
    expect(trackMock).toHaveBeenCalledWith('settings_changed', {
      setting_key: 'editorAutoSave',
      value_kind: 'bool'
    })
    expect(getCohortAtEmitMock).not.toHaveBeenCalled()
  })

  // Renderer-only Setup-step events depend on the handler injecting cohort so call sites stay synchronous.
  it('injects cohort for add_repo_setup_step_action (renderer-only event)', () => {
    registerWith({ installId: 'x', optedIn: true })
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 1 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'add_repo_setup_step_action', { action: 'skip' })
    expect(trackMock).toHaveBeenCalledWith('add_repo_setup_step_action', {
      action: 'skip',
      nth_repo_added: 1
    })
  })

  it('drops main-owned events from renderer telemetry IPC', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_starred_orca', { source: 'settings' })
    handler({}, 'star_nag_outcome', {
      outcome: 'shown',
      source: 'threshold',
      mode: 'gh',
      threshold: 35,
      agents_since_baseline: 35,
      agents_since_baseline_bucket: '35-69'
    })
    handler({}, 'feature_interaction_usage_bucket_reached', {
      feature_id: 'tasks',
      feature_category: 'task_management',
      count_bucket: 'count_1',
      bucket_source: 'crossed_now'
    })
    handler({}, 'daemon_audit_eligibility', {})
    handler({}, 'agent_token_usage', {})
    expect(trackMock).not.toHaveBeenCalled()
    expect(getCohortAtEmitMock).not.toHaveBeenCalled()
  })

  it('injects cohort for setup script prompt events', () => {
    registerWith({ installId: 'x', optedIn: true })
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 3 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'setup_script_prompt_shown', {
      mode: 'import_available',
      provider: 'codex',
      file_count_bucket: '1',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: false
    })
    handler({}, 'setup_script_prompt_action', {
      action: 'configure_clicked',
      mode: 'configure_needed',
      file_count_bucket: '0',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: true
    })
    expect(trackMock).toHaveBeenCalledWith('setup_script_prompt_shown', {
      mode: 'import_available',
      provider: 'codex',
      file_count_bucket: '1',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: false,
      nth_repo_added: 3
    })
    expect(trackMock).toHaveBeenCalledWith('setup_script_prompt_action', {
      action: 'configure_clicked',
      mode: 'configure_needed',
      file_count_bucket: '0',
      unsupported_field_count_bucket: '0',
      has_shared_hooks: true,
      nth_repo_added: 3
    })
  })

  // Fail-soft: `nth_repo_added` is optional, so an undefined cohort still validates.
  it('forwards undefined cohort when the classifier returns undefined', () => {
    registerWith({ installId: 'x', optedIn: true })
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: undefined })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', {})
    expect(trackMock).toHaveBeenCalledWith('app_opened', { nth_repo_added: undefined })
  })

  // Security: same spread-order invariant as cohort — main-derived `nth_repo_added` overrides any renderer-forged value.
  it('main-derived nth_repo_added overrides renderer-supplied value', () => {
    registerWith({ installId: 'x', optedIn: true })
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', { nth_repo_added: 99 })
    expect(trackMock).toHaveBeenCalledWith('app_opened', { nth_repo_added: 2 })
  })

  it('forwards current onboarding data without historical installation claims', () => {
    registerWith({ installId: 'x', optedIn: true })
    handlers.get('telemetry:track')!({}, 'onboarding_step_viewed', { step: 1, value_kind: 'agent' })
    expect(trackMock).toHaveBeenCalledWith('onboarding_step_viewed', {
      step: 1,
      value_kind: 'agent'
    })
  })

  it.each(['fresh_install', 'upgrade_backfill'])(
    'discards renderer-supplied installation cohort %s',
    (cohort) => {
      registerWith({ installId: 'x', optedIn: true })
      handlers.get('telemetry:track')!({}, 'onboarding_started', { cohort })
      expect(trackMock).toHaveBeenCalledWith('onboarding_started', {})
    }
  )

  it.each([{ props: [] }, { props: new Date(0) }])(
    'preserves malformed props for the runtime validator: %j',
    ({ props }) => {
      registerWith({ installId: 'x', optedIn: true })
      handlers.get('telemetry:track')!({}, 'onboarding_started', props)
      expect(trackMock).toHaveBeenCalledWith('onboarding_started', props)
    }
  )

  it('drops track calls with a non-string name', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:track')!
    handler({}, 42, {})
    handler({}, null, {})
    handler({}, { event: 'app_opened' }, {})
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('drops track calls with non-object props', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', 'string-not-object')
    handler({}, 'app_opened', 42)
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('treats null/undefined props as an empty object', () => {
    registerWith({ installId: 'x', optedIn: true })
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 0 })
    const handler = handlers.get('telemetry:track')!
    handler({}, 'app_opened', null)
    handler({}, 'app_opened', undefined)
    expect(trackMock).toHaveBeenCalledTimes(2)
    expect(trackMock).toHaveBeenNthCalledWith(1, 'app_opened', { nth_repo_added: 0 })
    expect(trackMock).toHaveBeenNthCalledWith(2, 'app_opened', { nth_repo_added: 0 })
  })

  // ── telemetry:setOptIn — input narrowing ─────────────────────────────

  it('drops setOptIn with non-boolean optedIn', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, 'true')
    handler({}, 1)
    handler({}, null)
    handler({}, undefined)
    expect(setOptInMock).not.toHaveBeenCalled()
    // None of these should have consumed a mutation token either.
    expect(consumeConsentMutationTokenMock).not.toHaveBeenCalled()
  })

  it('drops setOptIn past the consent-mutation rate limit', () => {
    registerWith({ installId: 'x', optedIn: true })
    const handler = handlers.get('telemetry:setOptIn')!
    consumeConsentMutationTokenMock.mockReturnValue(false)
    handler({}, true)
    expect(setOptInMock).not.toHaveBeenCalled()
  })

  // ── telemetry:setOptIn — `via` derivation ────────────────────────────

  it("derives via='first_launch_banner' for an existing user with optedIn=null clicking Turn off", () => {
    // Only path where an existing user (optedIn=null) flips to false: the notice's "Turn off" button.
    registerWith({
      installId: 'x',
      optedIn: null
    })
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, false)
    expect(setOptInMock).toHaveBeenCalledWith('first_launch_banner', false)
  })

  it("derives via='settings' (not 'first_launch_banner') for a defensive opt-in call from the pre-notice state", () => {
    // Security: refuse via='first_launch_banner' on a forged setOptIn(true) pre-notice; fall through to 'settings'.
    registerWith({
      installId: 'x',
      optedIn: null
    })
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, true)
    expect(setOptInMock).toHaveBeenCalledWith('settings', true)
  })

  it("derives via='settings' for a new user toggling off from Settings (no first-launch surface exists)", () => {
    // New users (existed=false) see no first-launch surface, so any opt-out routes through Settings.
    registerWith({
      installId: 'x',
      optedIn: true
    })
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, false)
    expect(setOptInMock).toHaveBeenCalledWith('settings', false)
  })

  it("derives via='settings' for an opt-in toggle flip after a prior opt-out", () => {
    // Re-opt-in from Settings: neither cohort marker nor notice state triggers a first-launch tag.
    registerWith({
      installId: 'x',
      optedIn: false
    })
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, true)
    expect(setOptInMock).toHaveBeenCalledWith('settings', true)
  })

  it("derives via='settings' for a new user flipping Settings off→on (not a first-launch interaction)", () => {
    registerWith({
      installId: 'x',
      optedIn: false
    })
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, true)
    expect(setOptInMock).toHaveBeenCalledWith('settings', true)
  })

  it("derives via='settings' when the telemetry block is missing (defensive)", () => {
    // Should never happen post-migration; handler must fall through to 'settings', not throw.
    registerWith(undefined)
    const handler = handlers.get('telemetry:setOptIn')!
    handler({}, true)
    expect(setOptInMock).toHaveBeenCalledWith('settings', true)
  })

  // ── telemetry:acknowledgeBanner — silent-persist path ────────────────

  it('routes banner ✕ through persistBannerAcknowledgeWithoutEmitting without invoking setOptIn', () => {
    // Why the separate channel: reaching setOptIn would derive a `via` and fire `telemetry_opted_in`; acknowledge must persist silently.
    registerWith({
      installId: 'x',
      optedIn: null
    })
    const handler = handlers.get('telemetry:acknowledgeBanner')!
    handler({})
    expect(persistBannerAcknowledgeMock).toHaveBeenCalledTimes(1)
    expect(setOptInMock).not.toHaveBeenCalled()
    expect(trackMock).not.toHaveBeenCalled()
  })

  it('acknowledgeBanner consumes a consent-mutation token and drops past the cap', () => {
    registerWith({
      installId: 'x',
      optedIn: null
    })
    const handler = handlers.get('telemetry:acknowledgeBanner')!
    consumeConsentMutationTokenMock.mockReturnValue(false)
    handler({})
    expect(persistBannerAcknowledgeMock).not.toHaveBeenCalled()
  })

  // ── telemetry:acknowledgeBanner — state-precondition guard ───────────
  // Security: guard passes only (existed=true, optedIn=null) and runs before token consumption, blocking a compromised renderer from flipping resolved consent.

  it('acknowledgeBanner rejects an existing user who already opted in', () => {
    registerWith({
      installId: 'x',
      optedIn: true
    })
    const handler = handlers.get('telemetry:acknowledgeBanner')!
    handler({})
    expect(persistBannerAcknowledgeMock).not.toHaveBeenCalled()
    expect(consumeConsentMutationTokenMock).not.toHaveBeenCalled()
  })

  it('acknowledgeBanner rejects an existing user who already opted out', () => {
    registerWith({
      installId: 'x',
      optedIn: false
    })
    const handler = handlers.get('telemetry:acknowledgeBanner')!
    handler({})
    expect(persistBannerAcknowledgeMock).not.toHaveBeenCalled()
    expect(consumeConsentMutationTokenMock).not.toHaveBeenCalled()
  })

  it('acknowledgeBanner rejects the new-user cohort regardless of optedIn', () => {
    registerWith({
      installId: 'x',
      optedIn: true
    })
    const handler = handlers.get('telemetry:acknowledgeBanner')!
    handler({})
    expect(persistBannerAcknowledgeMock).not.toHaveBeenCalled()
    expect(consumeConsentMutationTokenMock).not.toHaveBeenCalled()
  })

  it('acknowledgeBanner rejects a missing telemetry block', () => {
    registerWith(undefined)
    const handler = handlers.get('telemetry:acknowledgeBanner')!
    handler({})
    expect(persistBannerAcknowledgeMock).not.toHaveBeenCalled()
    expect(consumeConsentMutationTokenMock).not.toHaveBeenCalled()
  })
})
