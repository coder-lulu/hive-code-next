import { agentDotState } from './agent-row-display'
import type { Worktree } from './workspace-list-types'

export type MobileWorkspaceSummary = Readonly<{
  workspaceCount: string
  runningAgentCount: string
  attentionCount: string
}>

export function projectMobileWorkspaceSummary(
  worktrees: readonly Worktree[],
  runtimeConnected: boolean,
  now: number
): MobileWorkspaceSummary {
  if (!runtimeConnected) {
    return {
      workspaceCount: String(worktrees.length),
      runningAgentCount: '—',
      attentionCount: '—'
    }
  }

  let runningAgentCount = 0
  let attentionCount = 0
  for (const worktree of worktrees) {
    let workspaceHasAgentAttention = false
    for (const agent of worktree.agents ?? []) {
      const state = agentDotState(agent, now)
      if (state === 'working' || state === 'monitoring') {
        runningAgentCount += 1
      } else if (state === 'blocked' || state === 'waiting') {
        attentionCount += 1
        workspaceHasAgentAttention = true
      }
    }
    if (worktree.status === 'permission' && !workspaceHasAgentAttention) {
      attentionCount += 1
    }
  }

  return {
    workspaceCount: String(worktrees.length),
    runningAgentCount: String(runningAgentCount),
    attentionCount: String(attentionCount)
  }
}
