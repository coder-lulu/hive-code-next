import { describe, expect, it } from 'vitest'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import { resolveAgentStartupTabId } from './agent-startup-delayed-delivery'

describe('agent startup delayed-delivery tab resolution', () => {
  it('maps a host tab id to its paired web surface before delivering a follow-up', () => {
    const hostTabId = 'host-tab'
    const mirroredTabId = toWebTerminalSurfaceTabId(hostTabId)
    const state = {
      tabsByWorktree: {
        'repo-1::worktree-1': [{ id: mirroredTabId }]
      },
      activeTabIdByWorktree: {}
    } as never

    expect(resolveAgentStartupTabId(state, 'repo-1::worktree-1', hostTabId)).toBe(mirroredTabId)
  })

  it('maps a remote host tab before its paired web surface is materialized', () => {
    const hostTabId = 'host-tab'
    const state = {
      tabsByWorktree: {},
      activeTabIdByWorktree: {},
      activeWorktreeId: 'repo-1::worktree-1',
      activeWorkspaceExecutionHostId: 'runtime:runtime-1',
      repos: [{ id: 'repo-1', executionHostId: 'runtime:runtime-1' }],
      worktreesByRepo: { 'repo-1': [{ id: 'repo-1::worktree-1', repoId: 'repo-1', path: '/repo' }] }
    } as never

    expect(resolveAgentStartupTabId(state, 'repo-1::worktree-1', hostTabId)).toBe(
      toWebTerminalSurfaceTabId(hostTabId)
    )
  })
})
