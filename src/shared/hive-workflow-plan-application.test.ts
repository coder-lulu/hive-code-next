import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import { workflowPlanDraftFixture } from './task-workflow/workflow-plan-draft.test-fixture'
import { compareWorkflowPlans } from './task-workflow/workflow-plan-diff'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'
import { workflowPlanApplicationFixture } from './hive-workflow-plan-application.test-fixture'
import {
  HiveWorkflowPlanApplySchema,
  HiveWorkflowPlanApplicationViewSchema,
  HiveWorkflowPlanApplicationReceiptSchema,
  HiveWorkflowPlanApplyReplySchema,
  type HiveWorkflowPlanApplicationView
} from './hive-workflow-plan-application'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture(): HiveWorkflowPlanApplicationView {
  const draft = workflowPlanDraftFixture()
  const facts = draft.intent.facts
  facts.binding.scope.projectRef = id(1)
  facts.binding.workflowRunRef = id(2)
  facts.goalRef = id(3)
  if (draft.inspection.kind !== 'validated') {
    throw new Error('invalid fixture')
  }
  const proposal = draft.inspection.proposal
  proposal.binding = structuredClone(facts.binding)
  proposal.goalRef = facts.goalRef
  proposal.tasks.push({
    ...proposal.tasks[0],
    taskRef: 'second',
    dependsOn: [proposal.tasks[0].taskRef]
  })
  draft.inspection = inspectWorkflowPlanProposal(proposal, facts)
  return {
    caseId: id(2),
    projectId: id(1),
    caseRevision: 1,
    currentProjectBindingRevision: 1,
    draft,
    baseline: null,
    diff: compareWorkflowPlans(proposal, null),
    eligibility: { available: false, reason: 'already_applied' },
    application: {
      contractVersion: 1,
      kind: 'workflow.plan-application',
      applicationRef: id(4),
      requestId: id(5),
      binding: structuredClone(facts.binding),
      planRevision: 1,
      draftRef: draft.draftRef,
      draftDigest: digest(draft),
      proposalDigest: digest(proposal),
      projectBindingRevision: 1,
      parentTaskRef: facts.goalRef,
      appliedAt: '2026-10-10T00:00:00.000Z',
      createdTaskRefs: proposal.tasks.map((task, i) => ({
        proposalTaskRef: task.taskRef,
        taskId: id(6 + i),
        employeeRef: id(10),
        dependsOnTaskIds: i === 0 ? [] : [id(6)]
      })),
      dispatch: { available: false, reason: 'task_graph_dispatch_unavailable' }
    },
    taskStates: [6, 7].map((n) => ({ taskId: id(n), status: 'todo', taskRevision: 0 }))
  }
}

describe('workflow plan application contract', () => {
  it('provides an original Case-bound integration fixture', () => {
    const fixture = workflowPlanApplicationFixture()
    expect(fixture.caseView.planDrafts[0]).toEqual(fixture.draft)
    expect(HiveWorkflowPlanApplicationViewSchema.safeParse(fixture.view).success).toBe(true)
  })
  it('validates exact adoption and reordered mapping projections', () => {
    const view = fixture()
    expect(HiveWorkflowPlanApplicationViewSchema.safeParse(view).success).toBe(true)
    view.application!.createdTaskRefs.reverse()
    view.taskStates.reverse()
    expect(HiveWorkflowPlanApplicationViewSchema.safeParse(view).success).toBe(true)
  })
  it('rejects provenance, mapping, state and diff mutations', () => {
    const mutations: ((view: HiveWorkflowPlanApplicationView) => void)[] = [
      (view) => {
        view.draft.sourceInputDigest = '0'.repeat(64)
      },
      (view) => {
        view.application!.proposalDigest = '0'.repeat(64)
      },
      (view) => {
        view.application!.parentTaskRef = id(99)
      },
      (view) => {
        view.application!.createdTaskRefs[1].dependsOnTaskIds = []
      },
      (view) => {
        view.application!.createdTaskRefs[0].proposalTaskRef = 'invented'
      },
      (view) => {
        view.taskStates.pop()
      },
      (view) => {
        view.taskStates[1].taskId = view.taskStates[0].taskId
      },
      (view) => {
        view.diff!.addedTaskRefs = []
      },
      (view) => {
        view.caseId = id(99)
      },
      (view) => {
        view.eligibility = { available: true }
      }
    ]
    for (const mutate of mutations) {
      const view = fixture()
      mutate(view)
      expect(HiveWorkflowPlanApplicationViewSchema.safeParse(view).success).toBe(false)
    }
  })
  it('rejects cyclic, duplicate and external dependency receipts', () => {
    for (const dependencies of [[id(7)], [id(99)], [id(6), id(6)]]) {
      const receipt = fixture().application!
      receipt.createdTaskRefs[0].dependsOnTaskIds = dependencies
      expect(HiveWorkflowPlanApplicationReceiptSchema.safeParse(receipt).success).toBe(false)
    }
  })
  it('supports selecting a newer draft after the single case adoption', () => {
    const view = fixture()
    view.baseline = structuredClone(view.draft)
    view.draft.draftRef = 'new-draft'
    view.draft.intent.facts.planRevision = 2
    if (
      view.draft.inspection.kind !== 'validated' ||
      view.baseline.inspection.kind !== 'validated'
    ) {
      throw new Error('invalid fixture')
    }
    view.draft.inspection.proposal.planRevision = 2
    view.diff = compareWorkflowPlans(
      view.draft.inspection.proposal,
      view.baseline.inspection.proposal
    )
    view.eligibility = { available: false, reason: 'plan_replacement_unavailable' }
    expect(HiveWorkflowPlanApplicationViewSchema.safeParse(view).success).toBe(true)
    view.baseline.intent.facts.goalRef = 'wrong-goal'
    expect(HiveWorkflowPlanApplicationViewSchema.safeParse(view).success).toBe(false)
  })
  it('bounds admission inputs and binds reply admission to the receipt', () => {
    const view = fixture()
    const input = {
      caseId: view.caseId,
      projectId: view.projectId,
      draftRef: view.draft.draftRef,
      requestId: id(5),
      expectedCaseRevision: 1,
      expectedProjectRevision: 1,
      planRevision: 1,
      draftDigest: digest(view.draft)
    }
    expect(HiveWorkflowPlanApplySchema.safeParse(input).success).toBe(true)
    expect(
      HiveWorkflowPlanApplySchema.safeParse({ ...input, expectedCaseRevision: 2_147_483_648 })
        .success
    ).toBe(false)
    expect(HiveWorkflowPlanApplySchema.safeParse({ ...input, dispatch: true }).success).toBe(false)
    const reply = {
      admission: { requestId: id(5), payloadFingerprint: 'a'.repeat(64), replayed: true },
      view
    }
    expect(HiveWorkflowPlanApplyReplySchema.safeParse(reply).success).toBe(true)
    reply.admission.requestId = id(99)
    expect(HiveWorkflowPlanApplyReplySchema.safeParse(reply).success).toBe(true)
    reply.admission.replayed = false
    expect(HiveWorkflowPlanApplyReplySchema.safeParse(reply).success).toBe(false)
  })
  it('bundles the public contract for browsers without Node builtins', async () => {
    const result = await build({
      entryPoints: ['src/shared/hive-workflow-plan-application.ts'],
      bundle: true,
      platform: 'browser',
      write: false,
      logLevel: 'silent'
    })
    expect(result.outputFiles[0].text).not.toContain('node:crypto')
  })
})
