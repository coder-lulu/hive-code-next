import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { agentSessionExecutionLocationsEqual } from '../../shared/agent-session-record'
import { agentSessionLeaseAdmitsWriter } from '../../shared/agent-session-lease-adjudication'
import type { NativeTeamTaskToolFactory } from '../../shared/hive-team-task-tools'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { refuseTaskExecution } from '../tasks/task-execution-error'
import type { AgentSessionRecordStore } from './agent-session-record-store'

export type RuntimeTeamTaskToolProvider = (
  input: Parameters<NativeTeamTaskToolFactory>[0]
) => Promise<ReturnType<NativeTeamTaskToolFactory>>

/** Bootstrap tools belong only to the native conversation this host is acquiring. */
export async function prepareRuntimeTeamTaskTools(options: {
  input: StructuredAgentSessionAcquireInput
  store: Pick<AgentSessionRecordStore, 'getRecord' | 'hostId' | 'readOnly'>
  provider?: RuntimeTeamTaskToolProvider
}) {
  const { input, store, provider } = options
  const record = store.getRecord(input.identity.sessionId)
  if (
    !provider ||
    input.taskOrigin ||
    input.identity.agent !== 'codex' ||
    input.identity.hostId !== LOCAL_EXECUTION_HOST_ID ||
    !record ||
    record.provider !== 'codex' ||
    record.taskSource ||
    record.location.wslDistro !== null ||
    record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID
  ) {
    return null
  }
  const location = { ...record.location }
  const accountHome = JSON.stringify(record.accountHome)
  const createdAt = record.createdAt
  const handoffOperationId = record.lease.handoffOperationId
  const assertCurrent = () => {
    const current = store.getRecord(input.identity.sessionId)
    const exactReservation =
      current?.lease.claimStatus === 'reserved' &&
      current.lease.handoffStage === 'new-owner-proving' &&
      handoffOperationId !== null &&
      current.lease.handoffOperationId === handoffOperationId &&
      current.lease.reservedSpawnToken === input.spawnToken
    if (
      store.readOnly ||
      !current ||
      current.sessionId !== input.identity.sessionId ||
      current.provider !== 'codex' ||
      current.taskSource ||
      current.createdAt !== createdAt ||
      current.location.workspaceId !== input.identity.workspaceId ||
      !agentSessionExecutionLocationsEqual(location, current.location) ||
      JSON.stringify(current.accountHome) !== accountHome ||
      current.lease.runtimeFence !== input.fence ||
      current.lease.unreconciled ||
      (!exactReservation && !agentSessionLeaseAdmitsWriter(current.lease)) ||
      current.lease.leaseDeadlineAt <= Date.now() ||
      (current.lease.ownerProcess
        ? current.lease.ownerProcess.hostId !== store.hostId ||
          current.lease.ownerProcess.spawnToken !== input.spawnToken
        : current.lease.reservedSpawnToken !== input.spawnToken)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    return current
  }
  assertCurrent()
  const tools = await provider({
    sessionId: input.identity.sessionId,
    workspaceSelector: `id:${location.workspaceId}`,
    assertCurrent
  })
  assertCurrent()
  return {
    ...tools,
    async call(request, callGuard) {
      const assertLive = () => {
        const current = assertCurrent()
        if (!agentSessionLeaseAdmitsWriter(current.lease)) {
          return refuseTaskExecution('FORBIDDEN')
        }
        callGuard()
      }
      assertLive()
      const result = await tools.call(request, assertLive)
      assertLive()
      return result
    }
  } satisfies ReturnType<NativeTeamTaskToolFactory>
}
