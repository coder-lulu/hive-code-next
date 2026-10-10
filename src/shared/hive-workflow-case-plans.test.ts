import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'
import { workflowPlanDraftFixture } from './task-workflow/workflow-plan-draft.test-fixture'
import type { WorkflowPlanDraft } from './task-workflow/workflow-plan-draft'

function caseWithPlan() {
  const { view } = workflowCaseFixture()
  const stage = view.stageTasks.find((item) => item.role === 'product')!
  const base = workflowPlanDraftFixture()
  const intent = {
    ...base.intent,
    stageRef: stage.stageRef,
    employeeRef: stage.employeeRef,
    sourceTask: {
      ...base.intent.sourceTask,
      spaceId: view.binding.scope.companyRef,
      taskId: stage.taskId,
      runId: randomUUID()
    },
    facts: {
      ...base.intent.facts,
      binding: view.binding,
      definitionDigest: view.definitionDigest,
      goalRef: view.originTaskId,
      planRevision: 7
    }
  }
  const draft: WorkflowPlanDraft = {
    ...base,
    intent,
    producer: { ...base.producer, employeeRef: stage.employeeRef, task: intent.sourceTask },
    artifact: undefined,
    inspection: { kind: 'unavailable', reason: 'plan_artifact_missing' }
  }
  return { ...view, planningIntent: intent, planDrafts: [draft] }
}

describe('Case plan projection consistency', () => {
  it('allows truthful absence and an independent original plan revision', () => {
    expect(HiveWorkflowCaseViewSchema.safeParse(workflowCaseFixture().view).success).toBe(true)
    const view = caseWithPlan()
    expect(view.planningIntent.facts.planRevision).not.toBe(view.revision)
    expect(HiveWorkflowCaseViewSchema.safeParse(view).success).toBe(true)
  })

  it.each(['planningIntent', 'planDrafts'] as const)('requires explicit %s', (key) => {
    expect(
      HiveWorkflowCaseViewSchema.safeParse({ ...caseWithPlan(), [key]: undefined }).success
    ).toBe(false)
  })

  it('rejects cross-Case, cross-stage and reassigned planning intents', () => {
    const view = caseWithPlan()
    const original = view.planningIntent
    const changes = [
      { facts: { ...original.facts, goalRef: randomUUID() } },
      { facts: { ...original.facts, definitionDigest: 'a'.repeat(64) } },
      {
        facts: {
          ...original.facts,
          binding: { ...original.facts.binding, workflowRunRef: randomUUID() }
        }
      },
      { stageRef: view.stageTasks.find((item) => item.role === 'developer')!.stageRef },
      { employeeRef: randomUUID() },
      { sourceTask: { ...original.sourceTask, taskId: randomUUID() } },
      { sourceTask: { ...original.sourceTask, attempt: 4 } }
    ]
    for (const change of changes) {
      expect(
        HiveWorkflowCaseViewSchema.safeParse({
          ...view,
          planningIntent: { ...original, ...change }
        }).success
      ).toBe(false)
      expect(
        HiveWorkflowCaseViewSchema.safeParse({
          ...view,
          planDrafts: [{ ...view.planDrafts[0], intent: { ...original, ...change } }]
        }).success
      ).toBe(false)
    }
  })

  it('rejects duplicated draft, original intent and plan revision identities', () => {
    const view = caseWithPlan()
    const first = view.planDrafts[0]
    const second = structuredClone(first)
    second.draftRef = 'draft-second'
    second.intent.intentRef = 'intent-second'
    second.intent.facts.planRevision++
    second.intent.sourceTask.runId = randomUUID()
    second.intent.sourceTask.attempt = 2
    second.producer.task = { ...second.intent.sourceTask }
    expect(
      HiveWorkflowCaseViewSchema.safeParse({ ...view, planDrafts: [first, second] }).success
    ).toBe(true)
    for (const changed of [
      { ...second, draftRef: first.draftRef },
      { ...second, intent: { ...second.intent, intentRef: first.intent.intentRef } },
      {
        ...second,
        intent: {
          ...second.intent,
          facts: { ...second.intent.facts, planRevision: first.intent.facts.planRevision }
        }
      }
    ]) {
      expect(
        HiveWorkflowCaseViewSchema.safeParse({ ...view, planDrafts: [first, changed] }).success
      ).toBe(false)
    }
  })

  it('bounds draft collection to original Product attempt capacity', () => {
    const view = caseWithPlan()
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...view,
        planDrafts: Array(4).fill(view.planDrafts[0])
      }).success
    ).toBe(false)
  })
})
