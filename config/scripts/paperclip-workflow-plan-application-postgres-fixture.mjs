import { randomUUID } from 'node:crypto'
import { workflowStageAdmissionFixture } from './paperclip-workflow-stage-admission-postgres-fixture.mjs'
import { workflowConsumerDelivery } from './paperclip-workflow-consumer-postgres-fixture.mjs'
import { workflowPlanProposalFixture } from '../../src/shared/task-workflow/workflow-plan-proposal.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
export async function createPlanApplicationPostgresFixture(
  h,
  complete = true,
  failed = false,
  transformProposal,
  maxParallelism = 1,
  requirement
) {
  const f = await workflowStageAdmissionFixture(h, 600_000, maxParallelism, requirement)
  const facts = f.first.workflowContext.planIntent.facts
  const proposal = {
    ...workflowPlanProposalFixture(),
    binding: facts.binding,
    goalRef: facts.goalRef,
    definitionDigest: facts.definitionDigest,
    planRevision: facts.planRevision,
    resourceSelectionRefs: ['resource:synthetic'],
    requiredCoverage: 'managed_only',
    requestedLimits: {
      maxParallelism: 1,
      maxDurationMs: 60_000,
      budget: { costMicros: 500, currency: 'USD' }
    },
    knowledgeRequirements: [{ sourceRef: 'knowledge:synthetic', required: true }]
  }
  proposal.tasks.push({
    ...proposal.tasks[0],
    taskRef: 'build',
    requestedRole: 'developer',
    outputKind: 'code',
    dependsOn: [proposal.tasks[0].taskRef]
  })
  transformProposal?.(proposal)
  let delivery = await workflowConsumerDelivery(h, f, f.first, {
    planText: JSON.stringify(proposal),
    ...(failed ? { status: 'failed' } : {})
  })
  await delivery.consume()
  const next = await delivery.next(failed ? 'product' : 'developer')
  if (complete && !failed) {
    for (const [role, successor] of [
      ['developer', 'tester'],
      ['tester', 'ops'],
      ['ops', null]
    ]) {
      const admission = await delivery.next(role)
      delivery = await workflowConsumerDelivery(h, f, admission)
      await delivery.consume()
      if (successor) {
        await delivery.next(successor)
      }
    }
  }
  const view = await f.read(),
    draft = view.planDrafts[0]
  const input = {
    requestId: randomUUID(),
    projectId: f.project.id,
    caseId: view.id,
    draftRef: draft.draftRef,
    expectedCaseRevision: view.revision,
    expectedProjectRevision: view.projectBindingRevision,
    planRevision: draft.intent.facts.planRevision,
    draftDigest: digest(draft)
  }
  return {
    ...f,
    view,
    draft,
    input,
    proposal,
    next,
    query: { projectId: f.project.id, caseId: view.id, draftRef: draft.draftRef }
  }
}
