// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  closeActivityPage: vi.fn(),
  scope: 'all' as 'all' | 'temporary-sessions',
  useActivityUnreadCount: vi.fn(() => 7)
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activityPageScope: mocks.scope,
      closeActivityPage: mocks.closeActivityPage
    })
}))

vi.mock('./useActivityUnreadCount', () => ({
  useActivityUnreadCount: mocks.useActivityUnreadCount
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { ActivityTitlebarControls } from './ActivityTitlebarControls'

function renderControls(): void {
  render(
    <TooltipProvider>
      <ActivityTitlebarControls />
    </TooltipProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scope = 'all'
})

afterEach(cleanup)

describe('ActivityTitlebarControls', () => {
  it('preserves the agents titlebar and unread count for the default scope', () => {
    renderControls()

    expect(screen.getByText('agents')).toBeTruthy()
    expect(screen.getByText(/7 unread/)).toBeTruthy()
    expect(mocks.useActivityUnreadCount).toHaveBeenCalledWith(true, 'agent-events')

    fireEvent.click(screen.getByRole('button', { name: 'Close agents' }))
    expect(mocks.closeActivityPage).toHaveBeenCalledOnce()
  })

  it('shows temporary-session context without subscribing to unread activity', () => {
    mocks.scope = 'temporary-sessions'
    renderControls()

    expect(screen.getByText('Temporary sessions')).toBeTruthy()
    expect(screen.queryByText(/unread/)).toBeNull()
    expect(mocks.useActivityUnreadCount).toHaveBeenCalledWith(false, 'agent-events')

    fireEvent.click(screen.getByRole('button', { name: 'Close temporary sessions' }))
    expect(mocks.closeActivityPage).toHaveBeenCalledOnce()
  })
})
