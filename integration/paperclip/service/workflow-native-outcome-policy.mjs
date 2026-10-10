import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { WorkflowNativeDeliverySchema } from '../../../src/shared/task-workflow/workflow-native-delivery.ts'
import { WorkflowReviewProposalSchema } from '../../../src/shared/task-workflow/workflow-review-proposal.ts'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'
import {
  selectWorkflowRoleArtifact,
  workflowRoleReportNames
} from '../../../src/shared/task-workflow/workflow-role-artifacts.ts'

const sha = (value) => createHash('sha256').update(value).digest('hex')
const identityKeys = [
  'protocolVersion',
  'runtimeRecordId',
  'ownershipEpoch',
  'executionId',
  'executionEpoch',
  'operationId',
  'executionAccountRef',
  'workspaceRef',
  'workspaceExecutionClaimRef',
  'writeFence'
]

/** These checks bind data to the already authenticated original task; they do not authorize a kernel call. */
export function validateWorkflowNativeOutcome(task, receipt, rawDelivery) {
  const delivery = WorkflowNativeDeliverySchema.parse(rawDelivery)
  const { asset } = delivery,
    outcome = asset.outcome,
    producer = outcome.producer
  const command = task.binding.command
  const assetDigest = sha(JSON.stringify(outcome))
  if (
    asset.version.digest !== assetDigest ||
    asset.version.artifactRef !== `artifact:${assetDigest}` ||
    producer.commandFingerprint !== task.binding.commandFingerprint ||
    identityKeys.some((key) => producer[key] !== command[key]) ||
    digest(producer.task) !== digest(command.task) ||
    digest(producer.ownerScope) !== digest(command.ownerScope) ||
    digest(outcome.context) !== digest(command.workflowContext) ||
    producer.status !== receipt.status ||
    producer.outcomeRef !== receipt.outcomeRef ||
    producer.resultDigest !== digest(receipt) ||
    producer.operationCallerKey !== 'trusted-local:runtime' ||
    digest(outcome.artifacts.map((artifact) => artifact.version.artifactRef)) !==
      digest(receipt.artifactRefs)
  ) {
    refuse('IDEMPOTENCY_CONFLICT')
  }
  for (const artifact of delivery.artifacts) {
    const contentDigest = sha(artifact.text)
    if (
      artifact.version.digest !== contentDigest ||
      artifact.version.artifactRef !==
        `artifact:${sha(JSON.stringify([producer.commandFingerprint, artifact.name, contentDigest]))}`
    ) {
      refuse('IDEMPOTENCY_CONFLICT')
    }
  }
  const facts = delivery.commands
  if (facts?.kind === 'available') {
    const contentDigest = sha(JSON.stringify(facts))
    if (
      outcome.commands.kind !== 'available' ||
      outcome.commands.artifact.digest !== contentDigest ||
      outcome.commands.artifact.artifactRef !== `artifact:${contentDigest}`
    ) {
      refuse('IDEMPOTENCY_CONFLICT')
    }
  }
  const selectDelivered = (name) => {
    let member
    try {
      member = selectWorkflowRoleArtifact(outcome.artifacts, name)
    } catch {
      refuse('IDEMPOTENCY_CONFLICT')
    }
    return (
      member &&
      delivery.artifacts.find(
        (artifact) =>
          artifact.name === member.name && digest(artifact.version) === digest(member.version)
      )
    )
  }
  const report = selectDelivered(workflowRoleReportNames[outcome.context.role])
  const reviewArtifact =
    outcome.context.role === 'tester' ? selectDelivered('review.json') : undefined
  let proposal
  if (outcome.context.role === 'tester' && reviewArtifact) {
    try {
      proposal = WorkflowReviewProposalSchema.parse(
        JSON.parse(reviewArtifact.text.replace(/^\uFEFF/, ''))
      )
    } catch {
      refuse('REVISION_CONFLICT')
    }
    if (digest(proposal.testedCodeVersion) !== digest(outcome.context.codeInput?.version)) {
      refuse('REVISION_CONFLICT')
    }
  }
  return { delivery, report, reviewArtifact, proposal }
}
