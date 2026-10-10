import { WorkflowRoleExecutionSchema } from '../../../src/shared/task-workflow/workflow-evidence.ts'
import { WorkflowNativeOutcomeAssetSchema } from '../../../src/shared/task-workflow/workflow-native-outcome.ts'

export function workflowRoleExecutionForAsset(rawAsset) {
  const { context, producer } = WorkflowNativeOutcomeAssetSchema.parse(rawAsset).outcome
  return WorkflowRoleExecutionSchema.parse({
    employeeRef: context.employeeRef,
    role: context.role,
    task: producer.task,
    runtimeRecordId: producer.runtimeRecordId,
    ownershipEpoch: producer.ownershipEpoch,
    executionId: producer.executionId,
    executionEpoch: producer.executionEpoch,
    commandFingerprint: producer.commandFingerprint,
    sessionRef: producer.sessionRef,
    executionWorkspaceRef: producer.executionWorkspaceId,
    workspaceExecutionClaimRef: producer.workspaceExecutionClaimRef
  })
}
