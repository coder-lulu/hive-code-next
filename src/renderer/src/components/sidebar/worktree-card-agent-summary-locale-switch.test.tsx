// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { i18n, translate } from '@/i18n/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DashboardAgentRow as Agent } from '@/components/dashboard/useDashboardData'
import WorktreeCardAgents from './WorktreeCardAgents'

vi.mock('@/store', () => {
  const state = {
    agentActivityDisplayMode: 'compact',
    acknowledgedAgentsByPaneKey: {},
    agentSendPopoverTargetMode: null,
    agentStatusByPaneKey: {},
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    settings: {},
    cacheTimerByKey: {}
  }
  return {
    useAppStore: Object.assign((selector: (value: unknown) => unknown) => selector(state), {
      getState: () => state
    })
  }
})
vi.mock('@/hooks/use-now', () => ({ useNow: () => 2000 }))
vi.mock('./useWorktreeAgentRows', () => ({ useWorktreeAgentRows: () => [] }))
vi.mock('./focused-agent-row-highlight', () => ({ useFocusedAgentPaneKey: () => null }))

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

it('refreshes the memoized agent count and summary when switching all six languages with unchanged props', async () => {
  await i18n.changeLanguage('en')
  const agents = ['codex', 'claude'].map((agentType, index) => ({
    paneKey: `tab:${index}`,
    tab: { id: 'tab' },
    agentType,
    state: 'done',
    entry: { state: 'done', stateStartedAt: 1000 }
  })) as Agent[]
  render(
    <TooltipProvider>
      <WorktreeCardAgents worktreeId="wt" agents={agents} />
    </TooltipProvider>
  )
  expect(screen.getByRole('button', { name: /Expand All 2 agents done/ })).toBeTruthy()
  for (const locale of ['es', 'fr', 'ja', 'ko', 'zh', 'en']) {
    await act(async () => {
      await i18n.changeLanguage(locale)
    })
    const button = screen.getByRole('button')
    const subject = translate(
      'components.native-chat.backgroundTasks.countAgentsMany',
      '{{value0}} agents',
      { value0: 2 }
    )
    expect(button.getAttribute('aria-label')).toContain(subject)
    if (locale !== 'en') {
      expect(button.getAttribute('aria-label')).not.toMatch(
        /All 2 agents done|Codex done|Claude done/
      )
    }
  }
})
