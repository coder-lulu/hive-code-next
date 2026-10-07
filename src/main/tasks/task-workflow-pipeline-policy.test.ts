import { describe, expect, it } from 'vitest'
import {
  createWorkflowPipeline,
  assertWorkflowPipeline
} from '../../../integration/paperclip/service/workflow-pipeline-definition.mjs'
import { workflowStageKey } from '../../../integration/paperclip/service/workflow-pipeline-policy.mjs'
import { validateWorkflowTaskCase } from '../../../integration/paperclip/service/task-run-case-scope.mjs'
import {
  pipelinePolicyFixture,
  pipelineCaseScopeFixture
} from './task-workflow-pipeline-policy.test-fixture'

const configPath =
  '../../../integration/paperclip/core/case-kernel/services/pipeline-stage-config.ts'

describe('workflow pipeline review policy against the original Core reader', () => {
  it('creates a valid review stage pinned to the actual Tester and legal Ops/Developer edges', async () => {
    const f = pipelinePolicyFixture()
    await createWorkflowPipeline(f.db, f.snapshot, f.pipeline.id, 'actor:owner', f.employees)
    const review = f.stages.find((stage) => stage.kind === 'review')!
    const core = await import(configPath)
    const config = core.normalizeStageConfig(review.kind, review.config)
    const key = (role: string) =>
      workflowStageKey(f.definition.stages.find((stage) => stage.role === role)!.stageRef)
    expect(config).toMatchObject({
      requireApproval: true,
      approver: {
        kind: 'agent',
        id: f.employees.find((member) => member.role === 'tester')!.employeeRef
      },
      approveToStageKey: key('ops'),
      rejectToStageKey: key('developer'),
      requestChangesToStageKey: key('developer')
    })
    for (const decision of ['approve', 'reject', 'request_changes']) {
      const target = core.targetStageKeyForReviewDecision(config, decision)
      const targetId = f.stages.find((stage) => stage.key === target)!.id
      expect(
        f.edges.some((edge) => edge.from_stage_id === review.id && edge.to_stage_id === targetId)
      ).toBe(true)
    }
    await expect(assertWorkflowPipeline(f.db, f.snapshot, f.pipeline)).resolves.toBeUndefined()
  })

  it('permits only the configured Tester agent, including when a user copies the same UUID', async () => {
    const f = pipelinePolicyFixture()
    await createWorkflowPipeline(f.db, f.snapshot, f.pipeline.id, 'actor:owner', f.employees)
    const review = f.stages.find((stage) => stage.kind === 'review')!
    const tester = f.employees.find((member) => member.role === 'tester')!.employeeRef
    const developer = f.employees.find((member) => member.role === 'developer')!.employeeRef
    const core = await import(configPath)
    expect(() =>
      core.assertActorCanApproveStageExit(review, {
        type: 'agent',
        agentId: tester,
        runId: 'original-run'
      })
    ).not.toThrow()
    for (const actor of [
      { type: 'agent', agentId: developer, runId: 'developer-run' },
      { type: 'user', userId: tester },
      { type: 'system' }
    ]) {
      expect(() => core.assertActorCanApproveStageExit(review, actor)).toThrow()
    }
  })

  it('rejects a replaced Tester without rewriting the pinned pipeline approver', async () => {
    const f = pipelinePolicyFixture()
    await createWorkflowPipeline(f.db, f.snapshot, f.pipeline.id, 'actor:owner', f.employees)
    const before = structuredClone(f.stages)
    f.employees.find((member) => member.role === 'tester')!.employeeRef = f.employees[0].employeeRef
    await expect(assertWorkflowPipeline(f.db, f.snapshot, f.pipeline)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(f.stages).toEqual(before)
  })
  it('uses the same creator review policy for pipeline assertion and frozen run scope', async () => {
    const f = pipelinePolicyFixture()
    await createWorkflowPipeline(f.db, f.snapshot, f.pipeline.id, 'actor:owner', f.employees)
    const c = pipelineCaseScopeFixture(f)
    await expect(assertWorkflowPipeline(f.db, f.snapshot, f.pipeline)).resolves.toBeUndefined()
    await expect(validateWorkflowTaskCase(f.db, c.task, c.row, c.accountId)).resolves.toEqual({
      team: c.team,
      stage: c.stage
    })
    c.row.stage_config.approver = { kind: 'user', id: c.team.employees[2].employeeRef }
    await expect(validateWorkflowTaskCase(f.db, c.task, c.row, c.accountId)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
  })
  it.each(['product', 'developer', 'tester', 'ops'])(
    'rejects replaced actual %s identity in the frozen scope',
    async (role) => {
      const f = pipelinePolicyFixture()
      await createWorkflowPipeline(f.db, f.snapshot, f.pipeline.id, 'actor:owner', f.employees)
      const c = pipelineCaseScopeFixture(f)
      f.employees.find((employee) => employee.role === role)!.employeeRef =
        'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
      await expect(validateWorkflowTaskCase(f.db, c.task, c.row, c.accountId)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
    }
  )
})
