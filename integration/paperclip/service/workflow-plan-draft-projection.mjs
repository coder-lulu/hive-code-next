import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { WorkflowPlanDraftSchema } from '../../../src/shared/task-workflow/workflow-plan-draft.ts'
import { inspectWorkflowPlanProposalJson } from '../../../src/shared/task-workflow/workflow-plan-validation.ts'
import { workflowRoleExecutionForAsset } from './workflow-native-role-execution.mjs'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

const sha = (value) => createHash('sha256').update(value).digest('hex')

function source(asset, input, intent) {
  const { context, producer } = asset.outcome
  if (
    context.role !== 'product' ||
    digest(context.planIntent) !== digest(intent) ||
    digest(input.workflowContext) !== digest(context) ||
    digest(intent.sourceTask) !== digest(producer.task) ||
    input.inputDigest !== digest(input.input)
  ) {
    refuse('REVISION_CONFLICT')
  }
  return {
    contractVersion: 1,
    kind: 'workflow.plan-draft',
    draftRef: `plan-draft:${digest([intent.intentRef, asset.version])}`,
    intent,
    producer: workflowRoleExecutionForAsset(asset),
    outcomeVersion: asset.version,
    sourceInputDigest: input.inputDigest
  }
}

/** Called after native delivery authentication; hash original bytes before parsing model data. */
export function createWorkflowPlanDraft(delivery, input, intent) {
  if (!intent) {
    return undefined
  }
  const asset = delivery.asset
  const base = source(asset, input, intent)
  const artifact = delivery.artifacts.find((item) => item.name === 'plan-proposal.json')
  const members = asset.outcome.artifacts.filter((item) => item.name === 'plan-proposal.json')
  if (members.length > 1 || Boolean(artifact) !== Boolean(members.length)) {
    refuse('REVISION_CONFLICT')
  }
  if (
    artifact &&
    (digest(artifact.version) !== digest(members[0].version) ||
      sha(artifact.text) !== artifact.version.digest ||
      artifact.version.artifactRef !==
        `artifact:${sha(
          JSON.stringify([
            asset.outcome.producer.commandFingerprint,
            artifact.name,
            artifact.version.digest
          ])
        )}`)
  ) {
    refuse('REVISION_CONFLICT')
  }
  return WorkflowPlanDraftSchema.parse({
    ...base,
    ...(artifact ? { artifact: artifact.version } : {}),
    inspection: artifact
      ? inspectWorkflowPlanProposalJson(artifact.text, intent.facts)
      : { kind: 'unavailable', reason: 'plan_artifact_missing' }
  })
}

export function validateWorkflowPlanDraft(draft, asset, input, intent) {
  if (!intent) {
    if (draft) {
      refuse('REVISION_CONFLICT')
    }
    return
  }
  const parsed = WorkflowPlanDraftSchema.safeParse(draft)
  if (!parsed.success) {
    refuse('REVISION_CONFLICT')
  }
  const expected = source(asset, input, intent)
  const { artifact, inspection, ...identity } = parsed.data
  const members = asset.outcome.artifacts.filter((item) => item.name === 'plan-proposal.json')
  if (
    digest(identity) !== digest(expected) ||
    members.length > 1 ||
    Boolean(artifact) !== Boolean(members.length) ||
    (artifact && digest(artifact) !== digest(members[0].version)) ||
    (inspection.kind === 'unavailable') !== (members.length === 0)
  ) {
    refuse('REVISION_CONFLICT')
  }
}
