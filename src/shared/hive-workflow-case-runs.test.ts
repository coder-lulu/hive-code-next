import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  HiveWorkflowCaseStartSchema,
  HiveWorkflowCaseRunAdmissionSchema
} from './hive-workflow-case-runs'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'
import { hiveWorkflowStagePrompt } from './hive-workflow-stage-prompt'

describe('workflow stage start contract', () => {
  it('accepts only a bounded revision-checked business request', () => {
    const input = {
      requestId: randomUUID(),
      projectId: randomUUID(),
      caseId: randomUUID(),
      expectedCaseRevision: 1,
      stageRef: 'stage:product',
      expectedTaskRevision: 0
    }
    expect(HiveWorkflowCaseStartSchema.parse(input)).toEqual(input)
    for (const override of [
      { employeeRef: randomUUID() },
      { executionMode: 'trusted_personal_preview' },
      { expectedCaseRevision: 0 },
      { expectedTaskRevision: -1 }
    ]) {
      expect(HiveWorkflowCaseStartSchema.safeParse({ ...input, ...override }).success).toBe(false)
    }
  })
  it('keeps the entire maximum requirement and acceptance criteria in the private role prompt', () => {
    const f = workflowCaseFixture()
    f.view.requirement = '需'.repeat(48_000)
    const stage = f.view.workflow.definition.stages[0]
    stage.acceptanceCriteria = Array.from({ length: 16 }, () => '验'.repeat(2048))
    const input = hiveWorkflowStagePrompt(f.view, stage.stageRef)
    expect(input).toContain(f.view.requirement)
    expect(input).toContain(stage.acceptanceCriteria.join('\n'))
    expect(input.length).toBeLessThanOrEqual(128_000)
    expect(HiveWorkflowCaseRunAdmissionSchema.shape.input.safeParse(input).success).toBe(true)
  })
  it('refuses an invented stage instead of selecting another employee', () => {
    expect(() => hiveWorkflowStagePrompt(workflowCaseFixture().view, 'stage:foreign')).toThrow(
      'REVISION_CONFLICT'
    )
  })
})
