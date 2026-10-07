import { createHash } from 'node:crypto'
import { TaskExecutionCapabilitiesSchema } from '../../shared/task-execution/task-execution-capabilities'
import {
  TaskExecutionCancelSchema,
  TaskExecutionStartSchema,
  type TaskExecutionStart
} from '../../shared/task-execution/task-execution-command'
import {
  TaskExecutionObserveSchema,
  TaskExecutionObservationSchema,
  TaskExecutionReconcileSchema
} from '../../shared/task-execution/task-execution-observation'
import { TaskDigest, TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import { TaskExecutionAcceptedSchema } from '../../shared/task-execution/task-execution-receipts'
import { createLocalTaskRequest, type LocalTaskClientOptions } from './local-task-http-client'
import { TaskExecutionError } from './task-execution-error'
import { LocalTaskRuntimeOwnerSchema } from '../../shared/task-execution/task-command-delivery'
import {
  HiveRuntimeBindingPurposeSchema,
  type HiveRuntimeBindingPurpose
} from './paperclip-adapter-contract'
import {
  WorkflowNativeCommandsQuerySchema,
  WorkflowNativeArtifactQuerySchema,
  WorkflowNativeOutcomeQuerySchema
} from '../../shared/task-workflow/workflow-native-outcome-query'
import {
  WorkflowNativeOutcomeAssetSchema,
  WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES
} from '../../shared/task-workflow/workflow-native-outcome'
import { WorkflowCommandEvidenceSchema } from '../../shared/task-workflow/workflow-command-evidence'
import { WorkflowNativeArtifactSchema } from '../../shared/task-workflow/workflow-native-artifact'
import { HiveWorkflowCaseRunReadSchema } from '../../shared/hive-workflow-case-runs'

type Identity = Pick<
  TaskExecutionStart,
  'runtimeRecordId' | 'ownershipEpoch' | 'executionId' | 'executionEpoch'
>

function matchesIdentity(expected: Identity, actual: Identity) {
  return (
    expected.runtimeRecordId === actual.runtimeRecordId &&
    expected.ownershipEpoch === actual.ownershipEpoch &&
    expected.executionId === actual.executionId &&
    expected.executionEpoch === actual.executionEpoch
  )
}

export class LocalTaskClient {
  private readonly request: ReturnType<typeof createLocalTaskRequest>
  constructor(options: LocalTaskClientOptions) {
    this.request = createLocalTaskRequest({
      ...options,
      maximumResponseBytesByPath: {
        ...options.maximumResponseBytesByPath,
        '/execution/workflow-outcome': 64 * 1024,
        '/execution/workflow-commands': WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES,
        '/execution/workflow-artifact': WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES
      },
      maximumResponseStructuralTokensByPath: {
        ...options.maximumResponseStructuralTokensByPath,
        '/execution/workflow-commands': 16_384,
        '/execution/workflow-artifact': 16_384
      }
    })
  }

  async capabilities() {
    const parsed = TaskExecutionCapabilitiesSchema.safeParse(await this.request('/capabilities'))
    if (!parsed.success) {
      throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
    }
    return parsed.data
  }

  async prepareCaseRun(value: unknown) {
    const query = HiveWorkflowCaseRunReadSchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const reply = HiveWorkflowCaseRunReadSchema.safeParse(
      await this.request('/execution/workflow-prepare', query.data)
    )
    if (
      !reply.success ||
      query.data.projectId !== reply.data.projectId ||
      query.data.caseId !== reply.data.caseId ||
      query.data.taskId !== reply.data.taskId ||
      query.data.runId !== reply.data.runId
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return reply.data
  }

  async owner() {
    const parsed = LocalTaskRuntimeOwnerSchema.safeParse(await this.request('/execution/owner'))
    if (!parsed.success) {
      throw new TaskExecutionError('FORBIDDEN')
    }
    return parsed.data
  }

  async binding(
    companyId: string,
    runId: string,
    purpose: HiveRuntimeBindingPurpose
  ): Promise<unknown> {
    if (
      !TaskOpaqueRef.safeParse(companyId).success ||
      !TaskOpaqueRef.safeParse(runId).success ||
      !HiveRuntimeBindingPurposeSchema.safeParse(purpose).success
    ) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    return this.request(
      `/execution/binding/${encodeURIComponent(companyId)}/${encodeURIComponent(runId)}?purpose=${purpose}`
    )
  }

  async start(commandValue: unknown, fingerprint: string) {
    const command = TaskExecutionStartSchema.safeParse(commandValue)
    if (!command.success || !TaskDigest.safeParse(fingerprint).success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const parsed = TaskExecutionAcceptedSchema.safeParse(
      await this.request('/execution/start', command.data)
    )
    if (
      !parsed.success ||
      !matchesIdentity(command.data, parsed.data) ||
      parsed.data.commandFingerprint !== fingerprint ||
      parsed.data.operationId !== command.data.operationId ||
      parsed.data.writeFence !== command.data.writeFence ||
      parsed.data.workspaceExecutionClaimRef !== command.data.workspaceExecutionClaimRef
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return parsed.data
  }

  async observe(value: unknown) {
    const query = TaskExecutionObserveSchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const observation = await this.observation('/execution/observe', query.data)
    if (
      observation.cursor < query.data.afterSequence ||
      observation.events.length > query.data.limit ||
      (observation.events.length > 0 &&
        observation.events[0].sequence !== query.data.afterSequence + 1) ||
      (observation.events.length === 0 &&
        (observation.cursor !== query.data.afterSequence ||
          observation.lastSequence > query.data.afterSequence))
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return observation
  }

  async reconcile(value: unknown) {
    const query = TaskExecutionReconcileSchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    return this.observation('/execution/reconcile', query.data)
  }

  async cancel(value: unknown) {
    const query = TaskExecutionCancelSchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    return this.observation('/execution/cancel', query.data)
  }

  async workflowOutcome(value: unknown) {
    const query = WorkflowNativeOutcomeQuerySchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const parsed = WorkflowNativeOutcomeAssetSchema.safeParse(
      await this.request('/execution/workflow-outcome', query.data)
    )
    if (!parsed.success) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    const { outcome, version } = parsed.data
    const digest = createHash('sha256').update(JSON.stringify(outcome)).digest('hex')
    if (
      !matchesIdentity(query.data, outcome.producer) ||
      outcome.producer.commandFingerprint !== query.data.commandFingerprint ||
      version.digest !== digest ||
      version.artifactRef !== `artifact:${digest}`
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return parsed.data
  }

  async workflowCommands(value: unknown) {
    const query = WorkflowNativeCommandsQuerySchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const parsed = WorkflowCommandEvidenceSchema.safeParse(
      await this.request('/execution/workflow-commands', query.data)
    )
    if (
      !parsed.success ||
      parsed.data.kind !== 'available' ||
      !matchesIdentity(query.data, parsed.data.producer) ||
      parsed.data.producer.commandFingerprint !== query.data.commandFingerprint ||
      `artifact:${createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex')}` !==
        query.data.artifactRef
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return parsed.data
  }

  async workflowArtifact(value: unknown) {
    const query = WorkflowNativeArtifactQuerySchema.safeParse(value)
    if (!query.success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    const parsed = WorkflowNativeArtifactSchema.safeParse(
      await this.request('/execution/workflow-artifact', query.data)
    )
    if (!parsed.success) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    const artifact = parsed.data
    const digest = createHash('sha256').update(artifact.text, 'utf8').digest('hex')
    const artifactRef = `artifact:${createHash('sha256')
      .update(JSON.stringify([query.data.commandFingerprint, artifact.name, digest]))
      .digest('hex')}`
    if (
      artifact.version.artifactRef !== query.data.artifactRef ||
      artifact.version.digest !== digest ||
      artifactRef !== query.data.artifactRef
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return artifact
  }

  private async observation(path: string, query: Identity & { commandFingerprint: string }) {
    const parsed = TaskExecutionObservationSchema.safeParse(await this.request(path, query))
    if (
      !parsed.success ||
      !matchesIdentity(query, parsed.data) ||
      parsed.data.commandFingerprint !== query.commandFingerprint
    ) {
      throw new TaskExecutionError('OUTCOME_UNKNOWN')
    }
    return parsed.data
  }
}
