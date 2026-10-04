import { describe, expect, it } from 'vitest'
import {
  appendWorkflowStage,
  createWorkflowDraft,
  removeWorkflowStage,
  workflowDraftInput,
  workflowDraftRefusal,
  workflowStageAncestors
} from './hive-workflow-draft'
import { workbenchCompany, workbenchProject, workbenchTeam } from './hive-workbench.test-fixtures'

const company = workbenchCompany(1)
const team = workbenchTeam(company, workbenchProject(3, company), true)

describe('editable delivery workflow drafts', () => {
  it('appends usable stages for each role with the required prior handoff and bounded attempts', () => {
    let draft = createWorkflowDraft((key) => key)
    for (const role of ['product', 'developer', 'tester', 'ops'] as const) {
      draft = appendWorkflowStage(draft, role, 'Check the requested delivery')
      expect(workflowDraftRefusal(draft, team)).toBeNull()
    }
    expect(draft.stages).toHaveLength(8)
    const extraTester = draft.stages[6]
    expect(extraTester.returnToStageRef).toBe(draft.stages[5].stageRef)
  })
  it('bounds the stage count at 32 and preserves all four roles when removing a stage', () => {
    let draft = createWorkflowDraft((key) => key)
    const originalProduct = draft.stages[0].stageRef
    expect(removeWorkflowStage(draft, originalProduct)).toBe(draft)
    for (let index = 4; index < 32; index += 1) {
      draft = appendWorkflowStage(draft, 'developer', 'Verify implementation')
    }
    expect(draft.stages).toHaveLength(32)
    expect(appendWorkflowStage(draft, 'developer', 'Extra')).toBe(draft)
    const extra = draft.stages[31]
    const reduced = removeWorkflowStage(draft, extra.stageRef)
    expect(reduced.stages).toHaveLength(31)
    expect(workflowDraftRefusal(reduced, team)).toBeNull()
  })
  it('preserves an invalid return as explicit feedback rather than replacing it with another stage', () => {
    let draft = createWorkflowDraft((key) => key)
    draft = appendWorkflowStage(draft, 'developer', 'Implement revision')
    draft = {
      ...draft,
      stages: draft.stages.map((stage) =>
        stage.role === 'tester'
          ? {
              ...stage,
              dependsOn: [draft.stages[4].stageRef],
              returnToStageRef: draft.stages[4].stageRef
            }
          : stage
      )
    }
    expect(workflowDraftRefusal(draft, team)).toBeNull()
    const reduced = removeWorkflowStage(draft, draft.stages[4].stageRef)
    expect(reduced.stages[2].returnToStageRef).toBeUndefined()
    expect(workflowDraftRefusal(reduced, team)).not.toBeNull()
  })
  it('normalizes criteria only at submission and refuses empty, excessive or oversize criteria', () => {
    const draft = createWorkflowDraft((key) => key)
    draft.name = '  Delivery  '
    draft.stages[0].acceptanceCriteria = ['  One criterion  ', '', 'Second criterion']
    expect(workflowDraftInput(draft, team)).toMatchObject({
      name: 'Delivery',
      stages: expect.arrayContaining([
        expect.objectContaining({ acceptanceCriteria: ['One criterion', 'Second criterion'] })
      ])
    })
    expect(draft.stages[0].acceptanceCriteria).toEqual([
      '  One criterion  ',
      '',
      'Second criterion'
    ])
    for (const criteria of [
      [' '],
      Array.from({ length: 17 }, () => 'criterion'),
      ['x'.repeat(2049)]
    ]) {
      draft.stages[0].acceptanceCriteria = criteria
      expect(workflowDraftRefusal(draft, team)).toBe('workflow_definition_invalid')
    }
  })
  it('finds return candidates without looping on an invalid dependency cycle', () => {
    const draft = createWorkflowDraft((key) => key)
    draft.stages[0].dependsOn = [draft.stages[3].stageRef]
    expect(workflowStageAncestors(draft.stages, draft.stages[2].stageRef)).toEqual(
      new Set([draft.stages[1].stageRef, draft.stages[0].stageRef, draft.stages[3].stageRef])
    )
    expect(workflowDraftRefusal(draft, team)).toBe('workflow_dependency_cycle')
  })
  it('rejects individually valid criteria whose complete definition exceeds the service byte budget', () => {
    const draft = createWorkflowDraft((key) => key)
    for (const stage of draft.stages) {
      stage.acceptanceCriteria = Array.from({ length: 16 }, () => '验收'.repeat(500))
    }
    expect(workflowDraftRefusal(draft, team)).toBe('workflow_definition_too_large')
    for (const stage of draft.stages) {
      stage.acceptanceCriteria = ['确认验收标准']
    }
    expect(workflowDraftRefusal(draft, team)).toBeNull()
  })
})
