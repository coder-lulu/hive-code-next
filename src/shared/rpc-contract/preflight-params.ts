import { z } from 'zod'
import { RepoSelector } from './github-repo-target-params'
import type { TuiAgent } from '../tui-agent'
import { isTuiAgent } from '../tui-agent-config'
import type { WorkspaceLaunchKind } from '../workspace-launch-kind'
import type { ProjectExecutionRuntimeResolution } from '../project-execution-runtime'

export const PreflightCheck = z.object({
  force: z.boolean().optional()
})

export const PreflightDetectRemoteAgents = z.object({
  connectionId: z.string().min(1)
})

export const PreflightDetectRemoteWindowsTerminalCapabilities = z.object({
  connectionId: z.string().min(1)
})

const AgentVersionAgent = z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown agent preset' })

export const PreflightReadAgentVersion = z
  .object({
    agent: AgentVersionAgent,
    commandOverride: z.string().max(4096).optional(),
    wslDistro: z.string().trim().min(1).max(256).nullable().optional()
  })
  .strict()

export const PreflightReadLatestAgentVersion = z
  .object({ agent: AgentVersionAgent, registry: z.enum(['default', 'china']).optional() })
  .strict()

export const PreflightInstallAgent = z
  .object({
    agent: AgentVersionAgent,
    action: z.enum(['install', 'upgrade']).default('install'),
    registry: z.enum(['default', 'china']).default('default'),
    commandOverride: z.string().max(4096).optional(),
    expectedRealPath: z.string().min(1).max(4096).optional(),
    wslDistro: z.string().trim().min(1).max(256).nullable().optional()
  })
  .strict()

/** Why optional: a client that predates it sends nothing and keeps the host-default probe. */
export const PreflightAgentDetection = z.object({
  worktreeId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional()
})

export const PreflightProjectAgentDetection = PreflightAgentDetection.extend({
  project: RepoSelector.extend({ repo: RepoSelector.shape.repo.pipe(z.string().max(4096)) })
    .strict()
    .optional()
}).refine(
  (value) => !value.project || (!value.worktreeId && !value.repoId),
  'Choose project, repository or worktree'
)

/** Facts resolved by the same project owner that creates the workspace. */
export type ProjectLaunchContext = {
  agents: TuiAgent[]
  workspaceKind: WorkspaceLaunchKind
  executionContext:
    | { kind: 'host'; projectRuntime: ProjectExecutionRuntimeResolution }
    | { kind: 'ssh' }
}
