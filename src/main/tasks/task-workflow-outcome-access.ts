import {
  WorkflowNativeCommandsQuerySchema,
  WorkflowNativeArtifactQuerySchema,
  WorkflowNativeOutcomeQuerySchema,
  type WorkflowNativeOutcomeQuery,
  type WorkflowNativeCommandsQuery,
  type WorkflowNativeArtifactQuery
} from '../../shared/task-workflow/workflow-native-outcome-query'
import type { WorkflowNativeOutcomeAsset } from '../../shared/task-workflow/workflow-native-outcome'
import type { WorkflowCommandEvidence } from '../../shared/task-workflow/workflow-command-evidence'
import type { WorkflowNativeArtifact } from '../../shared/task-workflow/workflow-native-artifact'
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

export type WorkflowNativeReadQuery =
  | WorkflowNativeOutcomeQuery
  | WorkflowNativeCommandsQuery
  | WorkflowNativeArtifactQuery
type OutcomeAccessOptions = {
  value: unknown
  caller: TaskExecutionCaller
  mode: 'outcome' | 'commands' | 'artifact'
  now: () => number
  outcomes: TaskExecutionHostDependencies['workflowOutcomes']
  requireRecord: (
    query: WorkflowNativeReadQuery,
    caller: TaskExecutionCaller
  ) => TaskExecutionRecord
  authorize: (
    caller: TaskExecutionCaller,
    command: TaskExecutionStart
  ) => Promise<TaskExecutionAuthorization>
}
export function readTaskWorkflowOutcome(
  options: OutcomeAccessOptions & { mode: 'outcome' }
): Promise<WorkflowNativeOutcomeAsset>
export function readTaskWorkflowOutcome(
  options: OutcomeAccessOptions & { mode: 'commands' }
): Promise<WorkflowCommandEvidence>
export function readTaskWorkflowOutcome(
  options: OutcomeAccessOptions & { mode: 'artifact' }
): Promise<WorkflowNativeArtifact>
export async function readTaskWorkflowOutcome(options: OutcomeAccessOptions) {
  const parsed = {
    outcome: WorkflowNativeOutcomeQuerySchema,
    commands: WorkflowNativeCommandsQuerySchema,
    artifact: WorkflowNativeArtifactQuerySchema
  }[options.mode].safeParse(options.value)
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
    query.kind === 'workflow.artifact.read'
      ? await options.outcomes.readArtifact(record, query.artifactRef, assertCurrent)
      : query.kind === 'workflow.commands.read'
        ? await options.outcomes.readCommands(record, query.artifactRef, assertCurrent)
        : await options.outcomes.read(record, assertCurrent)
  assertCurrent()
  const current = options.requireRecord(query, options.caller)
  if (canonicalAgentSessionDigest(taskCodeSnapshotProducer(current)) !== producerDigest) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return result
}
