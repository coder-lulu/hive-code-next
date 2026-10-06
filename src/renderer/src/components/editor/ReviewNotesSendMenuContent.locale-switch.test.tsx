// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n, translate } from '@/i18n/i18n'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { AppState } from '@/store/types'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ReviewNotesSendMenuContent } from './ReviewNotesSendMenuContent'

const harness = vi.hoisted(() => ({
  state: {} as AppState,
  rows: [] as DashboardAgentRow[],
  now: 0
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: AppState) => unknown) => selector(harness.state), {
    getState: () => harness.state
  })
}))
vi.mock('@/hooks/use-now', () => ({ useNow: () => harness.now }))
vi.mock('@/components/sidebar/useWorktreeAgentRows', () => ({
  useWorktreeAgentRows: () => harness.rows
}))
vi.mock('@/components/tab-bar/QuickLaunchButton', () => ({ QuickLaunchAgentMenuItems: () => null }))
vi.mock('@/lib/agent-catalog', () => ({ AgentIcon: () => null }))
vi.mock('@/lib/active-agent-note-send', () => ({
  activeAgentNotesSendFailureMessage: () => '',
  sendNotesToActiveAgentSession: vi.fn()
}))
vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({ focusTerminalTabSurface: vi.fn() }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({
    children,
    title,
    disabled
  }: React.PropsWithChildren<{
    title?: string
    disabled?: boolean
  }>) => (
    <button title={title} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  DropdownMenuSeparator: () => null
}))

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('mounted notes send menu language changes', () => {
  it.each([
    ['permission', 'waiting', 'components.agentSend.permission', 'Agent needs permission'],
    ['stale', 'working', 'components.agentSend.stale', 'Agent status is stale'],
    [
      'terminal-unavailable',
      'working',
      'components.agentSend.terminalUnavailable',
      'Terminal is no longer available'
    ],
    [
      'stale-layout-pty',
      'working',
      'components.agentSend.terminalUnavailable',
      'Terminal is no longer available'
    ]
  ] as const)(
    'refreshes %s hints with unchanged target inputs',
    async (code, state, key, fallback) => {
      await i18n.changeLanguage('en')
      const leafId = '11111111-1111-4111-8111-111111111111'
      const paneKey = makePaneKey('tab', leafId)
      harness.now = Date.now()
      const entry = {
        paneKey,
        state,
        prompt: '',
        agentType: 'codex',
        updatedAt: harness.now,
        stateStartedAt: harness.now,
        stateHistory: [],
        restoredUnconfirmed: code === 'stale'
      }
      const tab = { id: 'tab', worktreeId: 'wt', title: 'Terminal 1' }
      harness.state = {
        agentStatusEpoch: 0,
        agentStatusByPaneKey: { [paneKey]: entry },
        tabsByWorktree: { wt: [tab] },
        unifiedTabsByWorktree: {},
        terminalLayoutsByTabId: {
          tab: {
            root: { type: 'leaf', leafId },
            activeLeafId: leafId,
            expandedLeafId: null,
            ptyIdsByLeafId: code === 'terminal-unavailable' ? {} : { [leafId]: 'pty' }
          }
        },
        ptyIdsByTabId: {
          tab: code === 'terminal-unavailable' || code === 'stale-layout-pty' ? [] : ['pty']
        },
        runtimePaneTitlesByTabId: {}
      } as unknown as AppState
      harness.rows = [
        { paneKey, tab, entry, agentType: 'codex', state, startedAt: harness.now - 60_000 }
      ] as unknown as DashboardAgentRow[]
      render(
        <TooltipProvider>
          <ReviewNotesSendMenuContent worktreeId="wt" groupId="group" prompt="notes" />
        </TooltipProvider>
      )
      const button = screen.getByRole('button', { name: /Codex/ }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toBe(fallback)
      for (const locale of ['es', 'fr', 'ja', 'ko', 'zh', 'en']) {
        await act(async () => {
          await i18n.changeLanguage(locale)
        })
        expect(screen.getByRole('button', { name: /Codex/ })).toBe(button)
        expect(button.disabled).toBe(true)
        expect(button.title).toBe(translate(key, fallback))
        expect(button.textContent).toContain(
          translate('components.agentStatus.ago', '{{duration}} ago', {
            duration: translate('components.agentStatus.minutes', '{{count}}m', { count: 1 })
          })
        )
        expect(
          screen.getByText(
            translate(
              'auto.components.editor.ReviewNotesSendMenuContent.03378aea75',
              'Send notes to'
            )
          )
        ).toBeTruthy()
      }
    }
  )
})
