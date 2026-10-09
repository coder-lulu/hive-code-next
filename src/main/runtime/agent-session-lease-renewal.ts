import type { AgentSessionOwnerProbe } from '../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { renewAgentSessionLease } from './agent-session-lease-transitions'
import type { AgentSessionStoreState } from './agent-session-store-state'
import { taskDockerSessionProbeForRecord } from '../tasks/task-docker-session-owner'

export type AgentSessionLeaseRenewal = {
  sessionId: string
  fence: number
  childProbe: AgentSessionOwnerProbe
  now: number
  leaseTtlMs?: number
  validate?: () => void
}

export function renewAgentSessionLeases(
  state: AgentSessionStoreState,
  renewals: readonly AgentSessionLeaseRenewal[],
  defaultLeaseTtlMs: number
): AgentSessionRecord[] {
  return renewals.map((args) => {
    args.validate?.()
    const record = state.records.get(args.sessionId)
    if (!record) {
      throw new Error(
        state.unreadableRecords.has(args.sessionId)
          ? 'execution_owner_reconciling'
          : 'agent_session_identity_required'
      )
    }
    const renewed = renewAgentSessionLease({
      record,
      fence: args.fence,
      childProbe: taskDockerSessionProbeForRecord(record, args.childProbe, state.taskExecutions),
      now: args.now,
      leaseTtlMs: args.leaseTtlMs ?? defaultLeaseTtlMs
    })
    state.records.set(args.sessionId, renewed)
    return renewed
  })
}
