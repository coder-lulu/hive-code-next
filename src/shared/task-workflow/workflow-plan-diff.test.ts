import { describe, expect, it } from 'vitest'
import { compareWorkflowPlans, WorkflowPlanDiffSchema } from './workflow-plan-diff'
import { workflowPlanProposalFixture } from './workflow-plan-proposal.test-fixture'

describe('workflow plan diff', () => {
  it('reports initial additions and deterministic task and field changes', () => {
    const before = workflowPlanProposalFixture()
    expect(compareWorkflowPlans(before, null).addedTaskRefs).toEqual(['research-test'])
    const next = structuredClone(before)
    next.planRevision++
    next.tasks[0].title = 'Updated research'
    next.tasks[0].acceptance.push('Second acceptance')
    next.requestedLimits.maxParallelism = 2
    next.tasks.push({ ...next.tasks[0], taskRef: 'added', dependsOn: ['research-test'] })
    expect(compareWorkflowPlans(next, before)).toEqual({
      addedTaskRefs: ['added'],
      removedTaskRefs: [],
      changedTasks: [{ taskRef: 'research-test', fields: ['title', 'acceptance'] }],
      changedPlanFields: ['requestedLimits']
    })
    const removed = structuredClone(next)
    removed.planRevision++
    removed.tasks = [removed.tasks[0]]
    expect(compareWorkflowPlans(removed, next).removedTaskRefs).toEqual(['added'])
  })
  it('ignores task, dependency and selection order but preserves acceptance order', () => {
    const before = workflowPlanProposalFixture()
    before.tasks.push(
      { ...before.tasks[0], taskRef: 'second' },
      {
        ...before.tasks[0],
        taskRef: 'third',
        dependsOn: ['research-test', 'second'],
        acceptance: ['First', 'Second']
      }
    )
    before.resourceSelectionRefs = ['resource-a', 'resource-b']
    before.requiredCoverage = 'managed_only'
    const next = structuredClone(before)
    next.planRevision++
    next.tasks.reverse()
    next.tasks[0].dependsOn.reverse()
    next.resourceSelectionRefs?.reverse()
    expect(compareWorkflowPlans(next, before).changedTasks).toEqual([])
    expect(compareWorkflowPlans(next, before).changedPlanFields).toEqual([])
    next.tasks[0].acceptance.reverse()
    expect(compareWorkflowPlans(next, before).changedTasks).toEqual([
      { taskRef: 'third', fields: ['acceptance'] }
    ])
  })
  it('rejects mismatched provenance and non-increasing revisions', () => {
    const before = workflowPlanProposalFixture()
    expect(() => compareWorkflowPlans(before, before)).toThrow()
    for (const mutate of [
      (plan: typeof before) => {
        plan.goalRef = 'other'
      },
      (plan: typeof before) => {
        plan.definitionDigest = 'b'.repeat(64)
      },
      (plan: typeof before) => {
        plan.binding.workflowRunRef = 'other'
      }
    ]) {
      const next = structuredClone(before)
      next.planRevision++
      mutate(next)
      expect(() => compareWorkflowPlans(next, before)).toThrow()
    }
  })
  it('rejects duplicate, overlapping and unbounded diff fields', () => {
    const diff = compareWorkflowPlans(workflowPlanProposalFixture(), null)
    expect(
      WorkflowPlanDiffSchema.safeParse({ ...diff, removedTaskRefs: diff.addedTaskRefs }).success
    ).toBe(false)
    expect(
      WorkflowPlanDiffSchema.safeParse({
        ...diff,
        changedPlanFields: ['requestedLimits', 'requestedLimits']
      }).success
    ).toBe(false)
    expect(
      WorkflowPlanDiffSchema.safeParse({
        ...diff,
        changedTasks: [{ taskRef: 'other', fields: ['title', 'title'] }]
      }).success
    ).toBe(false)
    expect(
      WorkflowPlanDiffSchema.safeParse({
        ...diff,
        addedTaskRefs: Array.from({ length: 33 }, (_, i) => `task-${i}`)
      }).success
    ).toBe(false)
  })
})
