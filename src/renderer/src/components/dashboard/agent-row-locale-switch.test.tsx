// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { CompactAgentRow } from '@/components/sidebar/worktree-card-compact-agent-row'
import { AgentStateDot } from '@/components/AgentStateDot'
import { CompactAgentSummaryButton } from '@/components/sidebar/worktree-card-compact-agents'
import { DetachedHeadBadge } from '@/components/DetachedHeadBadge'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { TooltipProvider } from '@/components/ui/tooltip'
import DashboardAgentRow from './DashboardAgentRow'
import type { DashboardAgentRow as Agent } from './useDashboardData'

vi.mock('./use-agent-row-conversation-name', () => ({ useAgentRowConversationName: () => null }))
vi.mock('@/components/sidebar/CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null
}))

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('mounted agent locale changes', () => {
  it('updates memoized rows and state indicators without changing props or timestamps', async () => {
    await i18n.changeLanguage('en')
    const now = 3_600_000
    const agent = {
      paneKey: 'tab:leaf',
      tab: { id: 'tab' },
      agentType: 'codex',
      state: 'unverifiable',
      startedAt: now - 60_000,
      entry: {
        paneKey: 'tab:leaf',
        state: 'working',
        updatedAt: now - 34 * 60_000,
        evidenceObservedAt: now - 34 * 60_000,
        agentType: 'codex',
        prompt: 'Fix a bug'
      },
      lineage: { depth: 0, childCount: 2 }
    } as unknown as Agent
    const onActivate = vi.fn(),
      onToggle = vi.fn()
    const detached = getWorktreeGitIdentityDisplay({ head: 'abcdef12345' })!
    render(
      <TooltipProvider>
        <DashboardAgentRow
          agent={agent}
          now={now}
          onActivate={onActivate}
          onDismiss={vi.fn()}
          childAgentCount={2}
          childAgentsExpanded={false}
          onToggleChildAgents={onToggle}
        />
        <CompactAgentRow
          agent={agent}
          now={now}
          onActivate={onActivate}
          childAgentCount={2}
          childAgentsExpanded={false}
          onToggleChildAgents={onToggle}
        />
        <AgentStateDot state="done" />
        <CompactAgentSummaryButton
          agents={[agent]}
          subjectLabel="Codex"
          expanded={false}
          onToggle={onToggle}
        />
        {detached.kind === 'detached' && <DetachedHeadBadge display={detached} />}
      </TooltipProvider>
    )
    expect(screen.getAllByRole('button', { name: 'Show 2 child agents' })).toHaveLength(2)
    expect(screen.getAllByText(/No update in 34m/)).toHaveLength(2)
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: '显示 2 个子智能体' })).toHaveLength(2)
    )
    expect(screen.getAllByText(/34分钟内无更新/)).toHaveLength(2)
    expect(document.querySelector('[aria-label="Done"]')).toBeNull()
    const row = document.querySelector('.worktree-agent-lineage-parent-row')
    expect(row?.getAttribute('title')).not.toMatch(/started|done/)
    expect(document.querySelector('[title="Codex - 已派遣 2 个智能体"]')).not.toBeNull()
    expect(document.querySelector('[aria-label^="展开Codex暂无上报"]')).not.toBeNull()
    expect(screen.getByText('分离的 HEAD · abcdef1')).toBeTruthy()
    expect(
      document.querySelector('[aria-label="HEAD 已分离至 abcdef1。当前查看的是提交，而非分支。"]')
    ).not.toBeNull()
  })
})
