import { isDeepStrictEqual as same } from 'node:util'
import { assertSynchronousAuthorization } from '../../shared/synchronous-authorization-guard'
import { deriveAgentLaunchChildOperationId } from '../../shared/agent-launch-operation'
import {
  agentSessionOperationKey,
  isAgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import type { AgentSessionOperationRow } from '../../shared/agent-session-operation-ledger'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import {
  TaskSessionSourceReferenceSchema,
  TaskStructuredBindingSchema,
  taskSessionSourceReference
} from '../../shared/task-execution/task-structured-binding'
import type { AgentSessionReserveRequest } from '../runtime/agent-session-reservation-admission'
import type { AgentSessionStoreState } from '../runtime/agent-session-store-contract'
import { TaskExecutionRecordSchema, taskExecutionRecordKey } from './task-execution-record'

function refuse(
  reason: 'requestMalformed' | 'identityMismatch' | 'recordMissing' | 'replaySuperseded'
): never {
  if (reason === 'requestMalformed') {
    throw agentSessionRefusalError('agent_session_operation_invalid', { reason })
  }
  if (reason === 'identityMismatch') {
    throw agentSessionRefusalError('agent_session_conflict', { reason })
  }
  throw agentSessionRefusalError('agent_session_ownership_unknown', { reason })
}

function assertTask(condition: unknown, reason: Parameters<typeof refuse>[0]): asserts condition {
  if (!condition) {
    refuse(reason)
  }
}

function taskFor(
  state: AgentSessionStoreState,
  request: AgentSessionReserveRequest,
  record?: AgentSessionRecord
) {
  const origin = request.taskOrigin
  if (origin === undefined) {
    const current = state.records.get(request.sessionId)
    const taskRequest =
      (record && Object.hasOwn(record, 'taskSource')) ||
      (current && Object.hasOwn(current, 'taskSource'))
    assertTask(!taskRequest, 'requestMalformed')
    for (const task of state.taskExecutions?.values() ?? []) {
      assertTask(
        task.structuredBinding?.sessionId !== request.sessionId &&
          !(
            task.launch?.outcome.kind === 'structured' &&
            task.launch.outcome.sessionId === request.sessionId
          ) &&
          deriveAgentLaunchChildOperationId(task.command.operationId) !==
            request.operation.operationId,
        'requestMalformed'
      )
    }
    return null
  }
  assertTask(
    origin !== null && typeof origin === 'object' && typeof origin.validate === 'function',
    'requestMalformed'
  )
  assertSynchronousAuthorization(
    () => origin.validate(),
    () => refuse('requestMalformed')
  )
  const source = TaskSessionSourceReferenceSchema.safeParse(origin.source)
  assertTask(source.success, 'requestMalformed')
  assertTask(!state.taskRecoveryBlocked, 'replaySuperseded')
  const key = taskExecutionRecordKey(source.data)
  const tasks = state.taskExecutions
  const current = tasks?.get(key)
  assertTask(tasks && current, 'recordMissing')
  const parsed = TaskExecutionRecordSchema.safeParse(current)
  assertTask(parsed.success, 'requestMalformed')
  const task = parsed.data
  assertTask(
    same(source.data, taskSessionSourceReference(task)) &&
      task.operationCallerKey === origin.operationCallerKey &&
      task.command.operationId === origin.operationId &&
      request.operation.callerKey === origin.operationCallerKey &&
      request.operation.operationId === deriveAgentLaunchChildOperationId(origin.operationId) &&
      request.handoffOperationId === request.operation.operationId,
    'identityMismatch'
  )
  assertTask(
    task.status === 'accepted' &&
      task.dispatch === 'dispatching' &&
      !task.cancellationKey &&
      !task.result,
    'replaySuperseded'
  )
  assertTask(
    request.provider === 'codex' &&
      request.accountHome?.variable === 'CODEX_HOME' &&
      request.location?.executionHostId === 'local' &&
      request.location.wslDistro === null &&
      request.location.workspaceId === task.workspace.workspaceId &&
      request.location.workspaceKind ===
        (task.workspace.isolation === 'managed_worktree' ? 'git-worktree' : 'folder'),
    'identityMismatch'
  )
  const outer = state.operations.get(
    agentSessionOperationKey(origin.operationCallerKey, origin.operationId)
  )
  assertRow(
    outer,
    {
      callerKey: origin.operationCallerKey,
      operationId: origin.operationId,
      fingerprint: origin.launchFingerprint
    },
    request.now
  )
  assertTask(outer.outcome.status === 'unknown', 'replaySuperseded')
  return { task, key, source: source.data, origin, tasks }
}

function assertRow(
  row: AgentSessionOperationRow | undefined,
  operation: AgentSessionReserveRequest['operation'],
  now: number
): asserts row is AgentSessionOperationRow {
  assertTask(row, 'recordMissing')
  assertTask(isAgentSessionOperationRow(row), 'requestMalformed')
  assertTask(
    row.callerKey === operation.callerKey &&
      row.operationId === operation.operationId &&
      row.fingerprint === operation.fingerprint,
    'identityMismatch'
  )
  assertTask(row.expiresAt > now, 'replaySuperseded')
}

function bindingFor(
  context: NonNullable<ReturnType<typeof taskFor>>,
  request: AgentSessionReserveRequest,
  record: AgentSessionRecord
) {
  assertTask(
    record.sessionId === request.sessionId &&
      record.provider === 'codex' &&
      same(record.location, request.location) &&
      same(record.accountHome, request.accountHome) &&
      record.lease.sessionId === record.sessionId &&
      record.lease.runtimeKind === 'native' &&
      record.lease.claimKeyId === request.claimKeyId &&
      (request.expectedFence === null || request.expectedFence === record.lease.runtimeFence) &&
      (typeof request.spawnToken !== 'string' ||
        record.lease.reservedSpawnToken === request.spawnToken),
    'identityMismatch'
  )
  const parsed = TaskStructuredBindingSchema.safeParse({
    source: context.source,
    operationCallerKey: context.origin.operationCallerKey,
    operationId: context.origin.operationId,
    launchFingerprint: context.origin.launchFingerprint,
    attachOperationId: request.operation.operationId,
    attachFingerprint: request.operation.fingerprint,
    sessionId: record.sessionId,
    runtimeFence: record.lease.runtimeFence,
    spawnToken: record.lease.reservedSpawnToken,
    accountHome: record.accountHome,
    location: record.location
  })
  assertTask(parsed.success, 'requestMalformed')
  assertTask(
    !Object.hasOwn(record, 'taskSource') || same(record.taskSource, context.source),
    'identityMismatch'
  )
  assertTask(
    !context.task.structuredBinding ||
      (same(context.task.structuredBinding, parsed.data) &&
        same(record.taskSource, context.source)),
    'identityMismatch'
  )
  return parsed.data
}

function assertReserved(request: AgentSessionReserveRequest, record: AgentSessionRecord): void {
  const lease = record.lease
  assertTask(
    lease.claimStatus === 'reserved' &&
      lease.handoffStage === 'new-owner-proving' &&
      lease.ownerProcess === null &&
      lease.provenHandleLinkId === null &&
      !lease.unreconciled &&
      lease.deathEvidence === null &&
      lease.claimKeyId === request.claimKeyId &&
      lease.handoffOperationId === request.operation.operationId &&
      record.providerHandleChain.length === 0 &&
      request.adoptedHandleLink === undefined,
    'replaySuperseded'
  )
}

export function assertTaskStructuredReservation(
  state: AgentSessionStoreState,
  request: AgentSessionReserveRequest
): void {
  const context = taskFor(state, request)
  if (!context) {
    return
  }
  const current = state.records.get(request.sessionId)
  if (context.task.structuredBinding) {
    assertTask(current, 'recordMissing')
    assertTask(['reserved', 'live'].includes(current.lease.claimStatus), 'replaySuperseded')
    bindingFor(context, request, current)
    const inner = state.operations.get(
      agentSessionOperationKey(request.operation.callerKey, request.operation.operationId)
    )
    assertRow(inner, request.operation, request.now)
  } else {
    assertTask(!current && request.expectedFence === null, 'identityMismatch')
  }
}

export function bindTaskStructuredReservation(
  state: AgentSessionStoreState,
  request: AgentSessionReserveRequest,
  record: AgentSessionRecord,
  row: AgentSessionOperationRow
): AgentSessionRecord {
  const context = taskFor(state, request, record)
  if (!context) {
    return record
  }
  assertRow(row, request.operation, request.now)
  const binding = bindingFor(context, request, record)
  if (context.task.structuredBinding) {
    return record
  }
  const inner = state.operations.get(agentSessionOperationKey(row.callerKey, row.operationId))
  if (inner) {
    assertRow(inner, request.operation, request.now)
    assertTask(same(inner, row), 'identityMismatch')
  }
  assertTask(row.outcome.status === 'pending', 'replaySuperseded')
  assertReserved(request, record)
  const next = TaskExecutionRecordSchema.parse({
    ...context.task,
    structuredBinding: binding,
    revision: context.task.revision + 1
  })
  context.tasks.set(context.key, next)
  return { ...record, taskSource: context.source }
}

export function assertTaskStructuredAcquisition(
  state: AgentSessionStoreState,
  request: AgentSessionReserveRequest,
  record: AgentSessionRecord
): void {
  const context = taskFor(state, request, record)
  if (!context) {
    return
  }
  assertTask(context.task.structuredBinding, 'recordMissing')
  const current = state.records.get(request.sessionId)
  assertTask(current, 'recordMissing')
  assertTask(same(current, record), 'identityMismatch')
  bindingFor(context, request, current)
  assertReserved(request, current)
  const inner = state.operations.get(
    agentSessionOperationKey(request.operation.callerKey, request.operation.operationId)
  )
  assertRow(inner, request.operation, request.now)
  assertTask(inner.outcome.status === 'pending', 'replaySuperseded')
}
