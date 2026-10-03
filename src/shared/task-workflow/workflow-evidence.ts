import { z } from 'zod'
import {
  boundedTaskCollection,
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef,
  TaskProgressSummary,
  TaskRefSchema,
  TaskTimestamp
} from '../task-execution/task-execution-primitives'
import {
  WORKFLOW_CONTRACT_VERSION,
  WorkflowRoleSchema,
  WorkflowRunBindingSchema,
  WorkflowScopeSchema
} from './workflow-bindings'

export const WorkflowArtifactVersionSchema = z.strictObject({
  artifactRef: TaskOpaqueRef,
  artifactRevision: TaskEpoch,
  digest: TaskDigest
})
export const WorkflowCodeVersionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('git_patch'),
    baseCommit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})(?![\s\S])/),
    patch: WorkflowArtifactVersionSchema,
    treeDigest: TaskDigest
  }),
  z.strictObject({
    kind: z.literal('snapshot'),
    snapshot: WorkflowArtifactVersionSchema,
    treeDigest: TaskDigest
  })
])
export const WorkflowRoleExecutionSchema = z.strictObject({
  employeeRef: TaskOpaqueRef,
  role: WorkflowRoleSchema,
  task: TaskRefSchema,
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch,
  executionId: TaskOpaqueRef,
  executionEpoch: TaskEpoch,
  commandFingerprint: TaskDigest,
  sessionRef: TaskOpaqueRef,
  executionWorkspaceRef: TaskOpaqueRef,
  workspaceExecutionClaimRef: TaskOpaqueRef
})
export const WorkflowAudienceSchema = z.strictObject({
  scope: WorkflowScopeSchema,
  employeeRefs: boundedTaskCollection(TaskOpaqueRef, 4, 1)
})
export const WorkflowDependencyVersionSchema = z.strictObject({
  stageRef: TaskOpaqueRef,
  handoffRef: TaskOpaqueRef,
  artifact: WorkflowArtifactVersionSchema
})
export const WorkflowHandoffSchema = z
  .strictObject({
    contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
    kind: z.literal('workflow.handoff'),
    handoffRef: TaskOpaqueRef,
    binding: WorkflowRunBindingSchema,
    stageRef: TaskOpaqueRef,
    producer: WorkflowRoleExecutionSchema,
    consumer: z.strictObject({
      stageRef: TaskOpaqueRef,
      employeeRef: TaskOpaqueRef,
      role: WorkflowRoleSchema
    }),
    artifact: WorkflowArtifactVersionSchema,
    codeVersion: WorkflowCodeVersionSchema.optional(),
    dependencyVersions: boundedTaskCollection(WorkflowDependencyVersionSchema, 32),
    summary: TaskProgressSummary,
    audienceScope: WorkflowAudienceSchema
  })
  .superRefine((handoff, context) => {
    if (handoff.producer.role === 'developer' && !handoff.codeVersion) {
      context.addIssue({ code: 'custom', message: 'workflow_code_version_required' })
    }
    if (
      handoff.binding.scope.companyRef !== handoff.audienceScope.scope.companyRef ||
      handoff.binding.scope.projectRef !== handoff.audienceScope.scope.projectRef ||
      !handoff.audienceScope.employeeRefs.includes(handoff.consumer.employeeRef) ||
      new Set(handoff.audienceScope.employeeRefs).size !== handoff.audienceScope.employeeRefs.length
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_audience_mismatch' })
    }
    if (
      new Set(handoff.dependencyVersions.map((item) => item.stageRef)).size !==
      handoff.dependencyVersions.length
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_duplicate_dependency' })
    }
  })

export const WorkflowReviewSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.review'),
  reviewRef: TaskOpaqueRef,
  binding: WorkflowRunBindingSchema,
  stageRef: TaskOpaqueRef,
  subjectHandoffRef: TaskOpaqueRef,
  artifact: WorkflowArtifactVersionSchema,
  codeVersion: WorkflowCodeVersionSchema,
  reviewer: WorkflowRoleExecutionSchema.extend({ role: z.literal('tester') }),
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  testReport: WorkflowArtifactVersionSchema
})
export const WorkflowDeploymentActionSchema = z.enum(['deploy', 'rollback'])
export const WorkflowDeploymentApprovalSchema = z.strictObject({
  contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
  kind: z.literal('workflow.deployment-approval'),
  approvalRef: TaskOpaqueRef,
  binding: WorkflowRunBindingSchema,
  subjectHandoffRef: TaskOpaqueRef,
  artifact: WorkflowArtifactVersionSchema,
  codeVersion: WorkflowCodeVersionSchema,
  reviewRef: TaskOpaqueRef,
  targetRef: TaskOpaqueRef,
  action: WorkflowDeploymentActionSchema,
  actorRef: TaskOpaqueRef,
  authorizationRevision: TaskOpaqueRef,
  expiresAt: TaskTimestamp
})
export const WorkflowSharedEventSchema = z
  .strictObject({
    contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
    kind: z.literal('workflow.shared-event'),
    sharedEventId: TaskOpaqueRef,
    causationId: TaskOpaqueRef,
    binding: WorkflowRunBindingSchema,
    actorRef: TaskOpaqueRef,
    eventType: z.enum(['decision', 'blocked', 'handoff', 'progress']),
    summary: TaskProgressSummary,
    artifactRefs: boundedTaskCollection(TaskOpaqueRef, 32),
    audienceScope: WorkflowAudienceSchema
  })
  .superRefine((event, context) => {
    if (
      event.binding.scope.companyRef !== event.audienceScope.scope.companyRef ||
      event.binding.scope.projectRef !== event.audienceScope.scope.projectRef ||
      new Set(event.audienceScope.employeeRefs).size !== event.audienceScope.employeeRefs.length
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_audience_mismatch' })
    }
  })

export type WorkflowArtifactVersion = z.infer<typeof WorkflowArtifactVersionSchema>
export type WorkflowCodeVersion = z.infer<typeof WorkflowCodeVersionSchema>
export type WorkflowHandoff = z.infer<typeof WorkflowHandoffSchema>
export type WorkflowReview = z.infer<typeof WorkflowReviewSchema>
