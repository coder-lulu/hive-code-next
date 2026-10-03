import type { AppState } from '@/store/types'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { AgentSessionLaunchPlan } from '@/lib/agent-session-launch-plan'
import type { StructuredAgentLaunchSettlement } from '@/lib/structured-agent-launch-settlement'
import type { AgentLaunchPermissionMode } from '../../../shared/tui-agent-permissions'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { LaunchSource } from '../../../shared/telemetry-events'
import { getConnectionIdFromState } from '@/lib/connection-context'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'

export type LaunchAgentInNewTabArgs = {
  agent: TuiAgent
  worktreeId: string
  /** Host owner for colliding worktree IDs and FolderWorkspace scopes. */
  executionHostId?: ExecutionHostId
  /** Tab group the user launched from; keeps split-group launches in that pane instead of the active group. */
  groupId?: string
  /** Optional initial prompt; delivery depends on `promptDelivery` and the agent's prompt mode. */
  prompt?: string
  /** Optional CLI arguments appended to the selected agent command. */
  agentArgs?: string | null
  /** Per-launch permission policy. Defaults to the configured agent arguments and environment. */
  agentPermissionMode?: AgentLaunchPermissionMode
  initialCwd?: string | null
  /** How to deliver the prompt: `draft` leaves it editable, `submit-after-ready` sends it once the TUI is ready. */
  promptDelivery?: 'auto-submit' | 'draft' | 'submit-after-ready'
  /** Telemetry surface that initiated this launch. Defaults to the tab-bar quick-launch entry point. */
  launchSource?: LaunchSource
  /** User-authored Quick Command label for local tabs created from the tab bar. */
  quickCommandLabel?: string | null
  /** Shell platform for the startup command; defaults to renderer OS. SSH/WSL worktrees run Linux even from Windows. */
  launchPlatform?: NodeJS.Platform
  /** Called after the prompt is actually delivered to the agent input path. */
  onPromptDelivered?: () => void
  /** Keeps a preflighted route authoritative across workspace creation. */
  agentSessionLaunchPlan?: AgentSessionLaunchPlan
  /** Keeps an activation-triggered empty-workspace launch pending until its surface opens. */
  pendingActivationSpawn?: boolean
  /** Lets a workspace reveal itself before the selected surface opens. */
  beforeSurfaceOpen?: (
    surface:
      | { kind: 'local-terminal' }
      | { kind: 'local-agent-session'; sessionId: string }
      | { kind: 'host-published' }
  ) => boolean | void
}

export type AgentLaunchSurface =
  | { kind: 'local-terminal'; tabId: string }
  | { kind: 'local-agent-session'; tabId: string; sessionId: string }
  | { kind: 'host-published' }

export type LaunchAgentInNewTabResult = {
  surface: AgentLaunchSurface
  /** Compatibility projection for existing product callers. */
  tabId: string | null
  startupPlan: AgentStartupPlan
  pasteDraftAfterLaunch: boolean
  /** The structured host will finish focus asynchronously. */
  focusAfterMenuClose?: 'structured-session'
  promptDeliveryResult?: Promise<{ delivered: boolean; failureNotified: boolean }>
  /** Structured route only: what the launch did once it settled. */
  structuredSettlement?: Promise<StructuredAgentLaunchSettlement>
} | null

export function resolveLaunchAgentExecutionContext(
  store: AppState,
  worktreeId: string,
  executionHostId?: ExecutionHostId
) {
  const worktree =
    store.getKnownWorktreeById?.(worktreeId, executionHostId) ??
    store.allWorktrees?.().find((entry: { id: string }) => entry.id === worktreeId)
  const repoCandidates = worktree
    ? (store.repos?.filter((entry) => entry.id === worktree.repoId) ?? [])
    : []
  const worktreeHostId = parseExecutionHostId(worktree?.hostId)?.id
  const resolvedExecutionHostId =
    executionHostId ??
    worktreeHostId ??
    (repoCandidates[0] ? getRepoExecutionHostId(repoCandidates[0]) : LOCAL_EXECUTION_HOST_ID)
  const repo =
    repoCandidates.find((entry) => getRepoExecutionHostId(entry) === resolvedExecutionHostId) ??
    repoCandidates[0] ??
    null
  const parsedExecutionHost = parseExecutionHostId(resolvedExecutionHostId)
  const remoteHost = parsedExecutionHost?.kind === 'ssh' || parsedExecutionHost?.kind === 'runtime'
  const worktreeSshConnectionId =
    parsedExecutionHost?.kind === 'ssh'
      ? parsedExecutionHost.targetId
      : getConnectionIdFromState(store, worktreeId)
  return { repo, resolvedExecutionHostId, remoteHost, worktreeSshConnectionId }
}

export function shouldQueueTerminalFocusAfterMenuClose(
  result: NonNullable<LaunchAgentInNewTabResult>
): boolean {
  return result.surface.kind === 'host-published'
}
