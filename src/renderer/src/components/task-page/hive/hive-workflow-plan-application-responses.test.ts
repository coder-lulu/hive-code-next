import { describe, expect, it } from 'vitest'
import { workflowPlanHistoricalApplicationFixture } from '../../../../../shared/hive-workflow-plan-application-source.test-fixture'
import { readWorkflowPlanApplication } from './hive-workflow-plan-application-responses'

describe('historical applied plan response behind a newer draft', () => {
  it.each(['valid', 'revision', 'missing-task', 'dependencies'])(
    'authenticates %s against the original applied draft',
    (kind) => {
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
      if (kind === 'valid') {
        expect(readWorkflowPlanApplication(f.view, f.caseView, f.next)).toEqual(f.view)
      } else {
        expect(() => readWorkflowPlanApplication(f.view, f.caseView, f.next)).toThrow(
          'REVISION_CONFLICT'
        )
      }
    }
  )
})
