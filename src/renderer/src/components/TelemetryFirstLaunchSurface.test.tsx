// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelemetryFirstLaunchSurface } from './TelemetryFirstLaunchSurface'

const mocks = vi.hoisted(() => ({
  state: {
    settings: null as null | { telemetry?: { optedIn: boolean | null; installId: string } },
    fetchSettings: vi.fn()
  },
  acknowledgeBanner: vi.fn(),
  setOptIn: vi.fn()
}))
vi.mock('../store', () => ({
  useAppStore: (select: (state: typeof mocks.state) => unknown) => select(mocks.state)
}))
vi.mock('../lib/telemetry', () => ({
  PRIVACY_URL: '',
  acknowledgeBanner: mocks.acknowledgeBanner,
  setOptIn: mocks.setOptIn
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

describe('current telemetry consent surface', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.settings = { telemetry: { optedIn: null, installId: 'recorded' } }
    mocks.state.fetchSettings.mockResolvedValue(undefined)
    mocks.acknowledgeBanner.mockResolvedValue(undefined)
    mocks.setOptIn.mockResolvedValue(undefined)
  })

  it.each([true, false])(
    'keeps the explicit consent value %s without showing a notice',
    (optedIn) => {
      mocks.state.settings = { telemetry: { optedIn, installId: 'recorded' } }
      render(<TelemetryFirstLaunchSurface />)
      expect(screen.queryByRole('region', { name: 'Telemetry notice' })).toBeNull()
    }
  )

  it.each([null, {}])('waits for current settings to load: %j', (settings) => {
    mocks.state.settings = settings
    render(<TelemetryFirstLaunchSurface />)
    expect(screen.queryByRole('region', { name: 'Telemetry notice' })).toBeNull()
  })

  it.each([true, false])(
    'shows explicit unresolved consent regardless of a retired cohort value %s',
    (cohort) => {
      Reflect.set(mocks.state.settings!.telemetry!, 'existedBeforeTelemetryRelease', cohort)
      render(<TelemetryFirstLaunchSurface />)
      expect(screen.getByRole('region', { name: 'Telemetry notice' })).toBeTruthy()
    }
  )

  it('uses the main opt-out API, refetches settings, and resolves only after success', async () => {
    render(<TelemetryFirstLaunchSurface />)
    fireEvent.click(screen.getByRole('button', { name: 'Opt out' }))
    await waitFor(() => expect(mocks.setOptIn).toHaveBeenCalledExactlyOnceWith(false))
    await waitFor(() => expect(mocks.state.fetchSettings).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Telemetry notice' })).toBeNull()
    )
    expect(mocks.acknowledgeBanner).not.toHaveBeenCalled()
  })

  it('acknowledges through main and refreshes the preference before resolving', async () => {
    render(<TelemetryFirstLaunchSurface />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(mocks.acknowledgeBanner).toHaveBeenCalledOnce())
    await waitFor(() => expect(mocks.state.fetchSettings).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Telemetry notice' })).toBeNull()
    )
    expect(mocks.setOptIn).not.toHaveBeenCalled()
  })
})
