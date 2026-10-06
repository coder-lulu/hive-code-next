import {
  WorkflowNativeCommandsQuerySchema,
  WorkflowNativeOutcomeQuerySchema,
  type WorkflowNativeOutcomeQuery,
  type WorkflowNativeCommandsQuery
} from '../../shared/task-workflow/workflow-native-outcome-query'
import type { WorkflowNativeOutcomeAsset } from '../../shared/task-workflow/workflow-native-outcome'
import type { WorkflowCommandEvidence } from '../../shared/task-workflow/workflow-command-evidence'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import type {
  TaskExecutionAuthorization,
  TaskExecutionCaller,
  TaskExecutionHostDependencies
} from './task-execution-ports'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'

type OutcomeAccessOptions = {
  value: unknown
  caller: TaskExecutionCaller
  commands: boolean
  now: () => number
  outcomes: TaskExecutionHostDependencies['workflowOutcomes']
  requireRecord: (
    query: WorkflowNativeOutcomeQuery | WorkflowNativeCommandsQuery,
    caller: TaskExecutionCaller
  ) => TaskExecutionRecord
  authorize: (
    caller: TaskExecutionCaller,
    command: TaskExecutionStart
  ) => Promise<TaskExecutionAuthorization>
}
export function readTaskWorkflowOutcome(
  options: OutcomeAccessOptions & { commands: false }
): Promise<WorkflowNativeOutcomeAsset>
export function readTaskWorkflowOutcome(
  options: OutcomeAccessOptions & { commands: true }
): Promise<WorkflowCommandEvidence>
export async function readTaskWorkflowOutcome(options: OutcomeAccessOptions) {
  const parsed = (
    options.commands ? WorkflowNativeCommandsQuerySchema : WorkflowNativeOutcomeQuerySchema
  ).safeParse(options.value)
  if (!parsed.success) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  const query = parsed.data
  const record = options.requireRecord(query, options.caller)
  const authorization = await options.authorize(options.caller, {
    ...record.command,
    authorizationRef: query.authorizationRef,
    authorizationRevision: query.authorizationRevision,
    expiresAt: query.expiresAt
  })
  const assertCurrent = () => {
    assertTaskAuthorizationCurrent(() => authorization.assertCurrent())
    if (Date.parse(query.expiresAt) <= options.now()) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
  if (!options.outcomes) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  assertCurrent()
  const producerDigest = canonicalAgentSessionDigest(taskCodeSnapshotProducer(record))
  const result =
    'artifactRef' in query
      ? await options.outcomes.readCommands(record, query.artifactRef, assertCurrent)
      : await options.outcomes.read(record, assertCurrent)
  assertCurrent()
  const current = options.requireRecord(query, options.caller)
  if (canonicalAgentSessionDigest(taskCodeSnapshotProducer(current)) !== producerDigest) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return result
}
