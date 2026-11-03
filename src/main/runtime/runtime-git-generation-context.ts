import type { GlobalSettings } from '../../shared/global-settings-types'
import { gitExecFileAsync } from '../git/runner'
import type { getPullRequestDraftContext } from '../text-generation/pull-request-context'
import type { ResolvedSourceControlAiGenerationParams } from '../../shared/source-control-ai'
import type { CommitMessageAgentRuntimeTarget } from '../text-generation/commit-message-agent-environment'
import type { CommitMessageGenerationTarget } from '../text-generation/commit-message-text-generation'
import type { PullRequestLinkedIssueMeta } from '../source-control/pull-request-linked-issue'
import {
  localGitOptionsForTarget,
  type RuntimeGitCommandHost,
  type RuntimeGitTarget
} from './runtime-git-command-target'

type PullRequestDraftGitExec = Parameters<typeof getPullRequestDraftContext>[0]

/** Runs the PR draft-context probes on a local target. */
export function pullRequestDraftGitExec(target: RuntimeGitTarget): PullRequestDraftGitExec {
  return (argv, options) =>
    gitExecFileAsync(argv, {
      cwd: target.worktree.path,
      ...localGitOptionsForTarget(target),
      ...(options?.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
      ...(options?.timeoutMs === undefined && options?.timeout === undefined
        ? {}
        : { timeout: options?.timeoutMs ?? options?.timeout }),
      admissionTier: 'interactive'
    })
}

export type RuntimeCommitMessageSettingsOverride = Partial<
  Pick<GlobalSettings, 'sourceControlAi' | 'agentCmdOverrides' | 'defaultTuiAgent'>
> & {
  commitMessageDiscoveryHostKey?: string
  sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
}

export function getRuntimeGitGenerationSettings(
  settings: ReturnType<RuntimeGitCommandHost['getRuntimeSettings']>,
  settingsOverride: RuntimeCommitMessageSettingsOverride | undefined
): ReturnType<RuntimeGitCommandHost['getRuntimeSettings']> {
  return {
    ...settings,
    ...(settingsOverride?.sourceControlAi !== undefined
      ? { sourceControlAi: settingsOverride.sourceControlAi }
      : {}),
    ...(settingsOverride?.agentCmdOverrides !== undefined
      ? { agentCmdOverrides: settingsOverride.agentCmdOverrides }
      : {}),
    ...(settingsOverride?.defaultTuiAgent !== undefined
      ? { defaultTuiAgent: settingsOverride.defaultTuiAgent }
      : {})
  }
}

export function localAgentRuntimeTargetForTarget(
  target: RuntimeGitTarget
): CommitMessageAgentRuntimeTarget {
  const wslDistro = localGitOptionsForTarget(target).wslDistro
  return wslDistro ? { runtime: 'wsl', wslDistro } : { runtime: 'host' }
}

export function localTextGenerationTargetForTarget(
  target: RuntimeGitTarget,
  env?: NodeJS.ProcessEnv
): Extract<CommitMessageGenerationTarget, { kind: 'local' }> {
  const wslDistro = localGitOptionsForTarget(target).wslDistro
  return {
    kind: 'local',
    cwd: target.worktree.path,
    ...(wslDistro ? { wslDistro } : {}),
    ...(env ? { env } : {})
  }
}

export function linkedIssueForTarget(
  host: RuntimeGitCommandHost,
  target: RuntimeGitTarget
): number | null | undefined {
  const live = host.getWorktreeLinkedIssue?.(target.worktree.id)
  // Why: `undefined` means the host could not answer, not "unlinked".
  return live === undefined ? target.worktree.linkedIssue : live
}

export function linkedIssueMetaForTarget(
  host: RuntimeGitCommandHost,
  target: RuntimeGitTarget
): PullRequestLinkedIssueMeta | null {
  const live = host.getWorktreeLinkedIssueMeta?.(target.worktree.id)
  if (live !== undefined) {
    return live
  }
  const liveGitHubIssue = host.getWorktreeLinkedIssue?.(target.worktree.id)
  return {
    linkedIssue: liveGitHubIssue === undefined ? target.worktree.linkedIssue : liveGitHubIssue,
    linkedGitLabIssue: target.worktree.linkedGitLabIssue,
    linkedWorkItem: target.worktree.linkedWorkItem
  }
}
