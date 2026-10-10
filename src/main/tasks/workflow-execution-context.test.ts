import { describe, expect, it } from 'vitest'
import { WorkflowExecutionContextSchema } from '../../shared/task-workflow/workflow-execution-context'
import { workflowTestVectors } from '../../shared/task-workflow/workflow.test-fixture'
import { TaskExecutionStartSchema } from '../../shared/task-execution/task-execution-command'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { taskCommand } from './task-execution.test-fixture'
import { workflowPlanIntentFixture } from '../../shared/task-workflow/workflow-plan-draft.test-fixture'

function productContext() {
  const { codeInput: _codeInput, ...value } = context()
  const planIntent = workflowPlanIntentFixture()
  planIntent.facts.binding = value.binding
  planIntent.facts.definitionDigest = value.definitionDigest
  planIntent.sourceTask.spaceId = value.binding.scope.companyRef
  planIntent.stageRef = value.stageRef
  planIntent.employeeRef = value.employeeRef
  return WorkflowExecutionContextSchema.parse({ ...value, role: 'product', planIntent })
}

function plannedCommand() {
  const workflowContext = productContext()
  const command = taskCommand()
  return TaskExecutionStartSchema.parse({
    ...command,
    executionDeadlineAt: command.expiresAt,
    task: { ...workflowContext.planIntent!.sourceTask },
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'c'.repeat(64)}`
    },
    workflowContext
  })
}

function context() {
  const handoff = workflowTestVectors.examples.handoff
  return WorkflowExecutionContextSchema.parse({
    kind: 'workflow.execution-context',
    binding: handoff.binding,
    definitionDigest: 'a'.repeat(64),
    stageRef: handoff.consumer.stageRef,
    employeeRef: handoff.consumer.employeeRef,
    role: 'tester',
    handoffRefs: [handoff.handoffRef],
    codeInput: {
      producer: handoff.producer,
      version: {
        kind: 'snapshot',
        snapshot: handoff.artifact,
        treeDigest: handoff.codeVersion?.treeDigest ?? 'b'.repeat(64)
      }
    }
  })
}

describe('host-bound workflow execution metadata', () => {
  it('binds a fixed independent tester source without accepting execution authority fields', () => {
    const value = context()
    expect(WorkflowExecutionContextSchema.parse(value)).toEqual(value)
    for (const field of ['sourcePath', 'force', 'systemActor', 'readonly', 'authorized']) {
      expect(WorkflowExecutionContextSchema.safeParse({ ...value, [field]: true }).success).toBe(
        false
      )
    }
  })
  it.each(['missing', 'self', 'role', 'company', 'duplicate'] as const)(
    'rejects invalid tester metadata: %s',
    (boundary) => {
      const value = context()
      if (boundary === 'missing') {
        value.codeInput = undefined
      }
      if (boundary === 'self' && value.codeInput) {
        value.codeInput.producer.employeeRef = value.employeeRef
      }
      if (boundary === 'role' && value.codeInput) {
        value.codeInput.producer.role = 'product'
      }
      if (boundary === 'company' && value.codeInput) {
        value.codeInput.producer.task.spaceId = 'company:foreign'
      }
      if (boundary === 'duplicate') {
        value.handoffRefs.push(value.handoffRefs[0])
      }
      expect(WorkflowExecutionContextSchema.safeParse(value).success).toBe(false)
    }
  )
  it('allows an initial product context with no earlier code source', () => {
    const { codeInput, ...value } = context()
    expect(codeInput).toBeDefined()
    expect(WorkflowExecutionContextSchema.safeParse({ ...value, role: 'product' }).success).toBe(
      true
    )
  })
  it('keeps historical absent planning intent absent and preserves actual Product intent', () => {
    expect(WorkflowExecutionContextSchema.parse(context())).not.toHaveProperty('planIntent')
    const product = productContext()
    expect(WorkflowExecutionContextSchema.parse(product)).toEqual(product)
  })
  it.each(['binding', 'definitionDigest', 'stageRef', 'employeeRef'] as const)(
    'rejects Product planning intent whose %s differs from its frozen context',
    (field) => {
      const product = productContext()
      const intent = product.planIntent!
      if (field === 'binding') {
        intent.facts.binding = { ...intent.facts.binding, workflowRunRef: 'case-foreign' }
      } else if (field === 'definitionDigest') {
        intent.facts.definitionDigest = '0'.repeat(64)
      } else {
        intent[field] = 'foreign-test'
      }
      expect(WorkflowExecutionContextSchema.safeParse(product).success).toBe(false)
    }
  )
  it.each(['developer', 'tester', 'ops'] as const)(
    'rejects planning intent on a %s context',
    (role) => {
      const value = context()
      const intent = productContext().planIntent
      expect(
        WorkflowExecutionContextSchema.safeParse({ ...value, role, planIntent: intent }).success
      ).toBe(false)
    }
  )
  it('includes the independently allocated plan revision in the command fingerprint', () => {
    const controlled = plannedCommand()
    expect(TaskExecutionStartSchema.safeParse(controlled).success).toBe(true)
    expect(controlled.task).toEqual(controlled.workflowContext!.planIntent!.sourceTask)
    const changed = structuredClone(controlled)
    changed.workflowContext!.planIntent!.facts.planRevision++
    expect(computeTaskExecutionFingerprint(changed, 'trusted-local:runtime')).not.toBe(
      computeTaskExecutionFingerprint(controlled, 'trusted-local:runtime')
    )
  })
  it.each(['spaceId', 'taskId', 'runId', 'attempt', 'taskRevision'] as const)(
    'rejects a command whose %s differs from the actual planning source task',
    (field) => {
      const command = plannedCommand()
      const changed = {
        ...command,
        task: { ...command.task, [field]: field === 'attempt' ? 2 : 'foreign-test' }
      }
      const parsed = TaskExecutionStartSchema.safeParse(changed)
      expect(parsed.success).toBe(false)
      if (!parsed.success) {
        expect(parsed.error.issues.map((issue) => issue.message)).toContain(
          'workflow_plan_task_mismatch'
        )
      }
    }
  )
  it('requires enforced policy and exact command company at the execution boundary', () => {
    const workflowContext = context()
    const command = taskCommand()
    expect(TaskExecutionStartSchema.safeParse({ ...command, workflowContext }).success).toBe(false)
    const controlled = {
      ...command,
      executionDeadlineAt: command.expiresAt,
      task: { ...command.task, spaceId: workflowContext.binding.scope.companyRef },
      executionPolicy: {
        trustMode: 'enforced_autonomous',
        executionPolicyRef: 'docker-local-linux',
        executionPolicyRevision: '1',
        enforcementEvidenceRef: `docker-enforcement:${'c'.repeat(64)}`
      },
      workflowContext
    }
    expect(TaskExecutionStartSchema.safeParse(controlled).success).toBe(true)
    expect(
      TaskExecutionStartSchema.safeParse({ ...controlled, executionDeadlineAt: undefined }).success
    ).toBe(false)
    expect(TaskExecutionStartSchema.safeParse({ ...controlled, task: command.task }).success).toBe(
      false
    )
    const key = 'trusted-local:runtime'
    const changed = structuredClone(controlled)
    changed.workflowContext.definitionDigest = 'd'.repeat(64)
    expect(computeTaskExecutionFingerprint(changed, key)).not.toBe(
      computeTaskExecutionFingerprint(controlled, key)
    )
  })
})
