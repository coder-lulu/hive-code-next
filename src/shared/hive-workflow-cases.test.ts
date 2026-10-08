import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseCreateReplySchema,
  HiveWorkflowCaseListQuerySchema,
  HiveWorkflowCaseReadQuerySchema,
  HiveWorkflowCasePageSchema,
  HiveWorkflowCaseSummarySchema,
  HiveWorkflowCaseViewSchema
} from './hive-workflow-cases'
import { workflowCaseFixture } from './hive-workflow-cases.test-fixture'

describe('fixed-version workflow case contract', () => {
  it('requires a business stage role on open list summaries and none on terminal summaries', () => {
    const { summary } = workflowCaseFixture()
    const open = { ...summary, currentStageRole: 'product' }
    expect(HiveWorkflowCaseSummarySchema.safeParse(open).success).toBe(true)
    expect(
      HiveWorkflowCaseSummarySchema.safeParse({ ...open, currentStageRole: null }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseSummarySchema.safeParse({ ...open, currentStageRole: 'unknown' }).success
    ).toBe(false)
    const terminal = {
      ...open,
      terminalKind: 'done',
      currentStageRef: null,
      currentStageRole: null
    }
    expect(HiveWorkflowCaseSummarySchema.safeParse(terminal).success).toBe(true)
    expect(
      HiveWorkflowCaseSummarySchema.safeParse({ ...terminal, currentStageRole: 'product' }).success
    ).toBe(false)
  })

  it('normalizes UUID inputs before request identity without modifying saved workflow digests', () => {
    const { input, view } = workflowCaseFixture()
    const upper = {
      ...input,
      requestId: input.requestId.toUpperCase(),
      projectId: input.projectId.toUpperCase(),
      workflowId: input.workflowId.toUpperCase()
    }
    expect(HiveWorkflowCaseCreateSchema.parse(upper)).toEqual(input)
    expect(
      HiveWorkflowCaseListQuerySchema.parse({
        projectId: upper.projectId,
        workflowId: upper.workflowId,
        after: view.id.toUpperCase()
      })
    ).toEqual({
      projectId: input.projectId,
      workflowId: input.workflowId,
      after: view.id,
      limit: 25
    })
    expect(
      HiveWorkflowCaseReadQuerySchema.parse({
        projectId: upper.projectId,
        caseId: view.id.toUpperCase()
      })
    ).toEqual({ projectId: input.projectId, caseId: view.id })
    expect(HiveWorkflowCaseViewSchema.parse(view).workflow.definitionDigest).toBe(
      input.definitionDigest
    )
  })
  it('accepts a saved requirement with distinct real stage tasks and explicit unavailable execution', () => {
    const f = workflowCaseFixture()
    expect(HiveWorkflowCaseViewSchema.parse(f.view)).toEqual(f.view)
    expect(
      HiveWorkflowCasePageSchema.parse({ items: [f.summary], nextCursor: null }).items
    ).toEqual([f.summary])
  })
  it('requires a case-bound admission acknowledgement for the single create response', () => {
    const { input, view } = workflowCaseFixture()
    const reply = {
      admission: {
        requestId: input.requestId,
        caseId: view.id,
        payloadFingerprint: 'a'.repeat(64),
        replayed: false
      },
      view
    }
    expect(HiveWorkflowCaseCreateReplySchema.parse(reply)).toEqual(reply)
    expect(HiveWorkflowCaseCreateReplySchema.safeParse(view).success).toBe(false)
    expect(
      HiveWorkflowCaseCreateReplySchema.safeParse({
        ...reply,
        admission: { ...reply.admission, caseId: randomUUID() }
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseCreateReplySchema.safeParse({
        ...reply,
        admission: { ...reply.admission, replayed: undefined }
      }).success
    ).toBe(false)
  })

  it.each(['', ' \t\r\n'])('rejects blank requirement text %j', (requirement) => {
    expect(
      HiveWorkflowCaseCreateSchema.safeParse({ ...workflowCaseFixture().input, requirement })
        .success
    ).toBe(false)
  })

  it('rejects oversized content and client-supplied authority or execution parameters', () => {
    const { input } = workflowCaseFixture()
    for (const change of [
      { requirement: 'a'.repeat(48_001) },
      { accountId: 'another-owner' },
      { companyId: randomUUID() },
      { command: ['codex'] },
      { expectedProjectRevision: 0 }
    ]) {
      expect(HiveWorkflowCaseCreateSchema.safeParse({ ...input, ...change }).success).toBe(false)
    }
  })

  it('rejects mismatched scope, run identity, definition revision and project binding', () => {
    const { view } = workflowCaseFixture()
    for (const change of [
      { id: randomUUID() },
      { binding: { ...view.binding, scope: { ...view.binding.scope, projectRef: randomUUID() } } },
      { binding: { ...view.binding, workflowRevision: view.binding.workflowRevision + 1 } },
      { definitionDigest: 'a'.repeat(64) },
      { projectBindingRevision: view.projectBindingRevision + 1 }
    ]) {
      expect(HiveWorkflowCaseViewSchema.safeParse({ ...view, ...change }).success).toBe(false)
    }
  })

  it('rejects reassigned, duplicate or missing stage tasks', () => {
    const { view } = workflowCaseFixture()
    const first = view.stageTasks[0]
    for (const stageTasks of [
      view.stageTasks.slice(1),
      [first, first, ...view.stageTasks.slice(2)],
      [{ ...first, employeeRef: view.stageTasks[1].employeeRef }, ...view.stageTasks.slice(1)],
      [{ ...first, taskId: view.originTaskId }, ...view.stageTasks.slice(1)]
    ]) {
      expect(HiveWorkflowCaseViewSchema.safeParse({ ...view, stageTasks }).success).toBe(false)
    }
  })

  it('rejects terminal summaries with an active stage and completion with pending work', () => {
    const { view, summary } = workflowCaseFixture()
    expect(HiveWorkflowCaseSummarySchema.safeParse({ ...summary, id: randomUUID() }).success).toBe(
      false
    )
    expect(
      HiveWorkflowCaseSummarySchema.safeParse({ ...summary, currentStageRef: null }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseSummarySchema.safeParse({ ...summary, terminalKind: 'done' }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseViewSchema.safeParse({ ...view, terminalKind: 'done', currentStageRef: null })
        .success
    ).toBe(false)
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...view,
        terminalKind: 'cancelled',
        currentStageRef: null
      }).success
    ).toBe(false)
    expect(
      HiveWorkflowCaseViewSchema.safeParse({
        ...view,
        terminalKind: 'done',
        currentStageRef: null,
        stageTasks: view.stageTasks.map((task) => ({ ...task, status: 'done' }))
      }).success
    ).toBe(true)
  })

  it('caps pages and never includes requirement bodies or configuration in summaries', () => {
    const { summary } = workflowCaseFixture()
    expect(
      HiveWorkflowCasePageSchema.safeParse({ items: Array(51).fill(summary), nextCursor: null })
        .success
    ).toBe(false)
    expect(
      HiveWorkflowCaseSummarySchema.safeParse({ ...summary, requirement: 'private task content' })
        .success
    ).toBe(false)
  })
})
