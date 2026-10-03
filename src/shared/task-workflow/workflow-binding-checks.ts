import { WorkflowDefinitionSchema } from './workflow-definition'
import {
  WorkflowRunBindingSchema,
  WorkflowTeamBindingSchema,
  type WorkflowRunBinding
} from './workflow-bindings'
import {
  WorkflowDeploymentActionSchema,
  WorkflowDeploymentApprovalSchema,
  WorkflowHandoffSchema,
  WorkflowReviewSchema,
  type WorkflowArtifactVersion,
  type WorkflowCodeVersion
} from './workflow-evidence'
import { boundedTaskCollection, TaskOpaqueRef } from '../task-execution/task-execution-primitives'

function sameBinding(left: WorkflowRunBinding, right: WorkflowRunBinding) {
  return (
    left.scope.companyRef === right.scope.companyRef &&
    left.scope.projectRef === right.scope.projectRef &&
    left.workflowRef === right.workflowRef &&
    left.workflowRevision === right.workflowRevision &&
    left.workflowRunRef === right.workflowRunRef
  )
}
function sameArtifact(left: WorkflowArtifactVersion, right: WorkflowArtifactVersion) {
  return (
    left.artifactRef === right.artifactRef &&
    left.artifactRevision === right.artifactRevision &&
    left.digest === right.digest
  )
}
function sameCode(left: WorkflowCodeVersion, right: WorkflowCodeVersion) {
  if (left.treeDigest !== right.treeDigest) {
    return false
  }
  if (left.kind === 'git_patch' && right.kind === 'git_patch') {
    return left.baseCommit === right.baseCommit && sameArtifact(left.patch, right.patch)
  }
  return (
    left.kind === 'snapshot' &&
    right.kind === 'snapshot' &&
    sameArtifact(left.snapshot, right.snapshot)
  )
}

/** Structural binding checks only; callers still need current authorization and host-owned receipts. */
export function workflowHandoffBindingRefusal(
  handoffValue: unknown,
  definitionValue: unknown,
  teamValue: unknown
) {
  const handoff = WorkflowHandoffSchema.safeParse(handoffValue)
  const definition = WorkflowDefinitionSchema.safeParse(definitionValue)
  const team = WorkflowTeamBindingSchema.safeParse(teamValue)
  if (!handoff.success || !definition.success || !team.success) {
    return 'workflow_binding_invalid'
  }
  const transfer = handoff.data
  const workflow = definition.data
  const scope = team.data.project.scope
  if (
    transfer.binding.scope.companyRef !== workflow.scope.companyRef ||
    transfer.binding.scope.projectRef !== workflow.scope.projectRef ||
    transfer.binding.workflowRef !== workflow.workflowRef ||
    transfer.binding.workflowRevision !== workflow.workflowRevision ||
    transfer.binding.scope.companyRef !== scope.companyRef ||
    transfer.binding.scope.projectRef !== scope.projectRef ||
    transfer.producer.task.spaceId !== scope.companyRef
  ) {
    return 'workflow_binding_mismatch'
  }
  const producerStage = workflow.stages.find((stage) => stage.stageRef === transfer.stageRef)
  const consumerStage = workflow.stages.find(
    (stage) => stage.stageRef === transfer.consumer.stageRef
  )
  const producer = team.data.employees.find(
    (employee) => employee.employeeRef === transfer.producer.employeeRef
  )
  const consumer = team.data.employees.find(
    (employee) => employee.employeeRef === transfer.consumer.employeeRef
  )
  if (
    producerStage?.role !== transfer.producer.role ||
    producer?.role !== transfer.producer.role ||
    consumerStage?.role !== transfer.consumer.role ||
    consumer?.role !== transfer.consumer.role ||
    !consumerStage?.dependsOn.includes(transfer.stageRef) ||
    transfer.audienceScope.employeeRefs.some(
      (ref) => !team.data.employees.some((employee) => employee.employeeRef === ref)
    )
  ) {
    return 'workflow_assignment_mismatch'
  }
  if (
    transfer.dependencyVersions.length !== producerStage.dependsOn.length ||
    transfer.dependencyVersions.some(
      (dependency) => !producerStage.dependsOn.includes(dependency.stageRef)
    )
  ) {
    return 'workflow_dependency_version_missing'
  }
  return null
}

export function workflowReviewBindingRefusal(handoffValue: unknown, reviewValue: unknown) {
  const handoff = WorkflowHandoffSchema.safeParse(handoffValue)
  const review = WorkflowReviewSchema.safeParse(reviewValue)
  if (!handoff.success || !review.success) {
    return 'workflow_binding_invalid'
  }
  const transfer = handoff.data
  const test = review.data
  if (
    !sameBinding(transfer.binding, test.binding) ||
    transfer.handoffRef !== test.subjectHandoffRef ||
    transfer.consumer.stageRef !== test.stageRef
  ) {
    return 'workflow_binding_mismatch'
  }
  if (
    !sameArtifact(transfer.artifact, test.artifact) ||
    !transfer.codeVersion ||
    !sameCode(transfer.codeVersion, test.codeVersion)
  ) {
    return 'workflow_artifact_revision_mismatch'
  }
  const producer = transfer.producer
  const reviewer = test.reviewer
  if (
    producer.role !== 'developer' ||
    transfer.consumer.role !== 'tester' ||
    transfer.consumer.employeeRef !== reviewer.employeeRef ||
    producer.employeeRef === reviewer.employeeRef ||
    producer.executionId === reviewer.executionId ||
    producer.task.taskId === reviewer.task.taskId ||
    producer.sessionRef === reviewer.sessionRef ||
    producer.executionWorkspaceRef === reviewer.executionWorkspaceRef ||
    producer.workspaceExecutionClaimRef === reviewer.workspaceExecutionClaimRef ||
    reviewer.task.spaceId !== transfer.binding.scope.companyRef ||
    test.testReport.artifactRef === transfer.artifact.artifactRef
  ) {
    return 'workflow_independent_test_required'
  }
  return null
}

export function workflowDeploymentBindingRefusal(options: {
  handoff: unknown
  review: unknown
  approval: unknown
  targetRef: unknown
  action: unknown
  actorRef: unknown
  authorizationRevision: unknown
  now: number
}) {
  const reason = workflowReviewBindingRefusal(options.handoff, options.review)
  if (reason) {
    return reason
  }
  const handoff = WorkflowHandoffSchema.parse(options.handoff)
  const review = WorkflowReviewSchema.parse(options.review)
  const parsed = WorkflowDeploymentApprovalSchema.safeParse(options.approval)
  if (
    !parsed.success ||
    !TaskOpaqueRef.safeParse(options.targetRef).success ||
    !WorkflowDeploymentActionSchema.safeParse(options.action).success
  ) {
    return 'workflow_binding_invalid'
  }
  const approval = parsed.data
  if (
    !sameBinding(handoff.binding, approval.binding) ||
    handoff.handoffRef !== approval.subjectHandoffRef ||
    review.reviewRef !== approval.reviewRef
  ) {
    return 'workflow_binding_mismatch'
  }
  if (
    !sameArtifact(handoff.artifact, approval.artifact) ||
    !sameCode(review.codeVersion, approval.codeVersion)
  ) {
    return 'workflow_artifact_revision_mismatch'
  }
  if (review.decision !== 'approved') {
    return 'workflow_review_not_approved'
  }
  if (
    !Number.isFinite(options.now) ||
    Date.parse(approval.expiresAt) <= options.now ||
    approval.targetRef !== options.targetRef ||
    approval.action !== options.action ||
    approval.actorRef !== options.actorRef ||
    approval.authorizationRevision !== options.authorizationRevision
  ) {
    return 'workflow_deployment_authorization_mismatch'
  }
  return null
}

/** A terminal child (including cancellation) is not engineering acceptance. */
export function workflowCompletionBindingRefusal(requiredHandoffs: unknown, reviewsValue: unknown) {
  const handoffs = boundedTaskCollection(WorkflowHandoffSchema, 32, 1).safeParse(requiredHandoffs)
  const reviews = boundedTaskCollection(WorkflowReviewSchema, 32).safeParse(reviewsValue)
  if (!handoffs.success || !reviews.success) {
    return 'workflow_binding_invalid'
  }
  if (new Set(handoffs.data.map((handoff) => handoff.handoffRef)).size !== handoffs.data.length) {
    return 'workflow_binding_invalid'
  }
  const binding = WorkflowRunBindingSchema.parse(handoffs.data[0].binding)
  for (const handoff of handoffs.data) {
    if (!sameBinding(binding, handoff.binding)) {
      return 'workflow_binding_mismatch'
    }
    const candidates = reviews.data.filter(
      (review) => review.subjectHandoffRef === handoff.handoffRef
    )
    if (candidates.length !== 1 || candidates[0].decision !== 'approved') {
      return 'workflow_review_not_approved'
    }
    const reason = workflowReviewBindingRefusal(handoff, candidates[0])
    if (reason) {
      return reason
    }
  }
  return null
}
