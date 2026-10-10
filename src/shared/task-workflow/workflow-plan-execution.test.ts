import { describe, expect, it } from 'vitest'
import { workflowPlanGraphFixture } from '../hive-workflow-plan-runs.test-fixture'
import { workflowTestVectors } from './workflow.test-fixture'
import { WorkflowPlanExecutionSchema } from './workflow-plan-execution'
import { WorkflowExecutionContextSchema } from './workflow-execution-context'

describe('adopted plan execution context', () => {
  it('keeps graph execution separate from recursive plan intent', () => {
    const { admission, source } = workflowPlanGraphFixture()
    const context = admission.workflowContext
    expect(WorkflowExecutionContextSchema.safeParse(context).success).toBe(true)
    context.planIntent = source.draft.intent
    expect(WorkflowExecutionContextSchema.safeParse(context).success).toBe(false)
    delete context.planIntent
    context.stageRef = 'different-task'
    expect(WorkflowExecutionContextSchema.safeParse(context).success).toBe(false)
  })
  it('rejects duplicate dependency tasks, outcomes, and foreign companies', () => {
    const { admission } = workflowPlanGraphFixture()
    const plan = admission.workflowContext.planExecution!
    const producer = structuredClone(workflowTestVectors.examples.handoff.producer)
    producer.task.spaceId = plan.sourceTask.spaceId
    const dependency = {
      proposalTaskRef: 'predecessor',
      producer,
      outcomeRef: 'outcome:prior',
      outcomeVersion: workflowTestVectors.examples.handoff.artifact
    }
    plan.dependencyOutcomes = [dependency]
    expect(WorkflowPlanExecutionSchema.safeParse(plan).success).toBe(true)
    plan.dependencyOutcomes.push({ ...dependency, outcomeRef: 'outcome:other' })
    expect(WorkflowPlanExecutionSchema.safeParse(plan).success).toBe(false)
    plan.dependencyOutcomes[1] = { ...dependency, proposalTaskRef: 'another' }
    expect(WorkflowPlanExecutionSchema.safeParse(plan).success).toBe(false)
    plan.dependencyOutcomes = [
      { ...dependency, producer: { ...producer, task: { ...producer.task, spaceId: 'foreign' } } }
    ]
    expect(WorkflowPlanExecutionSchema.safeParse(plan).success).toBe(false)
  })
  it('preserves the independent fixed-code tester guard', () => {
    const { admission } = workflowPlanGraphFixture()
    admission.workflowContext.role = 'tester'
    expect(WorkflowExecutionContextSchema.safeParse(admission.workflowContext).success).toBe(false)
  })
})
