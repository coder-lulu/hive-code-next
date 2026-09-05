import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  CloudUpload,
  GitBranch,
  GitPullRequestArrow,
  History,
  RefreshCw,
  type LucideIcon
} from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileSourceControlActionIcon } from './mobile-source-control-actions'
import type { MobileDiffLine } from '../session/mobile-diff-lines'
import type { MobileHighlightedDiffLine } from '../session/mobile-file-syntax'
import type {
  MobileGitBranchChangeEntry,
  MobileGitBranchCompareResult,
  MobileGitBranchCompareSummary
} from './mobile-branch-compare'
import {
  canOpenMobileGitStatusEntry,
  isMobileGitDiscardableEntry,
  isMobileGitStageableEntry,
  type MobileGitFileStatus,
  type MobileGitStatusEntry,
  type MobileGitStatusResult
} from './mobile-git-status'

export type ScreenState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: MobileGitStatusResult }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }

export type LoadStatusOptions = {
  preserveReadyOnFailure?: boolean
  clearActionErrorOnSuccess?: boolean
  force?: boolean
}

export type StatusLoadInFlight = {
  key: string
  client: unknown
  promise: Promise<boolean>
}

export type GitRequestError = Error & { code?: string }
export type GitCommitResult = { success: boolean; error?: string }

export type MobileGitStatusEntryView = MobileGitStatusEntry & {
  canDiscard: boolean
  canOpen: boolean
  canStage: boolean
  discardActionId: string
  stageActionId: string
  unstageActionId: string
}

// Decorate raw status entries with the row-level capability/action-id fields the
// file list needs. Opener guards must use the same canOpen rule.
export function buildMobileGitStatusEntryViews(
  entries: readonly MobileGitStatusEntry[]
): MobileGitStatusEntryView[] {
  return entries.map((entry) => ({
    ...entry,
    canDiscard: isMobileGitDiscardableEntry(entry),
    canOpen: canOpenMobileGitStatusEntry(entry),
    canStage: isMobileGitStageableEntry(entry),
    discardActionId: `discard:${entry.path}`,
    stageActionId: `stage:${entry.path}`,
    unstageActionId: `unstage:${entry.path}`
  }))
}

export type MobileBranchCompareState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; result: MobileGitBranchCompareResult }
  | { kind: 'error'; message: string }

export type MobileBranchEntryView = MobileGitBranchChangeEntry & {
  canOpen: boolean
}

export type MobileBranchDiffPreviewState =
  | { kind: 'loading'; entry: MobileGitBranchChangeEntry }
  | {
      kind: 'ready'
      entry: MobileGitBranchChangeEntry
      summary: MobileGitBranchCompareSummary
      lines: MobileHighlightedDiffLine<MobileDiffLine>[]
      truncated: boolean
    }
  | { kind: 'error'; entry: MobileGitBranchChangeEntry; message: string }

export type GitDiffTextResult = {
  kind: 'text'
  originalContent: string
  modifiedContent: string
}

export const KEYBOARD_COMMIT_BAR_CLEARANCE = 10

export const SOURCE_CONTROL_ACTION_ICONS: Record<MobileSourceControlActionIcon, LucideIcon> = {
  commit: Check,
  push: ArrowUp,
  pull: ArrowDown,
  sync: ArrowDownUp,
  fetch: RefreshCw,
  publish: CloudUpload,
  rebase: GitBranch,
  pr: GitPullRequestArrow,
  branch: GitBranch,
  history: History
}

export const SELECTOR_RETRY_COUNT = 3
export const SELECTOR_RETRY_DELAY_MS = 250

const SOURCE_CONTROL_FIXED_COPY: Readonly<Record<string, string>> = {
  Commit: '提交',
  'Force Push': '强制推送',
  'Stage All': '全部暂存',
  Push: '推送',
  Pull: '拉取',
  Sync: '同步',
  'Publish Branch': '发布分支',
  Changes: '更改',
  'Untracked Files': '未跟踪文件',
  'Staged Changes': '已暂存更改',
  'Create Pull Request': '创建拉取请求',
  'Create Merge Request': '创建合并请求',
  'Review status unavailable': '暂时无法获取评审状态',
  'Checking review status…': '正在检查评审状态…',
  'Review creation unavailable for this provider': '此代码托管平台暂不支持创建评审',
  'Commit in progress.': '正在提交。',
  'Force push in progress.': '正在强制推送。',
  'Remote operation in progress.': '正在执行远程操作。',
  'Try again once the remote operation finishes.': '请在远程操作完成后重试。',
  'Resolve conflicts before committing.': '请先解决冲突再提交。',
  'Commit staged changes.': '提交已暂存更改。',
  'Enter a commit message to commit.': '请输入提交说明。',
  'Stage all changes.': '暂存全部更改。',
  'Stage at least one file to commit.': '请至少暂存一个文件后再提交。',
  'Check out a branch before publishing commits.': '请先检出分支再发布提交。',
  'Checking review status.': '正在检查评审状态。',
  'Nothing to commit. The review is already merged.': '没有可提交的更改，评审已合并。',
  'Publish this branch to origin.': '将此分支发布到远程仓库。',
  'Push updates to the linked review branch.': '将更新推送到已关联的评审分支。',
  'The linked review branch is unavailable.': '已关联的评审分支不可用。',
  'Force push with lease to update the remote branch.': '使用安全强制推送更新远程分支。',
  'Nothing to commit. Branch is up to date.': '没有可提交的更改，分支已是最新。'
}

export function localizeMobileSourceControlCopy(copy: string): string {
  const fixed = SOURCE_CONTROL_FIXED_COPY[copy]
  if (fixed) {
    return fixed
  }
  const syncCounts = copy.match(/^Pull (\d+), push (\d+)\.$/)
  if (syncCounts) {
    return `拉取 ${syncCounts[1]} 个提交，推送 ${syncCounts[2]} 个提交。`
  }
  const pullCount = copy.match(/^Pull (\d+) commits?\.$/)
  if (pullCount) {
    return `拉取 ${pullCount[1]} 个提交。`
  }
  const pushCount = copy.match(/^Push (\d+) commits?\.$/)
  if (pushCount) {
    return `推送 ${pushCount[1]} 个提交。`
  }
  return copy
}

export function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function formatBranchLabel(branch: string | undefined, head: string | undefined): string {
  if (branch?.startsWith('refs/heads/')) {
    return branch.slice('refs/heads/'.length)
  }
  return branch || head?.slice(0, 7) || '未关联分支'
}

export function statusTextColor(status: MobileGitFileStatus, theme: MobileTheme): string {
  switch (status) {
    case 'added':
    case 'copied':
      return theme.color.status.successText
    case 'deleted':
      return theme.color.status.dangerText
    case 'renamed':
      return theme.color.brand.primary
    case 'untracked':
      return theme.color.status.warningText
    case 'modified':
    default:
      return theme.color.text.secondary
  }
}
