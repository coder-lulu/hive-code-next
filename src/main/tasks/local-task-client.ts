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
    this.request = createLocalTaskRequest(options)
  }

  async capabilities() {
    const parsed = TaskExecutionCapabilitiesSchema.safeParse(await this.request('/capabilities'))
    if (!parsed.success) {
      throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
    }
    return parsed.data
  }

  async binding(companyId: string, runId: string): Promise<unknown> {
    if (!TaskOpaqueRef.safeParse(companyId).success || !TaskOpaqueRef.safeParse(runId).success) {
      throw new TaskExecutionError('INVALID_REQUEST')
    }
    return this.request(
      `/execution/binding/${encodeURIComponent(companyId)}/${encodeURIComponent(runId)}`
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
      observation.events.some((event) => event.sequence <= query.data.afterSequence)
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
