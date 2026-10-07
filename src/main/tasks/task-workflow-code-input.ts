import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import type { LocalTaskBindingInput } from './local-task-binding-file'
import type { LocalTaskRuntimeOwner } from './local-task-binding-issuer'
import type { LocalTaskBindingIssuerOptions } from './local-task-binding-options'
import type { TaskCodeSnapshotStore } from './task-code-snapshot'
import { refuseTaskExecution } from './task-execution-error'

type ProducerIdentity = Pick<
  TaskExecutionRecord['command'],
  'runtimeRecordId' | 'executionId' | 'executionEpoch'
>

export function createWorkflowTaskCodeRestorer(options: {
  snapshots: TaskCodeSnapshotStore
  currentRuntime(): LocalTaskRuntimeOwner | null
  readExecution(identity: ProducerIdentity): TaskExecutionRecord | null
  resolveSource: LocalTaskBindingIssuerOptions['resolveSource']
  operationCallerKey: string
}): NonNullable<LocalTaskBindingIssuerOptions['restoreCodeInput']> {
  return async (input, directory, assertOwnerCurrent) => {
    assertOwnerCurrent()
    const owner = options.currentRuntime()
    if (!owner) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const source = await options.resolveSource(input.workspaceSelector)
    return restoreWorkflowTaskCode({
      input,
      directory,
      snapshots: options.snapshots,
      readExecution: options.readExecution,
      owner,
      operationCallerKey: options.operationCallerKey,
      originalWorkspaceRef: `workspace:${createHash('sha256').update(JSON.stringify(source.path)).digest('hex')}`,
      assertCurrent: () => {
        assertOwnerCurrent()
        source.assertCurrent()
      }
    })
  }
}

// The private Case admission selects the reference; the original host record proves its provenance.
export async function restoreWorkflowTaskCode(options: {
  input: LocalTaskBindingInput
  directory: string
  snapshots: TaskCodeSnapshotStore
  readExecution(identity: ProducerIdentity): TaskExecutionRecord | null
  owner: LocalTaskRuntimeOwner
  operationCallerKey: string
  originalWorkspaceRef: string
  assertCurrent(): void
}) {
  options.assertCurrent()
  const context = options.input.workflowContext,
    source = context?.codeInput
  if (!context || !source || source.version.kind !== 'snapshot') {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const expected = source.producer
  const record = options.readExecution(expected)
  const parsed = TaskExecutionRecordSchema.safeParse(record)
  if (!parsed.success) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const producer = parsed.data,
    command = producer.command,
    origin = command.workflowContext,
    sessionRef =
      producer.structuredBinding?.sessionId ??
      (producer.launch?.outcome.kind === 'structured' ? producer.launch.outcome.sessionId : null),
    accountRef = `account:${createHash('sha256').update(JSON.stringify(options.owner.accountId)).digest('hex')}`
  if (
    !origin ||
    command.executionPolicy.trustMode !== 'enforced_autonomous' ||
    producer.result?.status !== 'succeeded' ||
    producer.status !== 'succeeded' ||
    producer.operationCallerKey !== options.operationCallerKey ||
    command.runtimeRecordId !== options.owner.runtimeRecordId ||
    command.ownershipEpoch > options.owner.ownershipEpoch ||
    command.ownerScope.kind !== 'personalTenant' ||
    command.ownerScope.tenantRef !== accountRef ||
    command.executionAccountRef !== accountRef ||
    command.workspaceRef !== options.originalWorkspaceRef ||
    command.executionDeadlineAt !== options.input.executionDeadlineAt ||
    digest(origin.binding) !== digest(context.binding) ||
    origin.definitionDigest !== context.definitionDigest ||
    origin.role !== expected.role ||
    origin.employeeRef !== expected.employeeRef ||
    command.ownershipEpoch !== expected.ownershipEpoch ||
    digest(command.task) !== digest(expected.task) ||
    command.task.spaceId !== options.input.task.spaceId ||
    (context.role === 'tester' && command.task.taskId === options.input.task.taskId) ||
    command.task.runId === options.input.task.runId ||
    producer.commandFingerprint !== expected.commandFingerprint ||
    sessionRef !== expected.sessionRef ||
    producer.workspace.workspaceId !== expected.executionWorkspaceRef ||
    command.workspaceExecutionClaimRef !== expected.workspaceExecutionClaimRef
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  const originalDigest = digest(producer)
  const assertProducerCurrent = () => {
    options.assertCurrent()
    const current = options.readExecution(expected)
    if (!current || digest(current) !== originalDigest) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
  }
  assertProducerCurrent()
  const copy = await options.snapshots.restore(
    source.version,
    producer,
    options.directory,
    options.assertCurrent
  )
  assertProducerCurrent()
  return {
    ...copy,
    assertUnchanged: copy.assertCurrent,
    assertCurrent() {
      options.assertCurrent()
      // Docker enforces tester writes; byte validation belongs at restoration and completion.
      copy.assertDirectoryCurrent()
    }
  }
}
