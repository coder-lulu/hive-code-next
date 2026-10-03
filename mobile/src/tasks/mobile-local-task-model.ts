import { agentEntryCompletionAt } from '../../../src/shared/agent-completion-time'
import type {
  AgentStateHistoryEntry,
  AgentStatusState,
  AgentWorkingMode
} from '../../../src/shared/agent-status-types'

export const MOBILE_LOCAL_RECENT_COMPLETED_LIMIT = 20
const MAX_RECENT_COMPLETED_LIMIT = 50

export type MobileLocalTaskSource = 'local' | 'github' | 'gitlab' | 'linear'

export type MobileLocalAgentStatus = {
  state: AgentStatusState
  workingMode?: AgentWorkingMode
  prompt: string
  updatedAt: number
  stateStartedAt: number
  paneKey: string
  tabId?: string
  agentType?: string
  stateHistory: AgentStateHistoryEntry[]
  interrupted?: boolean
  sessionBoundary?: boolean
  restoredUnconfirmed?: boolean
  orchestration?: {
    taskTitle?: string
    displayName?: string
  }
}

export type MobileLocalTerminalAgentTab = {
  id: string
  tabId: string
  title: string
  agentStatus: MobileLocalAgentStatus
}

export type MobileLocalSessionSnapshot = {
  worktreeId: string
  publicationEpoch: string
  snapshotVersion: number
  tabs: MobileLocalTerminalAgentTab[]
}

export type MobileLocalSessionInventory = {
  snapshots: MobileLocalSessionSnapshot[]
  authoritative: boolean
}

export type MobileLocalSessionUpdate = MobileLocalSessionSnapshot & {
  removed: boolean
}

export type MobileLocalWorktreeAgentMetadata = {
  paneKey: string
  displayName: string | null
  taskTitle: string | null
  agentType: string | null
}

export type MobileLocalWorktreeMetadata = {
  worktreeId: string
  repo: string | null
  branch: string | null
  displayName: string | null
  source: MobileLocalTaskSource
  agents: MobileLocalWorktreeAgentMetadata[]
}

export type MobileLocalTaskRow = {
  id: string
  worktreeId: string
  tabId?: string
  paneKey: string
  title: string
  state: AgentStatusState
  workingMode?: AgentWorkingMode
  statusAt: number
  updatedAt: number
  completionAt: number | null
  agentType: string | null
  agentDisplayName: string
  repo: string
  branch: string | null
  worktreeDisplayName: string | null
  source: MobileLocalTaskSource
  verifiable: boolean
}

export type MobileLocalTaskGroups = {
  inProgress: MobileLocalTaskRow[]
  recentCompleted: MobileLocalTaskRow[]
}

function firstText(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized) {
        return normalized
      }
    }
  }
  return null
}

function agentTypeLabel(agentType: string | null): string {
  if (!agentType) {
    return '代理会话'
  }
  const labels: Record<string, string> = {
    claude: 'Claude Code',
    openclaude: 'OpenClaude',
    codex: 'Codex',
    gemini: 'Gemini',
    cursor: 'Cursor',
    copilot: 'Copilot'
  }
  return labels[agentType.toLowerCase()] ?? agentType
}

function completionPrompt(
  status: MobileLocalAgentStatus,
  completionAt: number | null
): string | null {
  if (completionAt === null) {
    return null
  }
  for (let index = status.stateHistory.length - 1; index >= 0; index -= 1) {
    const history = status.stateHistory[index]
    if (
      history?.state === 'done' &&
      history.interrupted !== true &&
      history.startedAt === completionAt
    ) {
      return firstText(history.prompt)
    }
  }
  return null
}

function clampRecentLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return MOBILE_LOCAL_RECENT_COMPLETED_LIMIT
  }
  return Math.max(0, Math.min(MAX_RECENT_COMPLETED_LIMIT, Math.floor(value)))
}

function preferNewerRow(
  current: MobileLocalTaskRow | undefined,
  incoming: MobileLocalTaskRow
): boolean {
  if (!current) {
    return true
  }
  return incoming.updatedAt >= current.updatedAt
}

/** Projects only explicit terminal agentStatus rows into the two truthful task-center groups. */
export function projectMobileLocalTaskGroups(args: {
  snapshots: readonly MobileLocalSessionSnapshot[]
  worktrees: readonly MobileLocalWorktreeMetadata[]
  sourceVerifiable: boolean
  recentLimit?: number
}): MobileLocalTaskGroups {
  const worktreesById = new Map(args.worktrees.map((worktree) => [worktree.worktreeId, worktree]))
  const rowsById = new Map<string, MobileLocalTaskRow>()

  for (const snapshot of args.snapshots) {
    const worktree = worktreesById.get(snapshot.worktreeId)
    for (const tab of snapshot.tabs) {
      const status = tab.agentStatus
      const completionAt = agentEntryCompletionAt({
        state: status.state,
        stateStartedAt: status.stateStartedAt,
        stateHistory: status.stateHistory,
        interrupted: status.interrupted,
        sessionBoundary: status.sessionBoundary
      })
      if (status.state === 'done' && (completionAt === null || completionAt <= 0)) {
        continue
      }
      const worktreeAgent = worktree?.agents.find((agent) => agent.paneKey === status.paneKey)
      const agentType = firstText(status.agentType, worktreeAgent?.agentType)
      const title =
        firstText(
          status.orchestration?.taskTitle,
          worktreeAgent?.taskTitle,
          status.prompt,
          completionPrompt(status, completionAt),
          tab.title
        ) ?? '未命名本地任务'
      const repo = firstText(worktree?.repo, worktree?.displayName, snapshot.worktreeId)!
      const row: MobileLocalTaskRow = {
        id: `${snapshot.worktreeId}:${status.paneKey}`,
        worktreeId: snapshot.worktreeId,
        tabId: tab.tabId,
        paneKey: status.paneKey,
        title,
        state: status.state,
        ...(status.workingMode ? { workingMode: status.workingMode } : {}),
        statusAt: completionAt ?? status.stateStartedAt,
        updatedAt: status.updatedAt,
        completionAt,
        agentType,
        agentDisplayName:
          firstText(worktreeAgent?.displayName, status.orchestration?.displayName) ??
          agentTypeLabel(agentType),
        repo,
        branch: worktree?.branch ?? null,
        worktreeDisplayName: worktree?.displayName ?? null,
        source: worktree?.source ?? 'local',
        verifiable: args.sourceVerifiable && status.restoredUnconfirmed !== true
      }
      if (preferNewerRow(rowsById.get(row.id), row)) {
        rowsById.set(row.id, row)
      }
    }
  }

  const rows = [...rowsById.values()]
  const inProgress = rows
    .filter((row) => row.state === 'working' || row.state === 'blocked' || row.state === 'waiting')
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const recentCompleted = rows
    .filter((row) => row.state === 'done' && row.completionAt !== null)
    .sort((left, right) => (right.completionAt ?? 0) - (left.completionAt ?? 0))
    .slice(0, clampRecentLimit(args.recentLimit))

  return { inProgress, recentCompleted }
}

export function mobileLocalTaskSourceLabel(source: MobileLocalTaskSource): string {
  if (source === 'github') {
    return 'GitHub'
  }
  if (source === 'gitlab') {
    return 'GitLab'
  }
  if (source === 'linear') {
    return 'Linear'
  }
  return '本地'
}

export function mobileLocalTaskStatusLabel(
  row: Pick<MobileLocalTaskRow, 'state' | 'workingMode' | 'verifiable'>
): string {
  if (!row.verifiable) {
    return '不可验证'
  }
  if (row.state === 'done') {
    return '已完成'
  }
  if (row.state === 'blocked') {
    return '受阻'
  }
  if (row.state === 'waiting') {
    return '等待确认'
  }
  return row.workingMode === 'monitoring' ? '后台监控' : '进行中'
}

export function formatMobileLocalTaskTime(value: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - value)
  if (elapsed < 60_000) {
    return '刚刚'
  }
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}
