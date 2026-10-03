import type { AgentSessionLease, AgentSessionRecord } from '../../../shared/agent-session-record'

export type StructuredProviderSessionOwnership = {
  sessionId: string
  workspaceId: string
  provider: 'claude' | 'codex'
  providerSessionId: string
  lease: AgentSessionLease
}

export function listStructuredProviderSessionOwnership(
  records: readonly AgentSessionRecord[]
): StructuredProviderSessionOwnership[] {
  return records.flatMap((record) => {
    if (record.provider === 'managed-pi') {
      return []
    }
    const provider = record.provider
    return record.providerHandleChain.map((link) => ({
      sessionId: record.sessionId,
      workspaceId: record.location.workspaceId,
      provider,
      providerSessionId:
        link.handle.provider === 'codex' ? link.handle.threadId : link.handle.sessionId,
      lease: record.lease
    }))
  })
}
