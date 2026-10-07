import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HiveWorkflowCaseExecutionNoticeSchema } from './hive-workflow-case-execution-notices'
import { HiveWorkflowCaseViewSchema } from './hive-workflow-cases'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'

function fixture() {
  const f = workflowCaseFixture('notice-schema-owner')
  const notice = {
    kind: 'workflow.case-execution-notice',
    eventRef: randomUUID(),
    causeRunId: randomUUID(),
    stageRef: f.view.stageTasks[0].stageRef,
    reason: 'native_not_started',
    recordedAt: '2026-10-06T11:00:00.000Z'
  }
  return { view: f.view, notice }
}
describe('original Case execution notice data', () => {
  it('carries an original event and cause without a new decision or authority field', () => {
    const f = fixture()
    expect(
      HiveWorkflowCaseViewSchema.parse({ ...f.view, executionNotices: [f.notice] }).executionNotices
    ).toEqual([f.notice])
  })
  it.each(['actor', 'authorized', 'stopProof', 'decision'])(
    'refuses extra %s authority data',
    (key) => {
      expect(
        HiveWorkflowCaseExecutionNoticeSchema.safeParse({ ...fixture().notice, [key]: true })
          .success
      ).toBe(false)
    }
  )
  it('rejects duplicate events/causes and a foreign stage', () => {
    const f = fixture()
    expect(
      HiveWorkflowCaseViewSchema.safeParse({ ...f.view, executionNotices: [f.notice, f.notice] })
        .success
    ).toBe(false)
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...f.view,
        executionNotices: [{ ...f.notice, stageRef: 'stage:foreign' }]
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...f.view,
        executionNotices: [f.notice, { ...f.notice, eventRef: randomUUID() }]
      }).success
    ).toBe(false)
  })
  it('bounds original event history and refuses unknown reasons', () => {
    const f = fixture()
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...f.view,
        executionNotices: Array.from({ length: 97 }, () => ({
          ...f.notice,
          eventRef: randomUUID(),
          causeRunId: randomUUID()
        }))
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseExecutionNoticeSchema.safeParse({ ...f.notice, reason: 'model_says_passed' })
        .success
    ).toBe(false)
  })
})
