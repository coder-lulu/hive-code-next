import { describe, expect, it } from 'vitest'
import { workflowPlanHistoricalApplicationFixture } from './hive-workflow-plan-application-source.test-fixture'
import { workflowPlanApplicationMatchesDraft } from './hive-workflow-plan-application-source'

describe('original plan receipt consistency', () => {
  it('accepts the original complete dependency mapping', () => {
    const f = workflowPlanHistoricalApplicationFixture()
    expect(workflowPlanApplicationMatchesDraft(f.receipt, f.draft)).toBe(true)
  })
  it.each(['revision', 'missing-task', 'dependencies'])('refuses forged %s', (kind) => {
    const f = workflowPlanHistoricalApplicationFixture()
    if (kind === 'revision') {
      f.receipt.planRevision = 99
    }
    if (kind === 'missing-task') {
      f.receipt.createdTaskRefs.pop()
      f.view.taskStates.pop()
    }
    if (kind === 'dependencies') {
      f.receipt.createdTaskRefs[1].dependsOnTaskIds = []
    }
    expect(workflowPlanApplicationMatchesDraft(f.receipt, f.draft)).toBe(false)
  })
})
