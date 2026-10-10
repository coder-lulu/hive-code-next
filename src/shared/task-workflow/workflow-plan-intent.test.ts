import { describe, expect, it } from 'vitest'
import { WorkflowPlanIntentSchema } from './workflow-plan-intent'
import { workflowPlanIntentFixture } from './workflow-plan-draft.test-fixture'

describe('frozen server planning intent data', () => {
  it('preserves the per-run source and independent draft revision without defaults', () => {
    const intent = workflowPlanIntentFixture()
    intent.sourceTask.attempt = 2
    intent.facts.planRevision = 7
    const original = JSON.stringify(intent)
    expect(WorkflowPlanIntentSchema.parse(intent)).toEqual(intent)
    expect(JSON.stringify(intent)).toBe(original)
    expect(workflowPlanIntentFixture().sourceTask.attempt).toBe(1)
  })
  it('rejects a source task from another company', () => {
    const intent = workflowPlanIntentFixture()
    intent.sourceTask.spaceId = 'company-foreign'
    const parsed = WorkflowPlanIntentSchema.safeParse(intent)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toBe('workflow_plan_intent_source_mismatch')
    }
  })
  it.each([
    'contractVersion',
    'kind',
    'intentRef',
    'sourceTask',
    'stageRef',
    'employeeRef',
    'policyRef',
    'policyRevision',
    'facts'
  ])('requires the actual %s instead of deriving it from task metadata', (key) => {
    expect(
      WorkflowPlanIntentSchema.safeParse({ ...workflowPlanIntentFixture(), [key]: undefined })
        .success
    ).toBe(false)
  })
  it.each([
    { contractVersion: 2 },
    { kind: 'workflow.plan-proposal' },
    { policyRef: 'workflow.execution' },
    { policyRevision: 2 },
    { intentRef: 'https://test.invalid' }
  ])('rejects another intent contract or policy %j', (override) => {
    expect(
      WorkflowPlanIntentSchema.safeParse({ ...workflowPlanIntentFixture(), ...override }).success
    ).toBe(false)
  })
  it.each([
    'humanGoalDigest',
    'credential',
    'action',
    'authorized',
    'command',
    'owner',
    'producer',
    'sourceInputDigest'
  ])('rejects an added %s claim', (key) => {
    const intent = workflowPlanIntentFixture()
    expect(WorkflowPlanIntentSchema.safeParse({ ...intent, [key]: true }).success).toBe(false)
    expect(
      WorkflowPlanIntentSchema.safeParse({
        ...intent,
        sourceTask: { ...intent.sourceTask, [key]: true }
      }).success
    ).toBe(false)
    expect(
      WorkflowPlanIntentSchema.safeParse({ ...intent, facts: { ...intent.facts, [key]: true } })
        .success
    ).toBe(false)
    expect(
      WorkflowPlanIntentSchema.safeParse({
        ...intent,
        facts: { ...intent.facts, limits: { ...intent.facts.limits, [key]: true } }
      }).success
    ).toBe(false)
  })
  it('rejects invalid revision, unknown role and an unbounded policy snapshot', () => {
    const intent = workflowPlanIntentFixture()
    expect(
      WorkflowPlanIntentSchema.safeParse({ ...intent, facts: { ...intent.facts, planRevision: 0 } })
        .success
    ).toBe(false)
    expect(
      WorkflowPlanIntentSchema.safeParse({
        ...intent,
        facts: { ...intent.facts, authorizedRoles: ['owner'] }
      }).success
    ).toBe(false)
    expect(
      WorkflowPlanIntentSchema.safeParse({
        ...intent,
        facts: { ...intent.facts, limits: { ...intent.facts.limits, maxTasks: 33 } }
      }).success
    ).toBe(false)
  })
})
