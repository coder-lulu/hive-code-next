import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { workflowPlanGraphFixture } from '../hive-workflow-plan-runs.test-fixture'
import { TaskExecutionStartSchema } from './task-execution-command'

describe('graph task controlled admission', () => {
  function commandFixture() {
    const vectors = JSON.parse(readFileSync('integration/contracts/v1/test-vectors.json', 'utf8'))
    const command = TaskExecutionStartSchema.parse(vectors.examples.start)
    const { admission } = workflowPlanGraphFixture()
    command.task = admission.run.task
    command.workflowContext = admission.workflowContext
    command.executionDeadlineAt = admission.executionDeadlineAt
    command.executionPolicy = {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'policy',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: 'evidence'
    }
    return command
  }
  it.each(['spaceId', 'taskId', 'runId', 'attempt', 'taskRevision'] as const)(
    'binds source %s to the admitted task',
    (key) => {
      const command = commandFixture()
      expect(TaskExecutionStartSchema.safeParse(command).success).toBe(true)
      const source = command.workflowContext!.planExecution!.sourceTask
      if (key === 'attempt') {
        source.attempt++
      } else {
        source[key] = 'forged'
      }
      expect(TaskExecutionStartSchema.safeParse(command).success).toBe(false)
    }
  )
  it('requires autonomous enforcement and a deadline', () => {
    const command = commandFixture()
    delete command.executionDeadlineAt
    expect(TaskExecutionStartSchema.safeParse(command).success).toBe(false)
    command.executionDeadlineAt = '2026-10-11T12:00:00.000Z'
    command.executionPolicy = {
      trustMode: 'trusted_personal_preview',
      executionPolicyRef: 'policy',
      executionPolicyRevision: '1'
    }
    expect(TaskExecutionStartSchema.safeParse(command).success).toBe(false)
  })
})
