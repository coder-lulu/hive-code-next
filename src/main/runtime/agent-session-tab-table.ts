import { isAgentSessionId, type AgentSessionRecord } from '../../shared/agent-session-record'
import { isAgentSessionSurfaceTabId } from '../../shared/agent-session-surface-tab-id'
import { structuredAgentSessionTabId } from '../../shared/structured-agent-session-projection'
import { AgentSessionTabTable } from './agent-session/agent-session-tab-table'
export { AgentSessionTabTable } from './agent-session/agent-session-tab-table'

function reopenedTabId(sessionId: string, held: (tabId: string) => boolean): string {
  const base = `${structuredAgentSessionTabId(sessionId)}-reopened`
  let tabId = base
  for (let suffix = 2; held(tabId); suffix++) {
    tabId = `${base}-${suffix}`
  }
  return tabId
}

export function parseAgentSessionTabTable(
  file: { sessionTabs?: unknown; visibleSessionIds?: unknown },
  records: ReadonlyMap<string, AgentSessionRecord>,
  strict: boolean
): { valid: boolean; table: AgentSessionTabTable | null } {
  if (file.sessionTabs !== undefined) {
    return parsePersistedTabs(file.sessionTabs, strict)
  }
  if (file.visibleSessionIds === undefined) {
    return { valid: true, table: null }
  }
  if (!Array.isArray(file.visibleSessionIds)) {
    return { valid: !strict, table: null }
  }
  return { valid: true, table: seedFromVisibleSessions(file.visibleSessionIds, records) }
}

/**
 * A cleared chat's tab was opened for the first conversation of its /clear chain and kept that id
 * through every clear, so the chat now showing the chain's latest conversation seeds under the
 * first one's id, as a /clear on this build would have left it. Those chats seed first: a cleared
 * conversation reopened from history is the later tab, and takes a fresh id if its own is held.
 */
function seedFromVisibleSessions(
  visible: readonly unknown[],
  records: ReadonlyMap<string, AgentSessionRecord>
): AgentSessionTabTable {
  const sessionIds = [...new Set(visible.filter(isAgentSessionId))]
  const clearedFrom = new Map<string, string>()
  for (const record of records.values()) {
    const command = record.conversationCommand
    if (
      command?.command === 'clear' &&
      command.phase === 'committed' &&
      command.replacementSessionId &&
      !clearedFrom.has(command.replacementSessionId)
    ) {
      clearedFrom.set(command.replacementSessionId, record.sessionId)
    }
  }
  const clearedTo = new Set(clearedFrom.values())
  const chainRoot = (sessionId: string): string => {
    const seen = new Set([sessionId])
    let current = sessionId
    let prior = clearedFrom.get(current)
    while (prior !== undefined && !seen.has(prior)) {
      seen.add(prior)
      current = prior
      prior = clearedFrom.get(current)
    }
    return current
  }
  const recordedOrDerived = (sessionId: string): string[] => {
    const record = records.get(sessionId)
    const recorded = record && 'surfaceTabId' in record ? record.surfaceTabId : undefined
    return [recorded, structuredAgentSessionTabId(sessionId)].filter(isAgentSessionSurfaceTabId)
  }
  const tabIds = new Map<string, string>()
  const taken = new Set<string>()
  const held = (tabId: string): boolean => taken.has(tabId)
  const assign = (sessionId: string, candidates: readonly string[]): void => {
    const tabId = candidates.find((candidate) => !held(candidate)) ?? reopenedTabId(sessionId, held)
    taken.add(tabId)
    tabIds.set(sessionId, tabId)
  }
  const holdsChainTab = (sessionId: string): boolean =>
    !clearedTo.has(sessionId) && chainRoot(sessionId) !== sessionId
  for (const sessionId of sessionIds.filter(holdsChainTab)) {
    assign(sessionId, [...recordedOrDerived(chainRoot(sessionId)), ...recordedOrDerived(sessionId)])
  }
  for (const sessionId of sessionIds.filter((sessionId) => !holdsChainTab(sessionId))) {
    assign(sessionId, recordedOrDerived(sessionId))
  }
  // In the visible list's order, which is the order older builds restored tabs in.
  return new AgentSessionTabTable(
    sessionIds.flatMap((sessionId) => {
      const tabId = tabIds.get(sessionId)
      return tabId === undefined ? [] : [[tabId, sessionId] as const]
    })
  )
}

function parsePersistedTabs(
  raw: unknown,
  strict: boolean
): { valid: boolean; table: AgentSessionTabTable | null } {
  if (!Array.isArray(raw)) {
    return { valid: !strict, table: null }
  }
  const table = new AgentSessionTabTable()
  for (const entry of raw) {
    const tabId: unknown = entry?.tabId
    const sessionId: unknown = entry?.sessionId
    const wellFormed =
      isAgentSessionSurfaceTabId(tabId) &&
      isAgentSessionId(sessionId) &&
      table.sessionIdFor(tabId) === undefined &&
      table.tabIdFor(sessionId) === undefined
    if (wellFormed) {
      table.show(sessionId, tabId)
    } else if (strict) {
      return { valid: false, table: null }
    }
  }
  return { valid: true, table }
}
