import { canonicalAgentSessionDigest } from '../agent-session-mutation-envelope'
import { TaskExecutionStartSchema } from './task-execution-command'
import { computeTaskExecutionFingerprint } from './task-execution-fingerprint'
import { TaskOpaqueRef } from './task-execution-primitives'
import { TaskExecutionResultSchema, TaskResourceActivationSchema } from './task-execution-receipts'

/** The lookup must read the authenticated execution host's durable receipt, never a request field. */
export async function taskExecutionEvidenceRefusal(input: {
  command: unknown
  receipt: unknown
  operationCallerKey: string
  readHostReceipt: (receiptId: string) => unknown
}) {
  const parsedCommand = TaskExecutionStartSchema.safeParse(input.command)
  if (!parsedCommand.success) {
    return 'task_command_invalid'
  }
  if (!TaskOpaqueRef.safeParse(input.operationCallerKey).success) {
    return 'task_identity_invalid'
  }
  const command = parsedCommand.data
  const activation = TaskResourceActivationSchema.safeParse(input.receipt)
  const result = TaskExecutionResultSchema.safeParse(input.receipt)
  const receipt = activation.success ? activation.data : result.success ? result.data : null
  if (!receipt) {
    return 'task_evidence_invalid'
  }
  if (
    receipt.executionId !== command.executionId ||
    receipt.executionEpoch !== command.executionEpoch ||
    receipt.runtimeRecordId !== command.runtimeRecordId ||
    receipt.ownershipEpoch !== command.ownershipEpoch ||
    receipt.commandFingerprint !==
      computeTaskExecutionFingerprint(command, input.operationCallerKey)
  ) {
    return 'task_evidence_binding_mismatch'
  }
  if (receipt.kind === 'resource.activation') {
    if (!('resourceSnapshotRef' in command)) {
      return 'task_resource_not_requested'
    }
    if (
      receipt.snapshotRef !== command.resourceSnapshotRef ||
      receipt.snapshotDigest !== command.resourceSnapshotDigest ||
      receipt.resolverVersion !== command.resolverVersion
    ) {
      return 'task_resource_binding_mismatch'
    }
    if (
      command.requiredCoverage === 'effective_set_verified' &&
      receipt.observedCoverage !== 'effective_set_verified'
    ) {
      return 'task_coverage_insufficient'
    }
  }
  let recorded: unknown
  try {
    recorded = await input.readHostReceipt(receipt.receiptId)
  } catch {
    return 'task_evidence_unavailable'
  }
  const parsed = activation.success
    ? TaskResourceActivationSchema.safeParse(recorded)
    : TaskExecutionResultSchema.safeParse(recorded)
  if (
    !parsed.success ||
    canonicalAgentSessionDigest(parsed.data) !== canonicalAgentSessionDigest(receipt)
  ) {
    return 'task_evidence_unverified'
  }
  return null
}
