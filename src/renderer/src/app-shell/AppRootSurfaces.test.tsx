// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../shared/update-status-types'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  signoutCard: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))
vi.mock('@/lib/lazy-with-retry', async () => ({
  lazyWithRetry: (await import('react')).lazy
}))
vi.mock('../components/error-boundaries/RecoverableRenderErrorBoundary', () => ({
  RecoverableRenderErrorBoundary: ({ children }: { children: ReactNode }) => children
}))
vi.mock('../components/NewWorkspaceComposerModal', () => ({ default: () => null }))
vi.mock('../components/crash-report/CrashReportDialog', () => ({ CrashReportDialog: () => null }))
vi.mock('../components/editor/MarkdownTemplatePicker', () => ({
  MarkdownTemplatePicker: () => null
}))
vi.mock('../components/tab-bar/RecentTabSwitcher', () => ({ default: () => null }))
vi.mock('../components/skills/SkillFreshnessUpdateDialog', () => ({
  SkillFreshnessUpdateDialog: () => null
}))
vi.mock('../components/star-nag/StarNagAgentValueMomentObserver', () => ({
  StarNagAgentValueMomentObserver: () => null
}))
vi.mock('../components/star-nag/StarNagToastHost', () => ({ StarNagToastHost: () => null }))
vi.mock('../components/TelemetryFirstLaunchSurface', () => ({
  TelemetryFirstLaunchSurface: () => null
}))
vi.mock('../components/ZoomOverlay', () => ({ ZoomOverlay: () => null }))
vi.mock('../components/settings/RemoteServerUpdateDialog', () => ({ default: () => null }))
vi.mock('../components/StarNagCard', () => ({
  StarNagCard: () => <div data-testid="star-card" />
}))
vi.mock('../components/UpdateCard', () => ({
  UpdateCard: () => <div data-testid="update-card" />
}))
vi.mock('../components/UnexpectedSignoutCard', () => ({
  UnexpectedSignoutCard: () => {
    mocks.signoutCard()
    return <div data-testid="orca-signout-card" />
  }
}))

import { AppRootSurfaces } from './AppRootSurfaces'

const props = {
  floatingWorkspace: { shouldMountPanel: false },
  onboardingGate: { onboarding: null, shouldRender: false }
} as Parameters<typeof AppRootSurfaces>[0]

beforeEach(() => {
  mocks.signoutCard.mockClear()
  mocks.state = {
    activeView: 'sessions',
    activeModal: null,
    settings: null,
    statusBarVisible: false,
    persistedUIReady: false,
    petVisible: false,
    dictationState: 'idle',
    updateStatus: { state: 'idle' },
    activeContextualTourId: null,
    sshCredentialQueue: [],
    orcaProfileAuthStatus: {
      configured: true,
      state: 'reconnect-required',
      cloud: { profileId: 'old-orca-profile' }
    }
  }
})

afterEach(cleanup)

async function renderStatus(updateStatus: UpdateStatus): Promise<void> {
  mocks.state.updateStatus = updateStatus
  await act(async () => {
    render(<AppRootSurfaces {...props} />)
  })
}

describe('AppRootSurfaces notification ownership', () => {
  it('stacks ordinary updates with the other notification cards', async () => {
    await renderStatus({ state: 'available', version: '1.5.0', changelog: null })

    const updateCard = await screen.findByTestId('update-card')
    const stack = screen.getByTestId('star-card').parentElement
    expect(stack?.contains(updateCard)).toBe(true)
  })

  it('keeps mandatory updates outside the notification stacking context', async () => {
    await renderStatus({ state: 'available', version: '1.5.0', changelog: null, mandatory: true })

    const updateCard = await screen.findByTestId('update-card')
    const stack = screen.getByTestId('star-card').parentElement
    expect(stack?.contains(updateCard)).toBe(false)
    expect(screen.getAllByTestId('update-card')).toHaveLength(1)
  })

  it('does not mount an Orca profile reconnect prompt in the Hive account shell', async () => {
    await renderStatus({ state: 'idle' })

    expect(screen.queryByTestId('orca-signout-card')).toBeNull()
    expect(mocks.signoutCard).not.toHaveBeenCalled()
    expect(screen.queryByTestId('update-card')).toBeNull()
  })
})
