// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseDetectedAgentsResult } from '@/hooks/useDetectedAgents'
import { OrchestrationSkillAgentCoverage } from './OrchestrationSkillAgentCoverage'

const useDetectedAgents = vi.fn<() => UseDetectedAgentsResult>(() => ({
  detectedIds: ['claude', 'codex'],
  isLoading: false,
  detectionFailed: false,
  isRefreshing: false,
  refresh: vi.fn()
}))

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: (...args: unknown[]) => useDetectedAgents(...(args as []))
}))

describe('OrchestrationSkillAgentCoverage', () => {
  beforeEach(() => {
    useDetectedAgents.mockReset().mockReturnValue({
      detectedIds: ['claude', 'codex'],
      isLoading: false,
      detectionFailed: false,
      isRefreshing: false,
      refresh: vi.fn()
    })
  })
  afterEach(cleanup)

  it('shows a compact count with expandable agent details only for comparable scopes', () => {
    const view = render(
      <OrchestrationSkillAgentCoverage loading={false} skills={[]} sources={[]} collapsible />
    )
    expect(screen.getByText('0 of 2 detected agents found the orchestration skill.')).toBeTruthy()
    expect(screen.queryByText('Claude')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /View details/ }))
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('Codex')).toBeTruthy()

    view.rerender(
      <OrchestrationSkillAgentCoverage
        loading={false}
        skills={[]}
        sources={[]}
        collapsible
        comparable={false}
      />
    )
    expect(screen.getByText(/different runtime scopes/)).toBeTruthy()
    expect(screen.queryByText('0 of 2 detected agents found the orchestration skill.')).toBeNull()
  })

  it('offers retry immediately when compact coverage detection fails', () => {
    const refresh = vi.fn().mockResolvedValue([])
    useDetectedAgents.mockReturnValue({
      detectedIds: null,
      isLoading: false,
      detectionFailed: true,
      isRefreshing: false,
      refresh
    })
    render(<OrchestrationSkillAgentCoverage loading={false} skills={[]} sources={[]} collapsible />)
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t detect installed agents')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not count agents as missing when skill discovery fails', () => {
    const recheck = vi.fn().mockResolvedValue(false)
    render(
      <OrchestrationSkillAgentCoverage
        loading={false}
        discoveryError="The skill source could not be scanned"
        onSkillRecheck={recheck}
        skills={[]}
        sources={[]}
        collapsible
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('agent coverage is unavailable')
    expect(screen.queryByText(/0 of 2 detected agents/)).toBeNull()
    expect(screen.queryByText('Not found')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }))
    expect(recheck).toHaveBeenCalledTimes(1)
  })

  it('shows a failed first probe with a retry and recovers through loading to an empty result', () => {
    const refresh = vi.fn().mockResolvedValue([])
    const failed: UseDetectedAgentsResult = {
      detectedIds: null,
      isLoading: false,
      detectionFailed: true,
      isRefreshing: false,
      refresh
    }
    useDetectedAgents.mockReturnValue(failed)
    const view = render(
      <OrchestrationSkillAgentCoverage loading={false} skills={[]} sources={[]} />
    )
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t detect installed agents')
    expect(screen.queryByText('Checking installed agents and skill paths…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledTimes(1)

    useDetectedAgents.mockReturnValue({ ...failed, detectionFailed: false, isRefreshing: true })
    view.rerender(<OrchestrationSkillAgentCoverage loading={false} skills={[]} sources={[]} />)
    expect(screen.getByText('Checking installed agents and skill paths…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

    useDetectedAgents.mockReturnValue({
      ...failed,
      detectedIds: [],
      detectionFailed: false
    })
    view.rerender(<OrchestrationSkillAgentCoverage loading={false} skills={[]} sources={[]} />)
    expect(screen.getByText(/No agent CLIs detected on PATH/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Checking installed agents and skill paths…')).toBeNull()
  })

  it('keeps verified agent chips visible when a refresh fails', () => {
    useDetectedAgents.mockReturnValue({
      detectedIds: ['claude'],
      isLoading: false,
      detectionFailed: true,
      isRefreshing: false,
      refresh: vi.fn()
    })
    render(<OrchestrationSkillAgentCoverage loading={false} skills={[]} sources={[]} />)
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t detect installed agents')
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.queryByText('Checking installed agents and skill paths…')).toBeNull()
  })

  it('shows each detected agent with an explicit skill status', () => {
    const markup = renderToStaticMarkup(
      <OrchestrationSkillAgentCoverage
        loading={false}
        sources={[
          {
            id: 'claude-home',
            label: 'Claude home',
            path: '/Users/test/.claude/skills',
            sourceKind: 'home',
            providers: ['claude'],
            owner: 'claude',
            exists: true
          }
        ]}
        skills={[
          {
            id: 'claude-skill',
            name: 'orchestration',
            description: null,
            providers: ['claude'],
            sourceKind: 'home',
            sourceLabel: 'Claude home',
            rootPath: '/Users/test/.claude/skills',
            directoryPath: '/Users/test/.claude/skills/orchestration',
            skillFilePath: '/Users/test/.claude/skills/orchestration/SKILL.md',
            installed: true,
            updatedAt: null
          }
        ]}
      />
    )

    expect(markup).toContain('Claude')
    expect(markup).toContain('Codex')
    expect(markup).toContain('Ready')
    expect(markup).toContain('Missing')
    expect(markup).not.toContain('View details')
    // Why: an omitted target reads as "host unknown", which pins detectedIds to
    // null and leaves the widget spinning forever.
    expect(useDetectedAgents).toHaveBeenCalledWith({ kind: 'local' })
  })
})
