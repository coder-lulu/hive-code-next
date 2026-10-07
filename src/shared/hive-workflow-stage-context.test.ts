import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { hiveWorkflowStageContext } from './hive-workflow-stage-context'
import { hiveWorkflowStagePrompt } from './hive-workflow-stage-prompt'
import { WorkflowHandoffSchema, WorkflowReviewSchema } from './task-workflow/workflow-evidence'
import { workflowTestVectors } from './task-workflow/workflow.test-fixture'

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
