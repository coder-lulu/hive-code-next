import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { hiveWorkflowStageContext } from './hive-workflow-stage-context'
import { hiveWorkflowStagePrompt } from './hive-workflow-stage-prompt'
import { WorkflowHandoffSchema, WorkflowReviewSchema } from './task-workflow/workflow-evidence'
import { workflowTestVectors } from './task-workflow/workflow.test-fixture'
import { workflowPlanIntentFixture } from './task-workflow/workflow-plan-draft.test-fixture'
import { WorkflowPlanProposalSchema } from './task-workflow/workflow-plan-proposal'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'

function plannedProduct() {
  const f = workflowCaseFixture()
  const task = f.view.stageTasks.find((item) => item.role === 'product')!
  const planningIntent = workflowPlanIntentFixture()
  planningIntent.sourceTask = {
    spaceId: f.view.binding.scope.companyRef,
    taskId: task.taskId,
    runId: randomUUID(),
    attempt: 1,
    taskRevision: String(task.taskRevision + 1)
  }
  planningIntent.stageRef = task.stageRef
  planningIntent.employeeRef = task.employeeRef
  planningIntent.facts.binding = f.view.binding
  planningIntent.facts.definitionDigest = f.view.definitionDigest
  planningIntent.facts.goalRef = f.view.originTaskId
  planningIntent.facts.planRevision = 7
  planningIntent.facts.limits.maxParallelism = f.workflow.definition.maxParallelism
  planningIntent.facts.limits.maxDurationMs = f.workflow.definition.maxDurationMs
  return { ...f, task, planningIntent, view: { ...f.view, planningIntent } }
}

function handoff(role: 'product' | 'developer', attempt = 1, f = workflowCaseFixture()) {
  const task = f.view.stageTasks.find((stage) => stage.role === role)!
  const consumer = f.view.stageTasks.find(
    (stage) => stage.role === (role === 'product' ? 'developer' : 'tester')
  )!
  const example = workflowTestVectors.examples.handoff
  const value = WorkflowHandoffSchema.parse({
    ...example,
    handoffRef: `handoff:${role}:${attempt}`,
    binding: f.view.binding,
    stageRef: task.stageRef,
    producer: {
      ...example.producer,
      role,
      employeeRef: task.employeeRef,
      task: {
        ...example.producer.task,
        spaceId: f.view.binding.scope.companyRef,
        taskId: task.taskId,
        runId: randomUUID(),
        attempt
      }
    },
    consumer: {
      stageRef: consumer.stageRef,
      employeeRef: consumer.employeeRef,
      role: consumer.role
    },
    audienceScope: { scope: f.view.binding.scope, employeeRefs: [consumer.employeeRef] },
    ...(role === 'developer'
      ? {
          codeVersion: { kind: 'snapshot', snapshot: example.artifact, treeDigest: 'a'.repeat(64) }
        }
      : { codeVersion: undefined }),
    dependencyVersions: []
  })
  return { ...f, task, consumer, value }
}

function testedCase(decision: 'approved' | 'changes_requested') {
  const f = handoff('developer')
  const task = f.view.stageTasks.find((item) => item.role === 'tester')!
  const consumer = f.view.stageTasks.find(
    (item) => item.role === (decision === 'approved' ? 'ops' : 'developer')
  )!
  const tested = WorkflowHandoffSchema.parse({
    ...f.value,
    handoffRef: 'handoff:tester',
    stageRef: task.stageRef,
    producer: {
      ...f.value.producer,
      employeeRef: task.employeeRef,
      role: 'tester',
      task: { ...f.value.producer.task, taskId: task.taskId, runId: randomUUID() }
    },
    consumer: {
      stageRef: consumer.stageRef,
      employeeRef: consumer.employeeRef,
      role: consumer.role
    },
    audienceScope: { scope: f.view.binding.scope, employeeRefs: [consumer.employeeRef] }
  })
  const review = WorkflowReviewSchema.parse({
    contractVersion: 1,
    kind: 'workflow.review',
    reviewRef: 'review:tester',
    binding: f.view.binding,
    stageRef: task.stageRef,
    subjectHandoffRef: f.value.handoffRef,
    artifact: f.value.artifact,
    codeVersion: f.value.codeVersion,
    reviewer: tested.producer,
    decision,
    testReport: tested.artifact
  })
  const product = handoff('product', 1, f).value
  return {
    ...f,
    tested,
    review,
    consumer,
    view: { ...f.view, handoffs: [product, f.value, tested], reviews: [review] }
  }
}

describe('accepted workflow business inputs', () => {
  it('requires real planning intent for a new Product context and prompt', () => {
    const f = workflowCaseFixture()
    const product = f.view.stageTasks.find((item) => item.role === 'product')!
    expect(() => hiveWorkflowStageContext(f.view, product.stageRef)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(() => hiveWorkflowStagePrompt(f.view, product.stageRef)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    const planned = plannedProduct()
    expect(hiveWorkflowStageContext(planned.view, planned.task.stageRef).planIntent).toEqual(
      planned.planningIntent
    )
  })
  it.each(['goal', 'task', 'stage', 'employee', 'binding', 'definition'] as const)(
    'rejects replaced Product planning %s',
    (field) => {
      const f = plannedProduct()
      if (field === 'goal') {
        f.planningIntent.facts.goalRef = randomUUID()
      } else if (field === 'task') {
        f.planningIntent.sourceTask.taskId = randomUUID()
      } else if (field === 'stage') {
        f.planningIntent.stageRef = 'stage-foreign'
      } else if (field === 'employee') {
        f.planningIntent.employeeRef = randomUUID()
      } else if (field === 'binding') {
        f.planningIntent.facts.binding = {
          ...f.planningIntent.facts.binding,
          workflowRunRef: randomUUID()
        }
      } else {
        f.planningIntent.facts.definitionDigest = '0'.repeat(64)
      }
      expect(() => hiveWorkflowStageContext(f.view, f.task.stageRef)).toThrow()
    }
  )
  it('uses only frozen intent facts for the three-role proposal sample while preserving original requirement', () => {
    const f = plannedProduct()
    f.planningIntent.facts.limits.maxAttempts = 1
    const original = JSON.stringify(f.view)
    const immutableInput =
      'Original synthetic Product input, retained before any later description edit.'
    const prompt = hiveWorkflowStagePrompt(
      { ...f.view, requirement: 'Changed synthetic requirement.' },
      f.task.stageRef,
      immutableInput
    )
    const line = prompt
      .split('\n')
      .find((item) => item.startsWith('{"contractVersion":1,"kind":"workflow.plan-proposal"'))
    expect(line).toBeDefined()
    const proposal = WorkflowPlanProposalSchema.parse(JSON.parse(line!))
    expect(inspectWorkflowPlanProposal(proposal, f.planningIntent.facts).kind).toBe('validated')
    expect(proposal.binding).toEqual(f.planningIntent.facts.binding)
    expect(proposal.definitionDigest).toBe(f.planningIntent.facts.definitionDigest)
    expect(proposal.goalRef).toBe(f.view.originTaskId)
    expect(proposal.planRevision).toBe(7)
    expect(proposal.tasks.map((item) => item.requestedRole)).toEqual(['developer', 'tester', 'ops'])
    expect(proposal.tasks.map((item) => item.dependsOn)).toEqual([
      [],
      ['implementation'],
      ['independent-test']
    ])
    expect(proposal.requestedLimits).toEqual({
      maxParallelism: f.planningIntent.facts.limits.maxParallelism,
      maxDurationMs: f.planningIntent.facts.limits.maxDurationMs
    })
    expect(proposal).not.toHaveProperty('resourceSelectionRefs')
    expect(proposal).not.toHaveProperty('knowledgeRequirements')
    expect(proposal.requestedLimits).not.toHaveProperty('budget')
    expect(prompt).toContain('plan-proposal.json')
    expect(prompt).toContain('include both files in the original result manifest')
    expect(prompt).toContain(immutableInput)
    expect(prompt).not.toContain('Changed synthetic requirement.')
    expect(prompt).toContain(f.workflow.definition.stages[0].acceptanceCriteria.join('\n'))
    expect(prompt).toContain('existing fixed four-role workflow remains the execution path')
    expect(JSON.stringify(f.view)).toBe(original)
  })
  it.each(['task-count', 'role'] as const)(
    'refuses a sample incompatible with the actual frozen %s policy',
    (boundary) => {
      const f = plannedProduct()
      if (boundary === 'task-count') {
        f.planningIntent.facts.limits.maxTasks = 2
      } else {
        f.planningIntent.facts.authorizedRoles = ['product', 'developer', 'tester']
      }
      expect(() => hiveWorkflowStagePrompt(f.view, f.task.stageRef)).toThrow(
        'CAPABILITY_UNAVAILABLE'
      )
    }
  )
  it('requires explicit bounded handoff/review arrays in every Case view', () => {
    const f = workflowCaseFixture()
    const absent = { ...f.view }
    Reflect.deleteProperty(absent, 'handoffs')
    Reflect.deleteProperty(absent, 'reviews')
    expect(HiveWorkflowCaseViewSchema.safeParse(absent).success).toBe(false)
  })
  it('refuses a Developer stage without its accepted Product dependency', () => {
    const f = workflowCaseFixture()
    const stage = f.view.stageTasks.find((item) => item.role === 'developer')!
    expect(() => hiveWorkflowStageContext(f.view, stage.stageRef)).toThrow('CAPABILITY_UNAVAILABLE')
  })
  it('uses the accepted Product handoff in the Developer context and prompt', () => {
    const f = handoff('product')
    const view = { ...f.view, handoffs: [f.value], reviews: [] }
    expect(hiveWorkflowStageContext(view, f.consumer.stageRef).handoffRefs).toEqual([
      f.value.handoffRef
    ])
    expect(hiveWorkflowStagePrompt(view, f.consumer.stageRef)).toContain(f.value.summary)
  })
  it('pins Tester input to the exact latest accepted Developer snapshot and producer', () => {
    const f = handoff('developer', 2)
    const view = { ...f.view, handoffs: [f.value], reviews: [] }
    const context = hiveWorkflowStageContext(view, f.consumer.stageRef)
    expect(context.codeInput).toEqual({ producer: f.value.producer, version: f.value.codeVersion })
    const prompt = hiveWorkflowStagePrompt(view, f.consumer.stageRef)
    expect(prompt).toContain('review.json')
    expect(prompt).toContain('workflow.review-proposal')
    expect(prompt).toContain('testedCodeVersion')
  })
  it('never falls back to an earlier accepted attempt when the latest targets another stage', () => {
    const f = handoff('developer', 1)
    const latest = {
      ...f.value,
      handoffRef: 'handoff:latest',
      producer: {
        ...f.value.producer,
        task: { ...f.value.producer.task, attempt: 2, runId: randomUUID() }
      },
      consumer: { stageRef: f.task.stageRef, employeeRef: f.task.employeeRef, role: f.task.role },
      audienceScope: { scope: f.view.binding.scope, employeeRefs: [f.task.employeeRef] }
    }
    const view = { ...f.view, handoffs: [f.value, latest], reviews: [] }
    expect(() => hiveWorkflowStageContext(view, f.consumer.stageRef)).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
  })
  it('rejects ambiguous duplicate accepted attempts and foreign employees', () => {
    const f = handoff('developer')
    const duplicate = { ...f.value, handoffRef: 'handoff:duplicate' }
    expect(
      HiveWorkflowCaseViewSchema.safeParse({ ...f.view, handoffs: [f.value, duplicate] }).success
    ).toBe(false)
    const foreign = { ...f.value, producer: { ...f.value.producer, employeeRef: randomUUID() } }
    expect(HiveWorkflowCaseViewSchema.safeParse({ ...f.view, handoffs: [foreign] }).success).toBe(
      false
    )
  })
  const decisions: ('approved' | 'changes_requested')[] = ['approved', 'changes_requested']
  it.each(decisions)('keeps the tested Developer snapshot for %s consumers', (decision) => {
    const f = testedCase(decision)
    expect(hiveWorkflowStageContext(f.view, f.consumer.stageRef).codeInput).toEqual({
      producer: f.value.producer,
      version: f.value.codeVersion
    })
  })
  it('rejects approved review data targeted at Developer rework', () => {
    const f = testedCase('changes_requested')
    expect(() =>
      hiveWorkflowStageContext(
        { ...f.view, reviews: [{ ...f.review, decision: 'approved' }] },
        f.consumer.stageRef
      )
    ).toThrow('CAPABILITY_UNAVAILABLE')
  })
})
