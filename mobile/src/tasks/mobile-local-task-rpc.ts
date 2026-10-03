import type {
  AgentStateHistoryEntry,
  AgentStatusState
} from '../../../src/shared/agent-status-types'
import type {
  MobileLocalAgentStatus,
  MobileLocalSessionInventory,
  MobileLocalSessionSnapshot,
  MobileLocalSessionUpdate,
  MobileLocalTerminalAgentTab,
  MobileLocalWorktreeAgentMetadata,
  MobileLocalWorktreeMetadata
} from './mobile-local-task-model'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function optionalString(value: unknown): string | undefined {
  return nonEmptyString(value) ?? undefined
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function positiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function worktreeTaskSource(row: UnknownRecord): MobileLocalWorktreeMetadata['source'] {
  if (nonEmptyString(row.linkedLinearIssue)) {
    return 'linear'
  }
  if (positiveNumber(row.linkedGitLabMR) || positiveNumber(row.linkedGitLabIssue)) {
    return 'gitlab'
  }
  if (positiveNumber(row.linkedIssue) || positiveNumber(asRecord(row.linkedPR)?.number)) {
    return 'github'
  }
  return 'local'
}

function isAgentState(value: unknown): value is AgentStatusState {
  return value === 'working' || value === 'blocked' || value === 'waiting' || value === 'done'
}

function parseStateHistory(value: unknown): AgentStateHistoryEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  const history: AgentStateHistoryEntry[] = []
  for (const candidate of value) {
    const row = asRecord(candidate)
    const startedAt = timestamp(row?.startedAt)
    if (!row || !isAgentState(row.state) || startedAt === null) {
      continue
    }
    history.push({
      state: row.state,
      prompt: typeof row.prompt === 'string' ? row.prompt : '',
      startedAt,
      ...(row.interrupted === true ? { interrupted: true } : {})
    })
  }
  return history
}

function parseAgentStatus(value: unknown): MobileLocalAgentStatus | null {
  const row = asRecord(value)
  if (!row || !isAgentState(row.state)) {
    return null
  }
  const paneKey = nonEmptyString(row.paneKey)
  const updatedAt = timestamp(row.updatedAt)
  const stateStartedAt = timestamp(row.stateStartedAt)
  if (!paneKey || updatedAt === null || stateStartedAt === null) {
    return null
  }
  const orchestration = asRecord(row.orchestration)
  const taskTitle = optionalString(orchestration?.taskTitle)
  const displayName = optionalString(orchestration?.displayName)
  const tabId = optionalString(row.tabId)
  const agentType = optionalString(row.agentType)
  return {
    state: row.state,
    ...(row.workingMode === 'monitoring' ? { workingMode: 'monitoring' as const } : {}),
    prompt: typeof row.prompt === 'string' ? row.prompt : '',
    updatedAt,
    stateStartedAt,
    paneKey,
    ...(tabId ? { tabId } : {}),
    ...(agentType ? { agentType } : {}),
    stateHistory: parseStateHistory(row.stateHistory),
    ...(row.interrupted === true ? { interrupted: true } : {}),
    ...(row.sessionBoundary === true ? { sessionBoundary: true } : {}),
    ...(row.restoredUnconfirmed === true ? { restoredUnconfirmed: true } : {}),
    ...(taskTitle || displayName
      ? {
          orchestration: {
            ...(taskTitle ? { taskTitle } : {}),
            ...(displayName ? { displayName } : {})
          }
        }
      : {})
  }
}

function parseTerminalAgentTab(value: unknown): MobileLocalTerminalAgentTab | null {
  const row = asRecord(value)
  if (!row || row.type !== 'terminal') {
    return null
  }
  const id = nonEmptyString(row.id)
  const agentStatus = parseAgentStatus(row.agentStatus)
  if (!id || !agentStatus) {
    return null
  }
  const parentTabId = nonEmptyString(row.parentTabId)
  return {
    id,
    tabId: parentTabId ?? agentStatus.tabId ?? id,
    title: typeof row.title === 'string' ? row.title.trim() : '',
    agentStatus
  }
}

function parseSessionSnapshot(value: unknown): MobileLocalSessionSnapshot | null {
  const row = asRecord(value)
  const worktreeId = nonEmptyString(row?.worktree)
  const publicationEpoch = nonEmptyString(row?.publicationEpoch)
  const snapshotVersion = timestamp(row?.snapshotVersion)
  if (
    !row ||
    !worktreeId ||
    !publicationEpoch ||
    snapshotVersion === null ||
    !Array.isArray(row.tabs)
  ) {
    return null
  }
  return {
    worktreeId,
    publicationEpoch,
    snapshotVersion,
    tabs: row.tabs
      .map((tab) => parseTerminalAgentTab(tab))
      .filter((tab): tab is MobileLocalTerminalAgentTab => tab !== null)
  }
}

/** Parses the listAll/subscribeAll census while dropping individual malformed snapshots. */
export function parseMobileLocalSessionInventory(value: unknown): MobileLocalSessionInventory {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.snapshots)) {
    throw new Error('Runtime returned an invalid session tab inventory.')
  }
  const snapshots = row.snapshots
    .map((snapshot) => parseSessionSnapshot(snapshot))
    .filter((snapshot): snapshot is MobileLocalSessionSnapshot => snapshot !== null)
  return {
    snapshots,
    // A malformed census member means absence is not proven, even when the envelope claims
    // authority. Downgrading it preserves prior rows instead of silently deleting them.
    authoritative: row.authoritative === true && snapshots.length === row.snapshots.length
  }
}

/** Parses one subscribeAll `updated` payload. */
export function parseMobileLocalSessionUpdate(value: unknown): MobileLocalSessionUpdate | null {
  const row = asRecord(value)
  const snapshot = parseSessionSnapshot(value)
  return row && snapshot ? { ...snapshot, removed: row.removed === true } : null
}

function parseWorktreeAgentMetadata(value: unknown): MobileLocalWorktreeAgentMetadata | null {
  const row = asRecord(value)
  const paneKey = nonEmptyString(row?.paneKey)
  if (!row || !paneKey) {
    return null
  }
  return {
    paneKey,
    displayName: nonEmptyString(row.displayName),
    taskTitle: nonEmptyString(row.taskTitle),
    agentType: nonEmptyString(row.agentType)
  }
}

/** Parses only the worktree.ps metadata used by the local task presentation. */
export function parseMobileLocalWorktreeMetadata(value: unknown): MobileLocalWorktreeMetadata[] {
  const row = asRecord(value)
  if (!row || !Array.isArray(row.worktrees)) {
    throw new Error('Runtime returned invalid worktree metadata.')
  }
  const worktrees: MobileLocalWorktreeMetadata[] = []
  for (const candidate of row.worktrees) {
    const worktree = asRecord(candidate)
    const worktreeId = nonEmptyString(worktree?.worktreeId)
    if (!worktree || !worktreeId) {
      continue
    }
    worktrees.push({
      worktreeId,
      repo: nonEmptyString(worktree.repo),
      branch: nonEmptyString(worktree.branch),
      displayName: nonEmptyString(worktree.displayName),
      source: worktreeTaskSource(worktree),
      agents: Array.isArray(worktree.agents)
        ? worktree.agents
            .map((agent) => parseWorktreeAgentMetadata(agent))
            .filter((agent): agent is MobileLocalWorktreeAgentMetadata => agent !== null)
        : []
    })
  }
  return worktrees
}
